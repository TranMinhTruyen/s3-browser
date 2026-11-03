import { Box } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CSSProperties, memo, useCallback, useState } from 'react';

const LIST_MAX_HEIGHT = 320;
// One-line row; the real height is measured, as names and reasons may wrap.
const ROW_ESTIMATE_HEIGHT = 32;
const BORDER = '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))';

export type KeyTableRow = {
  key: string;
  // Why the key failed; the reason column shows up once any row has it.
  error?: string;
};

type KeyTableProps = {
  rows: KeyTableRow[];
  keyLabel: string;
  errorLabel?: string;
  maxHeight?: number;
};

// Long S3 keys have no spaces, so cells break anywhere; nothing may widen the table (no horizontal scroll).
const cellStyle: CSSProperties = {
  minWidth: 0,
  padding: '4px 8px',
  fontSize: 'var(--mantine-font-size-sm)',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

/** Virtualized, vertically scrollable table of keys (and optionally why each failed). Cells wrap, never scroll sideways. */
const KeyTable = memo(function KeyTable(props: KeyTableProps) {
  const { rows, keyLabel, errorLabel, maxHeight = LIST_MAX_HEIGHT } = props;

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

  const hasError = rows.some(row => row.error !== undefined);
  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: hasError ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
  };

  return (
    <Box role="table" style={{ overflowX: 'hidden' }}>
      <div
        role="row"
        style={{
          ...gridStyle,
          overflowY: 'hidden',
          scrollbarGutter: 'stable',
          fontWeight: 600,
          borderBottom: BORDER,
          backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))',
        }}
      >
        <div role="columnheader" style={cellStyle}>
          {keyLabel}
        </div>
        {hasError && (
          <div role="columnheader" style={cellStyle}>
            {errorLabel}
          </div>
        )}
      </div>
      <div
        ref={setScrollElement}
        style={{ maxHeight, overflowX: 'hidden', overflowY: 'auto', scrollbarGutter: 'stable' }}
      >
        <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(item => {
            const row = rows[item.index];
            return (
              <div
                key={item.key}
                role="row"
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  ...gridStyle,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                  borderBottom: BORDER,
                }}
              >
                <div role="cell" style={cellStyle}>
                  {row.key}
                </div>
                {hasError && (
                  <div role="cell" style={{ ...cellStyle, color: 'var(--mantine-color-red-filled)' }}>
                    {row.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Box>
  );
});
export default KeyTable;
