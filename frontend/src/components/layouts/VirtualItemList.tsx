import { Box } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ReactNode, useState } from 'react';

const LIST_MAX_HEIGHT = 260;

type VirtualItemListProps = {
  ids: string[];
  // Gap between two items, in px.
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

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => listElement,
    estimateSize: () => itemHeight,
    getItemKey: idx => ids[idx],
    gap,
    overscan: 5,
  });

  return (
    <Box ref={setListElement} p="8px" style={{ maxHeight: `${LIST_MAX_HEIGHT}px`, overflow: 'auto' }}>
      <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
        {virtualizer.getVirtualItems().map(row => (
          <div
            key={row.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: itemHeight,
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
