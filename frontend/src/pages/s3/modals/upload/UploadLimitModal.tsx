import { Accordion, Box, Divider, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { DroppedFile, DroppedGroup } from '@wails/S3Browser/models/bucket';
import { TriangleAlert } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatFileSize, formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import { WARNING_BG_COLOR, WARNING_COLOR } from '@/components/modals/modalColors';
import {
  FileRow,
  GroupRow,
  GroupStat,
  rowsHeight,
  UploadRow,
  VirtualRowList,
} from '@/pages/s3/modals/upload/UploadFileList';

type UploadLimitModalProps = ModalProps & {
  groups: DroppedGroup[];
  // Số file tối đa trong mỗi nhóm.
  maxFilesPerFolder: number;
  // Ngưỡng dung lượng byte để một file được tính là file lớn.
  largeFileSize: number;
  // Mỗi nhóm được tải lên tối đa số file lớn này.
  largeFileMaxCount: number;
  // Quét thư mục đã dừng sớm nên danh sách có thể chưa đầy đủ.
  capped?: boolean;
};

type FileListProps = {
  rows: UploadRow[];
  selected: ReadonlySet<string>;
  stats: GroupStat[];
  maxFilesPerFolder: number;
  largeFileMaxCount: number;
  // Phần này chỉ đếm file lớn nên tiêu đề hiển thị bộ đếm file lớn.
  largeOnly: boolean;
  onToggleFile: (path: string, checked: boolean) => void;
};

// Chiều cao tối đa của danh sách theo px ở cỡ trung bình; chiều cao thực tế của danh sách được tính bằng rem.
const LIST_MAX_HEIGHT = 320;

const FileList = memo(function FileList(props: FileListProps) {
  const { rows, selected, stats, maxFilesPerFolder, largeFileMaxCount, largeOnly, onToggleFile } = props;
  const { t } = useTranslation('uploadLimitModal');

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
            titleBy="relKey"
            onToggleFile={onToggleFile}
          />
        );
      }

      const stat = stats[row.index];
      const counter = largeOnly
        ? {
            largeText: formatStringJson(t('selectedLarge'), { selected: stat.selectedLarge, max: largeFileMaxCount }),
            largeOver: stat.selectedLarge > largeFileMaxCount,
          }
        : {
            countText: formatStringJson(t('selectedCount'), { selected: stat.selected, max: maxFilesPerFolder }),
            countOver: stat.selected > maxFilesPerFolder,
          };
      return <GroupRow key={key} group={row.group} top={top} rootLabel={t('rootFolder')} {...counter} />;
    },
    [selected, stats, maxFilesPerFolder, largeFileMaxCount, largeOnly, onToggleFile, t]
  );

  return (
    <VirtualRowList
      rows={rows}
      height={`${Math.min(rowsHeight(rows.length), LIST_MAX_HEIGHT) / 16}rem`}
      renderRow={renderRow}
    />
  );
});

