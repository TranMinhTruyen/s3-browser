import { Box, Center, Divider, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { PickFiles } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DroppedFile, FilesDroppedOutput } from '@wails/S3Browser/models/bucket';
import { Events } from '@wailsio/runtime';
import { FileDown, Trash2, Upload } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { tintedColor } from '@/common/theme/tintedColor';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import TruncatedText from '@/components/display/TruncatedText';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import i18n from '@/locales/i18n';
import BucketPicker from '@/pages/s3/components/BucketPicker';
import { FileRow, GroupRow, GroupStat, UploadRow, VirtualRowList } from '@/pages/s3/modals/upload/UploadFileList';
import { mergePickedFiles, PickerLimits, PickerList, removePickedFiles } from '@/pages/s3/utils/uploadUtils';
import classes from './UploadPickerModal.module.css';

type UploadPickerModalProps = ModalProps & {
  // The tab the files are uploaded from; also the drop target's tab id.
  tabId: string;
  connectionId: string;
  profileName?: string;
  // Fixed target bucket. Without it the user must choose one.
  bucket?: string;
  prefix?: string;
};

export type UploadPickerResult = { bucket: string; files: DroppedFile[] };

// The list follows the window height but never gets smaller than the minimum.
const LIST_HEIGHT = 'max(280px, 40vh)';

type FileListProps = {
  rows: UploadRow[];
  selected: ReadonlySet<string>;
  stats: GroupStat[];
  limits: PickerLimits;
  onToggleFile: (path: string, checked: boolean) => void;
  onRemoveFile: (path: string) => void;
};

const FileList = memo(function FileList(props: FileListProps) {
  const { rows, selected, stats, limits, onToggleFile, onRemoveFile } = props;
  const { t } = useTranslation('uploadPickerModal');

  const renderRow = useCallback(
    (row: UploadRow, key: string | number | bigint, top: number) => {
      if (row.kind === 'file') {
        return (
          <FileRow
            key={key}
            file={row.file}
            checked={selected.has(row.file.path)}
            top={top}
            largeLabel={t('large')}
            titleBy="path"
            removeLabel={t('remove')}
            onToggleFile={onToggleFile}
            onRemoveFile={onRemoveFile}
          />
        );
      }

      const stat = stats[row.index];
      const { maxFilesPerFolder, largeFileMaxCount } = limits;
      return (
        <GroupRow
          key={key}
          group={row.group}
          top={top}
          rootLabel={t('rootFolder')}
          largeText={
            row.group.largeCount > 0
              ? formatStringJson(t('selectedLarge'), { selected: stat.selectedLarge, max: largeFileMaxCount })
              : undefined
          }
          largeOver={stat.selectedLarge > largeFileMaxCount}
          countText={formatStringJson(t('selectedCount'), { selected: stat.selected, max: maxFilesPerFolder })}
          countOver={stat.selected > maxFilesPerFolder}
        />
      );
    },
    [selected, stats, limits, onToggleFile, onRemoveFile, t]
  );

  return <VirtualRowList rows={rows} height={LIST_HEIGHT} renderRow={renderRow} />;
});

/**
 * Lets the user add files (native dialog or drag and drop), tick the ones to upload and choose the target bucket.
 * Resolves the bucket and the ticked files, or null when canceled.
 */
