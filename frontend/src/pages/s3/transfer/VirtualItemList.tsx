import { Box } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ReactNode, useState } from 'react';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';

const LIST_MAX_HEIGHT = '16.25rem';

type VirtualItemListProps = {
  ids: string[];
  // Gap between two items and item height, in px at the medium size; scaled with the interface size.
  gap: number;
  itemHeight: number;
  renderItem: (id: string) => ReactNode;
};

/** Virtualized, scrollable list of transfer items shared by the uploader and downloader windows. */
function VirtualItemList(props: VirtualItemListProps) {
  const { ids, gap, itemHeight, renderItem } = props;

  // State, not a ref: Affix renders through a Portal that mounts one render late, so a ref would still be null
  // when the virtualizer reads it and nothing would re-render it, leaving the list empty.
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const scale = useUiScale();
  const scaledGap = gap * scale;
  const scaledHeight = itemHeight * scale;

  // React Compiler is disabled, so this compiler-only lint does not apply.
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
    <Box ref={setListElement} p="8px" style={{ maxHeight: LIST_MAX_HEIGHT, overflow: 'auto' }}>
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
