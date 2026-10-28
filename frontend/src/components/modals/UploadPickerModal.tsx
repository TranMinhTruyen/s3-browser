import { Badge, Center, Divider, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PickFiles } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DroppedFile, DroppedGroup, FilesDroppedOutput } from '@wails/S3Browser/models/bucket';
import { Events } from '@wailsio/runtime';
import { FileDown, Folder, Trash2, Upload } from 'lucide-react';
import { ChangeEvent, CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatFileSize, formatStringJson } from '@/common/utils/stringUtils';
import { mergePickedFiles, PickerLimits, PickerList, removePickedFiles } from '@/common/utils/uploadUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Button from '@/components/buttons/Button';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import BucketPicker from '@/components/inputs/combobox/BucketPicker';
import i18n from '@/locales/i18n';
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

type Row = { kind: 'group'; index: number; group: DroppedGroup } | { kind: 'file'; file: DroppedFile };

type GroupStat = { selected: number; selectedLarge: number };

const ROW_HEIGHT = 36;
// The list follows the window height but never gets smaller than the minimum.
const LIST_HEIGHT = 'max(280px, 40vh)';

// Last path segment; picked paths use "\" on Windows and "/" elsewhere.
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

type FileRowProps = {
  file: DroppedFile;
  checked: boolean;
  style: CSSProperties;
  onToggleFile: (path: string, checked: boolean) => void;
  onRemoveFile: (path: string) => void;
};

const FileRow = memo(function FileRow(props: FileRowProps) {
  const { file, checked, style, onToggleFile, onRemoveFile } = props;
  const { t } = useTranslation('uploadPickerModal');

  const onChangeFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onToggleFile(file.path, e.currentTarget.checked),
    [onToggleFile, file.path]
  );

  const onClickRemove = useCallback(() => onRemoveFile(file.path), [onRemoveFile, file.path]);

  return (
    <Group style={style} gap="xs" wrap="nowrap" px="xs">
      <CheckBoxInput
        checked={checked}
        onChange={onChangeFile}
        label={
          <Text span truncate="end" title={file.path} style={{ display: 'block' }}>
            {baseName(file.relKey)}
          </Text>
        }
        styles={{ root: { flex: 1, minWidth: 0 }, body: { minWidth: 0 }, labelWrapper: { minWidth: 0 } }}
      />
      {file.isLarge && (
        <Badge color="orange" variant="light" style={{ flexShrink: 0 }}>
          {t('large')}
        </Badge>
      )}
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {formatFileSize(file.size)}
      </Text>
      <ActionIcon size="sm" color="red" onClick={onClickRemove} aria-label={t('remove')} title={t('remove')}>
        <Trash2 size="14px" />
      </ActionIcon>
    </Group>
  );
});

type GroupRowProps = {
  group: DroppedGroup;
  selected: number;
  selectedLarge: number;
  maxFilesPerFolder: number;
  largeFileMaxCount: number;
  style: CSSProperties;
};

const GroupRow = memo(function GroupRow(props: GroupRowProps) {
  const { group, selected, selectedLarge, maxFilesPerFolder, largeFileMaxCount, style } = props;
  const { t } = useTranslation('uploadPickerModal');

  const overCount = selected > maxFilesPerFolder;
  const overLarge = selectedLarge > largeFileMaxCount;

  return (
    <Group style={style} gap="xs" wrap="nowrap" px="xs" bg="var(--mantine-color-default-hover)">
      <Folder size="16px" style={{ flexShrink: 0 }} />
      <Text fw={600} truncate="end" style={{ flex: 1, minWidth: 0 }} title={group.name}>
        {group.name || t('rootFolder')}
      </Text>
      {group.largeCount > 0 && (
        <Text size="sm" c={overLarge ? 'red' : 'dimmed'} fw={overLarge ? 600 : undefined} style={{ flexShrink: 0 }}>
          {formatStringJson(t('selectedLarge'), { selected: selectedLarge, max: largeFileMaxCount })}
        </Text>
      )}
      <Text size="sm" c={overCount ? 'red' : 'dimmed'} fw={overCount ? 600 : undefined} style={{ flexShrink: 0 }}>
        {formatStringJson(t('selectedCount'), { selected, max: maxFilesPerFolder })}
      </Text>
    </Group>
  );
});

type FileListProps = {
  rows: Row[];
  selected: ReadonlySet<string>;
  stats: GroupStat[];
  limits: PickerLimits;
  onToggleFile: (path: string, checked: boolean) => void;
  onRemoveFile: (path: string) => void;
};

const FileList = memo(function FileList(props: FileListProps) {
  const { rows, selected, stats, limits, onToggleFile, onRemoveFile } = props;

  const scrollRef = useRef<HTMLDivElement>(null);

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: idx => {
      const row = rows[idx];
      return row.kind === 'group' ? `g:${row.index}` : `f:${row.file.path}`;
    },
    overscan: 8,
  });

  return (
    <div ref={scrollRef} style={{ height: LIST_HEIGHT, overflow: 'auto', position: 'relative' }}>
      <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index];
          const style = {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: ROW_HEIGHT,
            transform: `translateY(${item.start}px)`,
          } as const;

          return row.kind === 'group' ? (
            <GroupRow
              key={item.key}
              group={row.group}
              selected={stats[row.index].selected}
              selectedLarge={stats[row.index].selectedLarge}
              maxFilesPerFolder={limits.maxFilesPerFolder}
              largeFileMaxCount={limits.largeFileMaxCount}
              style={style}
            />
          ) : (
            <FileRow
              key={item.key}
              file={row.file}
              checked={selected.has(row.file.path)}
              style={style}
              onToggleFile={onToggleFile}
              onRemoveFile={onRemoveFile}
            />
          );
        })}
      </div>
    </div>
  );
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

  const rows = useMemo<Row[]>(
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
          style={{ justifyContent: 'flex-end', backgroundColor: '#d0ebff' }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Upload />
            <Title order={4}>{t('title')}</Title>
          </Group>
          <Modal.CloseButton size="md" aria-label={t('common:button.close')} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Stack gap="8px">
            {bucket ? (
              <Text size="sm" c="dimmed" truncate="end">
                {formatStringJson(t('target'), { target })}
              </Text>
            ) : (
              <BucketPicker
                connectionId={connectionId}
                profileName={profileName}
                value={pickedBucket}
                label={t('bucketLabel')}
                error={!pickedBucket && result.length > 0 ? t('bucketRequired') : undefined}
                onChange={setPickedBucket}
              />
            )}
            <Group justify="space-between">
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
                  color="red"
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
            </Group>
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
          </Stack>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between">
          <Button onClick={onClickUpload} disabled={!targetBucket || hasViolation || result.length === 0}>
            {t('upload')} ({result.length})
          </Button>
          <Button onClick={onClickCancel} color="red">
            {t('common:button.cancel')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