export default createMantineModal<UploadPickerModalProps, UploadPickerResult | null>(props => {
  const {
    tabId,
    connectionId,
    profileName,
    bucket,
    prefix = '',
    mantine,
    size = 'xl',
    centered = true,
    ...restProps
  } = props;

  const { t } = useTranslation('uploadPickerModal');

  // Groups and ticks change together. The ref always holds the latest list, so overlapping updates (a drop while
  // the native dialog is open, two drops in a row) merge into each other instead of overwriting.
  const [list, setList] = useState<PickerList>({ groups: [], selected: new Set() });
  const listRef = useRef(list);
  const { groups, selected } = list;
  const [limits, setLimits] = useState<PickerLimits>({ maxFilesPerFolder: 0, largeFileMaxCount: 0, maxTotalFiles: 0 });
  const [pickedBucket, setPickedBucket] = useState<string | null>(bucket ?? null);
  const [isPicking, setIsPicking] = useState(false);
  const targetBucket = bucket ?? pickedBucket;

  const updateList = useCallback((next: PickerList) => {
    listRef.current = next;
    setList(next);
  }, []);

  // Adds files from the dialog or a drop to the list.
  const onAddFiles = useCallback(
    (output: FilesDroppedOutput) => {
      const hasGroups = !!output.groups?.length;
      // Nothing was added (e.g. the dialog was canceled) and there is nothing to warn about.
      if (!hasGroups && output.skipped === 0 && !output.overMaxTotal && !output.capped) return;

      const nextLimits = {
        maxFilesPerFolder: output.maxFilesPerFolder,
        largeFileMaxCount: output.largeFileMaxCount,
        maxTotalFiles: output.maxTotalFiles,
      };
      const merged = mergePickedFiles(listRef.current, output.groups ?? [], nextLimits);
      if (hasGroups) {
        setLimits(nextLimits);
        updateList({ groups: merged.groups, selected: merged.selected });
      }

      if (output.skipped > 0) {
        toast.warning(formatStringJson(i18n.t('ipcMessage:bucket.S3W006'), { count: output.skipped }));
      }
      if (output.overMaxTotal || merged.overTotal) {
        toast.warning(formatStringJson(i18n.t('ipcMessage:bucket.S3W007'), { max: output.maxTotalFiles }));
      }
      if (output.capped) toast.warning(i18n.t('uploadLimitModal:cappedWarning'));
      if (merged.autoUnselected) toast.warning(t('autoUnselected'));
    },
    [updateList, t]
  );

  // Every open tab listens; only the tab the files were dropped on handles them.
  useEffect(() => {
    const unsubscribe = Events.On('uploader:picker-files-dropped', e => {
      if (e.data?.tabId === tabId) onAddFiles(e.data);
    });
    return () => {
      unsubscribe();
    };
  }, [onAddFiles, tabId]);

  const stats = useMemo<GroupStat[]>(
    () =>
      groups.map(group => {
        const ticked = group.files.filter(file => selected.has(file.path));
        return { selected: ticked.length, selectedLarge: ticked.filter(file => file.isLarge).length };
      }),
    [groups, selected]
  );

  const rows = useMemo<UploadRow[]>(
    () =>
      groups.flatMap((group, index) => [
        { kind: 'group' as const, index, group },
        ...group.files.map(file => ({ kind: 'file' as const, file })),
      ]),
    [groups]
  );

  const result = useMemo(
    () => groups.flatMap(group => group.files.filter(file => selected.has(file.path))),
    [groups, selected]
  );

  const hasViolation = stats.some(
    stat => stat.selected > limits.maxFilesPerFolder || stat.selectedLarge > limits.largeFileMaxCount
  );

  const onToggleFile = useCallback(
    (path: string, checked: boolean) => {
      const prev = listRef.current;
      const next = new Set(prev.selected);
      if (checked) next.add(path);
      else next.delete(path);
      updateList({ groups: prev.groups, selected: next });
    },
    [updateList]
  );

  const onRemoveFile = useCallback(
    (path: string) => updateList(removePickedFiles(listRef.current, [path])),
    [updateList]
  );

  const onClickRemoveSelected = useCallback(
    () => updateList(removePickedFiles(listRef.current, [...listRef.current.selected])),
    [updateList]
  );

  const onClickPickFiles = useCallback(async () => {
    setIsPicking(true);
    try {
      const output = await callIPC(PickFiles, []);
      // Canceling the dialog is a success with no groups.
      if (output) onAddFiles(output);
    } finally {
      setIsPicking(false);
    }
  }, [onAddFiles]);

  const onClickUpload = useCallback(() => {
    if (!targetBucket) return;
    mantine.handler.resolve({ bucket: targetBucket, files: result });
    mantine.handler.hide();
  }, [mantine.handler, targetBucket, result]);

  const onClickCancel = useCallback(() => {
    mantine.handler.resolve(null);
    mantine.handler.hide();
  }, [mantine.handler]);

  const target = bucket ? `${bucket}/${prefix}` : '';

  return (
    <Modal.Root {...mantine.props} size={size} centered={centered} {...restProps}>
      <Modal.Overlay />
      <Modal.Content className={classes.dropZone} data-file-drop-target="" data-drop-kind="picker" data-tab-id={tabId}>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Upload />
            <Title order={4}>{t('title')}</Title>
          </Group>
          <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          {/* Bordered sections like the object view: target, actions and list, each split by a divider */}
          <Paper withBorder style={{ overflow: 'hidden' }}>
            <Box p="8px">
              {bucket ? (
                <TruncatedText size="sm" c="dimmed">
                  {formatStringJson(t('target'), { target })}
                </TruncatedText>
              ) : (
                <BucketPicker
                  connectionId={connectionId}
                  profileName={profileName}
                  value={pickedBucket}
                  error={!pickedBucket && result.length > 0 ? t('bucketRequired') : undefined}
                  onChange={setPickedBucket}
                />
              )}
            </Box>

            <Divider />

            <Stack gap="4px" p="8px">
              <Group gap="xs">
                <Button
                  leftSection={<Upload size="16px" />}
                  onClick={onClickPickFiles}
                  loading={isPicking}
                  disabled={isPicking}
                >
                  {t('selectFiles')}
                </Button>
                <Button
                  {...tintedColor('red', 'button')}
                  leftSection={<Trash2 size="16px" />}
                  onClick={onClickRemoveSelected}
                  disabled={isPicking || selected.size === 0}
                >
                  {t('removeSelected')} ({selected.size})
                </Button>
              </Group>
              <Text size="sm" c="dimmed">
                {t('dropHint')}
              </Text>
            </Stack>

            <Divider />

            <div className={classes.dropArea}>
              {rows.length === 0 ? (
                <Center h={LIST_HEIGHT}>
                  <Text c="dimmed" ta="center">
                    {t('emptyList')}
                  </Text>
                </Center>
              ) : (
                <FileList
                  rows={rows}
                  selected={selected}
                  stats={stats}
                  limits={limits}
                  onToggleFile={onToggleFile}
                  onRemoveFile={onRemoveFile}
                />
              )}
              <div className={classes.dropOverlay}>
                <FileDown size="32px" />
                <Text fw={600}>{t('dropHere')}</Text>
              </div>
            </div>
          </Paper>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between" wrap="nowrap">
          <Button onClick={onClickCancel} color="red">
            {t('common:button.cancel')}
          </Button>
          <Button onClick={onClickUpload} disabled={!targetBucket || hasViolation || result.length === 0}>
            {t('upload')} ({result.length})
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
