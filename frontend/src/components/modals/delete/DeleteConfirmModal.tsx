import { Divider, Group, Modal, Paper, Text, Title } from '@mantine/core';
import { DroppedFile } from '@wails/S3Browser/models/bucket';
import { Folder, TriangleAlert } from 'lucide-react';
import { ChangeEvent, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import { WARNING_BG_COLOR, WARNING_COLOR } from '@/components/modals/modalColors';
import { FileRow, UploadRow, VirtualRowList } from '@/components/modals/upload/UploadFileList';
import TruncatedText from '@/components/TruncatedText';

export type DeleteFile = { key: string; size: number };

type DeleteConfirmModalProps = ModalProps & {
  files: DeleteFile[];
};

// The list follows the window height but never gets smaller than the minimum.
const LIST_HEIGHT = 'max(200px, 35vh)';

/**
 * Lists the files about to be deleted (all ticked) so the user can untick the ones to keep.
 * Resolves the ticked keys, or null when canceled.
 */
export default createMantineModal<DeleteConfirmModalProps, string[] | null>(props => {
  const { files, mantine, size = 'xl', centered = true, ...restProps } = props;

  const { t } = useTranslation('deleteConfirmModal');

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(files.map(file => file.key)));

  // Reuses the upload list rows: the key stands in for the local path.
  const rows = useMemo<UploadRow[]>(
    () =>
      files.map(file => ({
        kind: 'file' as const,
        file: new DroppedFile({ path: file.key, relKey: file.key, size: file.size, isLarge: false }),
      })),
    [files]
  );

  const total = files.length;
  const count = selected.size;

  const onToggleFile = useCallback((key: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const onChangeAll = useCallback(
    (e: ChangeEvent<HTMLInputElement>) =>
      setSelected(e.currentTarget.checked ? new Set(files.map(file => file.key)) : new Set()),
    [files]
  );

  const renderRow = useCallback(
    (row: UploadRow, key: string | number | bigint, top: number) =>
      row.kind === 'file' && (
        <FileRow
          key={key}
          file={row.file}
          checked={selected.has(row.file.path)}
          top={top}
          largeLabel=""
          titleBy="path"
          onToggleFile={onToggleFile}
        />
      ),
    [selected, onToggleFile]
  );

  const onClickDelete = useCallback(() => {
    mantine.handler.resolve(files.map(file => file.key).filter(key => selected.has(key)));
    mantine.handler.hide();
  }, [mantine.handler, files, selected]);

  const onClickCancel = useCallback(() => {
    mantine.handler.resolve(null);
    mantine.handler.hide();
  }, [mantine.handler]);

  return (
    <Modal.Root {...mantine.props} size={size} centered={centered} {...restProps}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: WARNING_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <TriangleAlert color={WARNING_COLOR} />
            <Title order={4} style={{ color: WARNING_COLOR }}>
              {t('title')}
            </Title>
          </Group>
          <Modal.CloseButton size="md" aria-label={t('common:button.close')} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Paper withBorder style={{ overflow: 'hidden' }}>
            <Text p="8px" size="sm" ta="center" c="var(--mantine-color-red-filled)">
              {t('warning')}
            </Text>
            <Divider />
            <Group gap="xs" wrap="nowrap" px="xs" h={36} bg="var(--mantine-color-default-hover)">
              <CheckBoxInput
                checked={count === total}
                indeterminate={count > 0 && count < total}
                onChange={onChangeAll}
                aria-label={t('selectAll')}
              />
              <Folder size="16px" style={{ flexShrink: 0 }} />
              <TruncatedText fw={600} style={{ flex: 1, minWidth: 0 }}>
                {t('rootFolder')}
              </TruncatedText>
              <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                {formatStringJson(t('selectedCount'), { selected: count, total })}
              </Text>
            </Group>
            <VirtualRowList rows={rows} height={LIST_HEIGHT} renderRow={renderRow} />
          </Paper>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between" wrap="nowrap">
          <Button onClick={onClickCancel} color="red">
            {t('common:button.cancel')}
          </Button>
          <Button onClick={onClickDelete} color="red" disabled={count === 0}>
            {t('delete')} ({count})
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