/** Cho phép người dùng chọn file cần tải lên; trả về các file đã chọn (mảng rỗng hoặc null nếu hủy). */
export default createMantineModal<UploadLimitModalProps, DroppedFile[]>(props => {
  const {
    groups,
    maxFilesPerFolder,
    largeFileSize,
    largeFileMaxCount,
    capped,
    mantine,
    size = 'xl',
    centered = true,
    ...restProps
  } = props;

  const { t } = useTranslation('uploadLimitModal');

  // Nhóm vượt giới hạn cần người dùng chọn; các nhóm còn lại được tải lên đầy đủ.
  const violating = useMemo(() => groups.map(g => g.overMaxFiles || g.overLargeCount), [groups]);

  // Mặc định: chọn `max` file đầu tiên trong mỗi nhóm vượt giới hạn, trong đó tối đa `largeFileMaxCount` file lớn.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
    const initial = new Set<string>();
    groups.forEach((group, i) => {
      if (!violating[i]) return;
      let count = 0;
      let large = 0;
      for (const file of group.files) {
        if (count >= maxFilesPerFolder) break;
        if (file.isLarge) {
          if (large >= largeFileMaxCount) continue;
          large++;
        }
        count++;
        initial.add(file.path);
      }
    });
    return initial;
  });

  const stats = useMemo<GroupStat[]>(
    () =>
      groups.map(group => {
        let count = 0;
        let large = 0;
        for (const file of group.files) {
          if (!selected.has(file.path)) continue;
          count++;
          if (file.isLarge) large++;
        }
        return { selected: count, selectedLarge: large };
      }),
    [groups, selected]
  );

  const overMaxRows = useMemo(() => {
    const rows: UploadRow[] = [];
    groups.forEach((group, index) => {
      if (!group.overMaxFiles) return;
      rows.push({ kind: 'group', index, group });
      for (const file of group.files) rows.push({ kind: 'file', file });
    });
    return rows;
  }, [groups]);

  const overLargeRows = useMemo(() => {
    const rows: UploadRow[] = [];
    groups.forEach((group, index) => {
      if (!group.overLargeCount) return;
      rows.push({ kind: 'group', index, group });
      for (const file of group.files) if (file.isLarge) rows.push({ kind: 'file', file });
    });
    return rows;
  }, [groups]);

  const hasOverMax = overMaxRows.length > 0;
  const hasOverLarge = overLargeRows.length > 0;

  const result = useMemo(
    () => groups.flatMap((group, i) => (violating[i] ? group.files.filter(f => selected.has(f.path)) : group.files)),
    [groups, violating, selected]
  );

  const hasViolation = useMemo(
    () =>
      groups.some(
        (_, i) => violating[i] && (stats[i].selected > maxFilesPerFolder || stats[i].selectedLarge > largeFileMaxCount)
      ),
    [groups, violating, stats, maxFilesPerFolder, largeFileMaxCount]
  );

  const onToggleFile = useCallback((path: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const onClickUpload = useCallback(() => {
    mantine.handler.resolve(result);
    mantine.handler.hide();
  }, [mantine.handler, result]);

  const onClickCancel = useCallback(() => {
    mantine.handler.resolve([]);
    mantine.handler.hide();
  }, [mantine.handler]);

  const defaultOpened = hasOverMax ? 'overMax' : 'overLarge';

  return (
    <Modal.Root {...mantine.props} size={size} centered={centered} {...restProps}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="0.5rem"
          mih="0"
          style={{ justifyContent: 'flex-end', backgroundColor: WARNING_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <TriangleAlert color={WARNING_COLOR} />
            <Title order={4} style={{ color: WARNING_COLOR }}>
              {t('title')}
            </Title>
          </Group>
          <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="0.5rem">
          <Stack gap="0.5rem">
            <Text>{t('description')}</Text>
            {capped && (
              <Text c="var(--mantine-color-orange-filled)" size="sm">
                {t('cappedWarning')}
              </Text>
            )}
            <Accordion multiple defaultValue={[defaultOpened]} variant="separated">
              {hasOverMax && (
                <Accordion.Item value="overMax">
                  <Accordion.Control>
                    {formatStringJson(t('overMaxSection'), { max: maxFilesPerFolder })}
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Box>
                      <FileList
                        rows={overMaxRows}
                        selected={selected}
                        stats={stats}
                        maxFilesPerFolder={maxFilesPerFolder}
                        largeFileMaxCount={largeFileMaxCount}
                        largeOnly={false}
                        onToggleFile={onToggleFile}
                      />
                    </Box>
                  </Accordion.Panel>
                </Accordion.Item>
              )}
              {hasOverLarge && (
                <Accordion.Item value="overLarge">
                  <Accordion.Control>
                    {formatStringJson(t('overLargeSection'), {
                      count: largeFileMaxCount + 1,
                      size: formatFileSize(largeFileSize),
                    })}
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Box>
                      <FileList
                        rows={overLargeRows}
                        selected={selected}
                        stats={stats}
                        maxFilesPerFolder={maxFilesPerFolder}
                        largeFileMaxCount={largeFileMaxCount}
                        largeOnly
                        onToggleFile={onToggleFile}
                      />
                    </Box>
                  </Accordion.Panel>
                </Accordion.Item>
              )}
            </Accordion>
          </Stack>
        </Modal.Body>

        <Divider />

        <Group p="0.5rem" justify="space-between" wrap="nowrap">
          <Button onClick={onClickCancel} color="red">
            {t('common:button.cancel')}
          </Button>
          <Button onClick={onClickUpload} disabled={hasViolation || result.length === 0}>
            {t('upload')} ({result.length})
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
