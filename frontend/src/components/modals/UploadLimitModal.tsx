import { Accordion, Badge, Box, Divider, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DroppedFile, DroppedGroup } from '@wails/S3Browser/models/bucket';
import { Folder, TriangleAlert } from 'lucide-react';
import { ChangeEvent, CSSProperties, memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatFileSize, formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import { WARNING_BG_COLOR, WARNING_COLOR } from '@/components/modals/modalColors';

type UploadLimitModalProps = ModalProps & {
  groups: DroppedGroup[];
  // Max files per group.
  maxFilesPerFolder: number;
  // Size in bytes above which a file counts as large.
  largeFileSize: number;
  // A group may upload at most this many large files.
  largeFileMaxCount: number;
  // The folder scan stopped early, so the list may be incomplete.
  capped?: boolean;
};

type Row = { kind: 'group'; index: number; group: DroppedGroup } | { kind: 'file'; file: DroppedFile };

type GroupStat = { selected: number; selectedLarge: number };

type FileListProps = {
  rows: Row[];
  selected: ReadonlySet<string>;
  stats: GroupStat[];
  maxFilesPerFolder: number;
  largeFileMaxCount: number;
  // The section only counts large files, so the header shows the large-file counter.
  largeOnly: boolean;
  onToggleFile: (path: string, checked: boolean) => void;
};

const ROW_HEIGHT = 36;
const LIST_MAX_HEIGHT = 320;

// Last path segment; dropped paths use "\" on Windows and "/" elsewhere.
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

type FileRowProps = {
  file: DroppedFile;
  checked: boolean;
  style: CSSProperties;
  onToggleFile: (path: string, checked: boolean) => void;
};

const FileRow = memo(function FileRow(props: FileRowProps) {
  const { file, checked, style, onToggleFile } = props;
  const { t } = useTranslation('uploadLimitModal');

  const onChangeFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onToggleFile(file.path, e.currentTarget.checked),
    [onToggleFile, file.path]
  );

  return (
    <Group style={style} gap="xs" wrap="nowrap" px="xs">
      <CheckBoxInput
        checked={checked}
        onChange={onChangeFile}
        label={
          <Text span truncate="end" title={file.relKey} style={{ display: 'block' }}>
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
    </Group>
  );
});

const FileList = memo(function FileList(props: FileListProps) {
  const { rows, selected, stats, maxFilesPerFolder, largeFileMaxCount, largeOnly, onToggleFile } = props;
  const { t } = useTranslation('uploadLimitModal');

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
    <div
      ref={scrollRef}
      style={{ height: Math.min(rows.length * ROW_HEIGHT, LIST_MAX_HEIGHT), overflow: 'auto', position: 'relative' }}
    >
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

          if (row.kind === 'group') {
            const stat = stats[row.index];
            const over = largeOnly ? stat.selectedLarge > largeFileMaxCount : stat.selected > maxFilesPerFolder;
            return (
              <Group
                key={item.key}
                style={style}
                gap="xs"
                wrap="nowrap"
                px="xs"
                bg="var(--mantine-color-default-hover)"
              >
                <Folder size="16px" style={{ flexShrink: 0 }} />
                <Text fw={600} truncate="end" style={{ flex: 1, minWidth: 0 }} title={row.group.name}>
                  {row.group.name || t('rootFolder')}
                </Text>
                <Text size="sm" c={over ? 'red' : 'dimmed'} fw={over ? 600 : undefined} style={{ flexShrink: 0 }}>
                  {largeOnly
                    ? formatStringJson(t('selectedLarge'), { selected: stat.selectedLarge, max: largeFileMaxCount })
                    : formatStringJson(t('selectedCount'), { selected: stat.selected, max: maxFilesPerFolder })}
                </Text>
              </Group>
            );
          }

          return (
            <FileRow
              key={item.key}
              file={row.file}
              checked={selected.has(row.file.path)}
              style={style}
              onToggleFile={onToggleFile}
            />
          );
        })}
      </div>
    </div>
  );
});

/** Lets the user pick the files to upload; resolves the chosen files (empty or null when canceled). */
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

  // Groups over a limit need a choice; the others are uploaded in full.
  const violating = useMemo(() => groups.map(g => g.overMaxFiles || g.overLargeCount), [groups]);

  // Default: the first `max` files per violating group, with at most `largeFileMaxCount` large ones.
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
    const rows: Row[] = [];
    groups.forEach((group, index) => {
      if (!group.overMaxFiles) return;
      rows.push({ kind: 'group', index, group });
      for (const file of group.files) rows.push({ kind: 'file', file });
    });
    return rows;
  }, [groups]);

  const overLargeRows = useMemo(() => {
    const rows: Row[] = [];
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
          <Modal.CloseButton size="md" />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Stack gap="8px">
            <Text>{t('description')}</Text>
            {capped && (
              <Text c="orange" size="sm">
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

        <Group p="8px" justify="space-between">
          <Button onClick={onClickUpload} disabled={hasViolation || result.length === 0}>
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
