import { Card, Text, Tooltip } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { File, Folder } from 'lucide-react';
import { CSSProperties, memo, useCallback, useState } from 'react';

const LIST_MAX_HEIGHT = 320;
// One-line card plus its gap; the real height is measured, as names and reasons may wrap.
const ROW_ESTIMATE_HEIGHT = 56;
const ROW_GAP = 8;
// Same border as the cards of the object list.
const CARD_BORDER_COLOR = 'light-dark(var(--mantine-color-black), var(--mantine-color-dark-2))';

export type DeleteKeyRow = {
  key: string;
  // Why the key failed.
  error?: string;
};

type DeleteKeyListProps = {
  rows: DeleteKeyRow[];
  maxHeight?: number;
};

// Long S3 keys have no spaces, so text breaks anywhere; nothing may widen the list (no horizontal scroll).
const wrapStyle: CSSProperties = { overflowWrap: 'anywhere', wordBreak: 'break-word' };
const ICON_SECTION_STYLE: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderColor: CARD_BORDER_COLOR,
};
const NAME_SECTION_STYLE: CSSProperties = { flex: 1, minWidth: 0 };

/** Last path segment of a key; a folder key ends with "/" and keeps it out of the name. */
const getKeyName = (key: string) => key.replace(/\/$/, '').split('/').pop() || key;

/** Virtualized, vertically scrollable list of cards, one per key (and why it failed). Text wraps, never scrolls sideways. */
const DeleteKeyList = memo(function DeleteKeyList(props: DeleteKeyListProps) {
  const { rows, maxHeight = LIST_MAX_HEIGHT } = props;

  // State, not a ref: inside a Modal portal the element mounts one render late.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  const getScrollElement = useCallback(() => scrollElement, [scrollElement]);
  const estimateSize = useCallback(() => ROW_ESTIMATE_HEIGHT, []);

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement,
    estimateSize,
    overscan: 10,
  });

  return (
    <div
      ref={setScrollElement}
      style={{ maxHeight, overflowX: 'hidden', overflowY: 'auto', scrollbarGutter: 'stable' }}
    >
      <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index];
          const isFolder = row.key.endsWith('/');
          const name = getKeyName(row.key);
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
                paddingBottom: ROW_GAP,
              }}
            >
              <Card padding="8px" orientation="horizontal" style={{ border: `1px solid ${CARD_BORDER_COLOR}` }}>
                <Card.Section inheritPadding px="8px" withBorder style={ICON_SECTION_STYLE}>
                  {isFolder ? <Folder size="20px" /> : <File size="20px" />}
                </Card.Section>
                <Card.Section inheritPadding px="md" py="xs" style={NAME_SECTION_STYLE}>
                  {/* The full key is the hint when the name alone does not tell it. */}
                  <Tooltip label={row.key} disabled={name === row.key} openDelay={400}>
                    <Text fw={500} style={wrapStyle}>
                      {name}
                    </Text>
                  </Tooltip>
                  {row.error !== undefined && (
                    <Text
                      size="sm"
                      c="light-dark(var(--mantine-color-red-7), var(--mantine-color-red-4))"
                      style={wrapStyle}
                    >
                      {row.error}
                    </Text>
                  )}
                </Card.Section>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
});
export default DeleteKeyList;
