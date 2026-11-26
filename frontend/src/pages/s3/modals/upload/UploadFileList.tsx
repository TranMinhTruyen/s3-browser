import { Badge, Group, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DroppedFile, DroppedGroup } from '@wails/S3Browser/models/bucket';
import { Folder, Trash2 } from 'lucide-react';
import {
  ChangeEvent,
  CSSProperties,
  createContext,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import { tintedColor } from '@/common/theme/tintedColor';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import TruncatedText from '@/components/display/TruncatedText';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';

/** Tiêu đề nhóm hoặc một file trong nhóm như hiển thị ở danh sách file tải lên. */
export type UploadRow = { kind: 'group'; index: number; group: DroppedGroup } | { kind: 'file'; file: DroppedFile };

/** Số file / file lớn trong nhóm hiện được đánh dấu. */
export type GroupStat = { selected: number; selectedLarge: number };

// Chiều cao hàng theo px ở cỡ trung bình; được co giãn theo cỡ giao diện.
const ROW_HEIGHT = 36;

// Đoạn cuối của đường dẫn; Windows dùng "\", các hệ điều hành khác dùng "/".
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

// Tỷ lệ giao diện, chỉ đọc một lần trong VirtualRowList để từng hàng không phải đăng ký theo dõi setting store.
const RowScaleContext = createContext(1);

// Vị trí tuyệt đối của hàng trong danh sách ảo. Các hàng được ghi nhớ để `memo` tiếp tục có tác dụng
// (tạo object style mới ở mỗi lần render sẽ làm mất tác dụng đó).
const useRowStyle = (top: number): CSSProperties => {
  const scale = useContext(RowScaleContext);
  return useMemo(
    () => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: ROW_HEIGHT * scale,
      transform: `translateY(${top}px)`,
    }),
    [top, scale]
  );
};

type GroupRowProps = {
  group: DroppedGroup;
  // Độ lệch của hàng trong danh sách ảo.
  top: number;
  rootLabel: string;
  // Nội dung bộ đếm; bộ đếm bị ẩn khi chưa có nội dung.
  largeText?: string;
  countText?: string;
  // Vượt giới hạn: làm nổi bật bộ đếm.
  largeOver?: boolean;
  countOver?: boolean;
};

/** Dòng tiêu đề nhóm (thư mục), có thể kèm bộ đếm file lớn và tổng số file. */
export const GroupRow = memo(function GroupRow(props: GroupRowProps) {
  const { group, top, rootLabel, largeText, countText, largeOver, countOver } = props;
  const style = useRowStyle(top);

  return (
    <Group style={style} gap="xs" wrap="nowrap" px="xs" bg="var(--mantine-color-default-hover)">
      <Folder size="1rem" style={{ flexShrink: 0 }} />
      <TruncatedText fw={600} style={{ flex: 1, minWidth: 0 }}>
        {group.name || rootLabel}
      </TruncatedText>
      {largeText && (
        <Text
          size="sm"
          c={largeOver ? 'var(--mantine-color-red-filled)' : 'dimmed'}
          fw={largeOver ? 600 : undefined}
          style={{ flexShrink: 0 }}
        >
          {largeText}
        </Text>
      )}
      {countText && (
        <Text
          size="sm"
          c={countOver ? 'var(--mantine-color-red-filled)' : 'dimmed'}
          fw={countOver ? 600 : undefined}
          style={{ flexShrink: 0 }}
        >
          {countText}
        </Text>
      )}
    </Group>
  );
});

type FileRowProps = {
  file: DroppedFile;
  checked: boolean;
  // Độ lệch của hàng trong danh sách ảo.
  top: number;
  largeLabel: string;
  // Đường dẫn được hiển thị dưới dạng tooltip cho tên file.
  titleBy: 'path' | 'relKey';
  onToggleFile: (path: string, checked: boolean) => void;
  // Hiện nút xóa khi được thiết lập (cần removeLabel để làm tooltip).
  onRemoveFile?: (path: string) => void;
  removeLabel?: string;
};

/** Dòng của một file: checkbox, tên, nhãn file lớn, dung lượng và nút xóa tùy chọn. */
export const FileRow = memo(function FileRow(props: FileRowProps) {
  const { file, checked, top, largeLabel, titleBy, onToggleFile, onRemoveFile, removeLabel } = props;
  const style = useRowStyle(top);

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
          <TruncatedText span label={file[titleBy]} alwaysTip style={{ display: 'block' }}>
            {baseName(file.relKey)}
          </TruncatedText>
        }
        styles={{ root: { flex: 1, minWidth: 0 }, body: { minWidth: 0 }, labelWrapper: { minWidth: 0 } }}
      />
      {file.isLarge && (
        <Badge color="var(--mantine-color-orange-6)" variant="light" style={{ flexShrink: 0 }}>
          {largeLabel}
        </Badge>
      )}
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {formatFileSize(file.size)}
      </Text>
      {onRemoveFile && removeLabel && (
        <ActionIcon size="sm" {...tintedColor('red', 'ai')} onClick={onClickRemove} tooltip={removeLabel}>
          <Trash2 size="0.875rem" />
        </ActionIcon>
      )}
    </Group>
  );
});

type VirtualRowListProps = {
  rows: UploadRow[];
  // Chiều cao vùng cuộn (giá trị CSS).
  height: string | number;
  // Render một hàng; `top` là độ lệch của hàng trong danh sách ảo.
  renderRow: (row: UploadRow, key: string | number | bigint, top: number) => ReactNode;
};

/** Danh sách cuộn ảo gồm các hàng nhóm/file; nơi gọi quyết định cách vẽ từng hàng. */
export const VirtualRowList = memo(function VirtualRowList(props: VirtualRowListProps) {
  const { rows, height, renderRow } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scale = useUiScale();

  // React Compiler đang tắt nên quy tắc lint chỉ dành cho compiler này không áp dụng.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT * scale,
    getItemKey: idx => {
      const row = rows[idx];
      return row.kind === 'group' ? `g:${row.index}` : `f:${row.file.path}`;
    },
    overscan: 8,
  });
  useRemeasureOnScale(virtualizer, scale);

  return (
    <RowScaleContext.Provider value={scale}>
      <div ref={scrollRef} style={{ height, overflow: 'auto', position: 'relative' }}>
        <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
          {virtualizer.getVirtualItems().map(item => renderRow(rows[item.index], item.key, item.start))}
        </div>
      </div>
    </RowScaleContext.Provider>
  );
});

/** Chiều cao theo px của `count` hàng ở cỡ trung bình, dùng cho danh sách co theo nội dung. */
export const rowsHeight = (count: number) => count * ROW_HEIGHT;
