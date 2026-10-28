import { Badge, Group, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DroppedFile, DroppedGroup } from '@wails/S3Browser/models/bucket';
import { Trash2 } from 'lucide-react';
import { ChangeEvent, CSSProperties, memo, ReactNode, useCallback, useRef } from 'react';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';

/** A group header or a file of a group, as shown in the upload file lists. */
export type UploadRow = { kind: 'group'; index: number; group: DroppedGroup } | { kind: 'file'; file: DroppedFile };

/** How many files / large files of a group are currently ticked. */
export type GroupStat = { selected: number; selectedLarge: number };

const ROW_HEIGHT = 36;

// Last path segment; paths use "\" on Windows and "/" elsewhere.
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

type FileRowProps = {
  file: DroppedFile;
  checked: boolean;
  style: CSSProperties;
  largeLabel: string;
  // Which path is shown as the tooltip of the file name.
  titleBy: 'path' | 'relKey';
  onToggleFile: (path: string, checked: boolean) => void;
  // Shows a remove button when set.
  onRemoveFile?: (path: string) => void;
  removeLabel?: string;
};

/** One file line: checkbox with name, large badge, size and an optional remove button. */
export const FileRow = memo(function FileRow(props: FileRowProps) {
  const { file, checked, style, largeLabel, titleBy, onToggleFile, onRemoveFile, removeLabel } = props;

  const onChangeFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onToggleFile(file.path, e.currentTarget.checked),
    [onToggleFile, file.path]
  );

  const onClickRemove = useCallback(() => onRemoveFile?.(file.path), [onRemoveFile, file.path]);

  return (
    <Group style={style} gap="xs" wrap="nowrap" px="xs">
      <CheckBoxInput
        checked={checked}
        onChange={onChangeFile}
        label={
          <Text span truncate="end" title={file[titleBy]} style={{ display: 'block' }}>
            {baseName(file.relKey)}
          </Text>
        }
        styles={{ root: { flex: 1, minWidth: 0 }, body: { minWidth: 0 }, labelWrapper: { minWidth: 0 } }}
      />
      {file.isLarge && (
        <Badge color="orange" variant="light" style={{ flexShrink: 0 }}>
          {largeLabel}
        </Badge>
      )}
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {formatFileSize(file.size)}
      </Text>
      {onRemoveFile && (
        <ActionIcon size="sm" color="red" onClick={onClickRemove} aria-label={removeLabel} title={removeLabel}>
          <Trash2 size="14px" />
        </ActionIcon>
      )}
    </Group>
  );
});

type VirtualRowListProps = {
  rows: UploadRow[];
  // Scroll area height (CSS value).
  height: string | number;
  // Renders one row; `style` positions it inside the virtual list.
  renderRow: (row: UploadRow, key: string | number | bigint, style: CSSProperties) => ReactNode;
};

/** Virtualized scroll list of group/file rows; the caller decides how each row is drawn. */
export const VirtualRowList = memo(function VirtualRowList(props: VirtualRowListProps) {
  const { rows, height, renderRow } = props;

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
    <div ref={scrollRef} style={{ height, overflow: 'auto', position: 'relative' }}>
      <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
        {virtualizer.getVirtualItems().map(item =>
          renderRow(rows[item.index], item.key, {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: ROW_HEIGHT,
            transform: `translateY(${item.start}px)`,
          })
        )}
      </div>
    </div>
  );
});

/** Height of `count` rows, for lists that shrink to their content. */
export const rowsHeight = (count: number) => count * ROW_HEIGHT;
