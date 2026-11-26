import { Box } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ReactNode, useState } from 'react';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';

const LIST_MAX_HEIGHT = '16.25rem';

type VirtualItemListProps = {
  ids: string[];
  // Khoảng cách giữa hai mục và chiều cao mục, tính bằng px ở cỡ trung bình; co giãn theo cỡ giao diện.
  gap: number;
  itemHeight: number;
  renderItem: (id: string) => ReactNode;
};

/** Danh sách mục truyền file có thể cuộn và ảo hóa, dùng chung cho cửa sổ tải lên và tải xuống. */
function VirtualItemList(props: VirtualItemListProps) {
  const { ids, gap, itemHeight, renderItem } = props;

  // Dùng state thay vì ref: Affix render qua Portal và mount chậm một lần render, nên ref vẫn null
  // khi virtualizer đọc; do không có lần render lại, danh sách sẽ trống.
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const scale = useUiScale();
  const scaledGap = gap * scale;
  const scaledHeight = itemHeight * scale;

  // React Compiler đang tắt nên quy tắc lint chỉ dành cho compiler này không áp dụng.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => listElement,
    estimateSize: () => scaledHeight,
    getItemKey: idx => ids[idx],
    gap: scaledGap,
    overscan: 5,
  });
  useRemeasureOnScale(virtualizer, scale);

  return (
    <Box ref={setListElement} p="0.5rem" style={{ maxHeight: LIST_MAX_HEIGHT, overflow: 'auto' }}>
      <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
        {virtualizer.getVirtualItems().map(row => (
          <div
            key={row.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: scaledHeight,
              transform: `translateY(${row.start}px)`,
            }}
          >
            {renderItem(ids[row.index])}
          </div>
        ))}
      </div>
    </Box>
  );
}
export default VirtualItemList;
