import { Box, Group, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { StatementResult } from '@wails/S3Browser/models';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import TruncatedText from '@/components/display/TruncatedText';
import { canLoadMore } from '@/pages/sql/hooks/useSqlRunner';
import { truncateSql } from '@/pages/sql/utils/sqlToast';

// Row height at the medium interface size, scaled by `useUiScale`; rows are measured, this is only the first guess.
const ESTIMATED_ROW_HEIGHT = 56;

type SqlMessageListProps = {
  statements: StatementResult[];
  /** The run was canceled before it finished. */
  cancelled: boolean;
};

/** Messages of a run: per statement its text, the outcome and the time; a failed statement shows the error. */
function SqlMessageList({ statements, cancelled }: SqlMessageListProps) {
  const { t } = useTranslation('sqlTab');
  const scrollRef = useRef<HTMLDivElement>(null);
  const scale = useUiScale();

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: statements.length + (cancelled ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT * scale,
    overscan: 5,
  });
  useRemeasureOnScale(virtualizer, scale);

  return (
    <div ref={scrollRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(row => {
          const statement = statements[row.index];
          return (
            <Box
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              px="0.5rem"
              py="0.25rem"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
                borderBottom: '1px solid var(--mantine-color-default-border)',
              }}
            >
              {statement ? (
                <>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                      {`#${row.index + 1}`}
                    </Text>
                    <TruncatedText size="sm" ff="monospace">
                      {truncateSql(statement.sql).replace(/\s+/g, ' ')}
                    </TruncatedText>
                  </Group>
                  {statement.error ? (
                    <Text size="sm" c="var(--mantine-color-red-light-color)" style={{ overflowWrap: 'anywhere' }}>
                      {`${t(`ipcMessage:db.${statement.error.code}`)}: ${statement.error.message}`}
                    </Text>
                  ) : (
                    <Text size="sm">
                      {`${
                        statement.kind === 'rows'
                          ? t('message.rowsReturned', {
                              n: `${statement.rows.length}${canLoadMore(statement) ? '+' : ''}`,
                            })
                          : t('message.rowsAffected', { n: statement.rowsAffected })
                      } · ${t('message.elapsed', { ms: statement.elapsedMs })}`}
                    </Text>
                  )}
                </>
              ) : (
                <Text size="sm" c="dimmed">
                  {t('message.cancelled')}
                </Text>
              )}
            </Box>
          );
        })}
      </div>
    </div>
  );
}
export default memo(SqlMessageList);
