import { Center, Divider, Group, Loader, Stack, Tabs, Text } from '@mantine/core';
import type { StatementResult } from '@wails/S3Browser/models';
import { ChevronsLeftRight } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';
import DataGrid, { type DataGridHandle } from '@/components/display/dataGrid/DataGrid';
import SqlMessageList from '@/pages/sql/components/sqlResult/SqlMessageList';
import { canLoadMore } from '@/pages/sql/hooks/useSqlRunner';

const MESSAGES_TAB = 'messages';

type ResultGridProps = {
  statement: StatementResult;
  /** Only the last statement of a run has a cursor, so only it can load more rows. */
  loadingMore: boolean;
  onLoadMore: () => void;
};

/** Rows of one SELECT, with a note when only its first rows were kept or more are being loaded. */
const ResultGrid = memo(function ResultGrid({ statement, loadingMore, onLoadMore }: ResultGridProps) {
  const { t, i18n } = useTranslation('sqlTab');
  const secondsFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
    [i18n.language]
  );
  const columns = useMemo(() => statement.columns.map(column => column.name), [statement.columns]);
  const hasMore = canLoadMore(statement);
  const copyLabels = useMemo(() => ({ copy: t('result.copy'), copyWithHeaders: t('result.copyWithHeaders') }), [t]);
  // "+" while the cursor still has rows to read, like the Messages tab.
  const rowsText = t('message.rowsReturned', { n: `${statement.rows.length}${hasMore ? '+' : ''}` });
  const summary = `${rowsText} · ${t('message.elapsed', { seconds: secondsFormat.format(statement.elapsedMs / 1000) })}`;
  const gridRef = useRef<DataGridHandle>(null);
  const onClickFitColumns = useCallback(() => gridRef.current?.fitColumns(), []);

  return (
    <Stack gap={0} h="100%">
      {/* Toolbar of the result: buttons on the left, row count and time on the right (same text as Messages). */}
      <Group gap="0.25rem" p="0.25rem" wrap="nowrap" style={{ flexShrink: 0 }}>
        <ActionIcon
          size="md"
          tooltip={t('result.fitColumns')}
          disabled={columns.length === 0 || statement.rows.length === 0}
          onClick={onClickFitColumns}
        >
          <ChevronsLeftRight size="1rem" />
        </ActionIcon>
        <Text size="xs" ml="auto" pr="0.25rem" style={{ whiteSpace: 'nowrap' }}>
          {summary}
        </Text>
      </Group>
      <Divider />
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          ref={gridRef}
          columns={columns}
          rows={statement.rows}
          nullText={t('result.nullValue')}
          copyLabels={copyLabels}
          hasMore={hasMore}
          loading={loadingMore}
          onEndReached={onLoadMore}
        />
      </div>
      {statement.truncated || (hasMore && loadingMore) ? (
        <Text size="xs" c="dimmed" px="0.5rem" py="0.25rem" style={{ flexShrink: 0 }}>
          {statement.truncated ? t('result.firstRowsOnly', { count: statement.rows.length }) : t('result.loading')}
        </Text>
      ) : null}
    </Stack>
  );
});

type SqlResultPanelProps = {
  statements: StatementResult[];
  cancelled: boolean;
  running: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

/**
 * Results of the last run: a tab per SELECT (Result 1..n) and a Messages tab. Give it a `key` per run so the
 * selected tab starts again at the last result (or Messages when the run failed or returned no rows).
 */
function SqlResultPanel(props: SqlResultPanelProps) {
  const { statements, cancelled, running, loadingMore, onLoadMore } = props;
  const { t } = useTranslation('sqlTab');

  const results = useMemo(
    () =>
      statements.flatMap((statement, index) =>
        statement.kind === 'rows' && !statement.error ? [{ statement, index }] : []
      ),
    [statements]
  );
  const [tab, setTab] = useState(() =>
    results.length > 0 && !statements[statements.length - 1]?.error
      ? String(results[results.length - 1].index)
      : MESSAGES_TAB
  );

  const onChangeTab = useCallback((value: string | null) => {
    if (value) setTab(value);
  }, []);

  if (statements.length === 0 && !cancelled) {
    return running ? (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    ) : null;
  }

  return (
    // display-none, not Activity: Activity tears down the effects of a hidden panel (DataGrid would re-run them)
    <Tabs
      value={tab}
      onChange={onChangeTab}
      keepMountedMode="display-none"
      h="100%"
      display="flex"
      style={{ flexDirection: 'column' }}
    >
      <Tabs.List style={{ flexShrink: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
        {results.map(({ index }, order) => (
          <Tabs.Tab key={index} value={String(index)}>
            {t('result.title', { n: order + 1 })}
          </Tabs.Tab>
        ))}
        <Tabs.Tab value={MESSAGES_TAB}>{t('result.messages')}</Tabs.Tab>
      </Tabs.List>

      {results.map(({ statement, index }) => (
        <Tabs.Panel key={index} value={String(index)} flex={1} style={{ minHeight: 0 }}>
          <ResultGrid statement={statement} loadingMore={loadingMore} onLoadMore={onLoadMore} />
        </Tabs.Panel>
      ))}
      <Tabs.Panel value={MESSAGES_TAB} flex={1} style={{ minHeight: 0 }}>
        <SqlMessageList statements={statements} cancelled={cancelled} />
      </Tabs.Panel>
    </Tabs>
  );
}
export default memo(SqlResultPanel);
