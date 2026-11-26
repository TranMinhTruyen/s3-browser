import { Center, Divider, Group, Loader, Stack, Tabs, Text } from '@mantine/core';
import type { StatementResult } from '@wails/S3Browser/models';
import { ChevronsLeftRight } from 'lucide-react';
import { type ChangeEvent, memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';
import DataGrid, { type DataGridHandle } from '@/components/display/dataGrid/DataGrid';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import SqlMessageList from '@/pages/sql/components/sqlResult/SqlMessageList';
import { canLoadMore } from '@/pages/sql/hooks/useSqlRunner';

const MESSAGES_TAB = 'messages';
const NOOP_FETCH_ALL_CHANGE = () => {};

type ResultGridProps = {
  statement: StatementResult;
  /** Chỉ câu lệnh cuối của một lượt chạy có con trỏ nên chỉ câu đó mới tải thêm hàng được. */
  loadingMore: boolean;
  onLoadMore: () => void;
  fetchAll: boolean;
  fetchAllAvailable: boolean;
  onChangeFetchAll: (checked: boolean) => void;
};

/** Các hàng của một SELECT, kèm ghi chú nếu chỉ giữ lại các hàng đầu hoặc đang tải thêm. */
const ResultGrid = memo(function ResultGrid({
  statement,
  loadingMore,
  fetchAll,
  fetchAllAvailable,
  onLoadMore,
  onChangeFetchAll,
}: ResultGridProps) {
  const { t, i18n } = useTranslation('sqlTab');
  const { t: tTableStructure } = useTranslation('tableStructure');
  const secondsFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
    [i18n.language]
  );
  const columns = useMemo(() => statement.columns.map(column => column.name), [statement.columns]);
  const hasMore = canLoadMore(statement);
  const fetchAllId = useId();
  const fetchAllDisabled = !fetchAll && (!hasMore || !fetchAllAvailable || loadingMore);
  const copyLabels = useMemo(() => ({ copy: t('result.copy'), copyWithHeaders: t('result.copyWithHeaders') }), [t]);
  // Hiện "+" khi con trỏ vẫn còn hàng để đọc, tương tự tab Messages.
  const loadedRowsText = tTableStructure('loadedRows', {
    total: statement.rows.length.toLocaleString(i18n.language),
  });
  const elapsedText = t('message.elapsed', { seconds: secondsFormat.format(statement.elapsedMs / 1000) });
  const gridRef = useRef<DataGridHandle>(null);
  const onClickFitColumns = useCallback(() => gridRef.current?.fitColumns(), []);
  const onChangeFetchAllCheckbox = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChangeFetchAll(event.currentTarget.checked),
    [onChangeFetchAll]
  );

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
        <Group gap="0.5rem" ml="auto" pr="0.25rem" wrap="nowrap">
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {loadedRowsText}
          </Text>
          {fetchAll && loadingMore ? <Loader size="1rem" /> : null}
          <Group gap="0.375rem" wrap="nowrap">
            <CheckBoxInput
              id={fetchAllId}
              size="xs"
              checked={fetchAll}
              disabled={fetchAllDisabled}
              onChange={onChangeFetchAllCheckbox}
            />
            <Text
              component="label"
              htmlFor={fetchAllId}
              size="xs"
              c="dimmed"
              style={{ cursor: fetchAllDisabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
            >
              {tTableStructure('fetchAll')}
            </Text>
          </Group>
          <Text size="xs" style={{ whiteSpace: 'nowrap' }}>
            {elapsedText}
          </Text>
        </Group>
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
  fetchAll?: boolean;
  onLoadMore: () => void;
  onChangeFetchAll?: (checked: boolean) => void;
};

/**
 * Kết quả của lượt chạy gần nhất: mỗi SELECT có một tab (Result 1..n) và có thêm tab Messages. Đặt `key` riêng cho từng lượt
 * để tab được chọn trở về kết quả cuối (hoặc Messages nếu lượt chạy thất bại hay không trả về hàng nào).
 */
function SqlResultPanel(props: SqlResultPanelProps) {
  const { statements, cancelled, running, loadingMore, onLoadMore } = props;
  const fetchAll = props.fetchAll ?? false;
  const onChangeFetchAll = props.onChangeFetchAll ?? NOOP_FETCH_ALL_CHANGE;
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
    // Dùng display-none, không dùng Activity: Activity gỡ effect của panel bị ẩn (DataGrid sẽ chạy lại chúng).
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

      {results.map(({ statement, index }) => {
        const fetchAllAvailable = index === statements.length - 1;
        return (
          <Tabs.Panel key={index} value={String(index)} flex={1} style={{ minHeight: 0 }}>
            <ResultGrid
              statement={statement}
              loadingMore={loadingMore}
              fetchAll={fetchAll && fetchAllAvailable}
              fetchAllAvailable={fetchAllAvailable}
              onLoadMore={onLoadMore}
              onChangeFetchAll={onChangeFetchAll}
            />
          </Tabs.Panel>
        );
      })}
      <Tabs.Panel value={MESSAGES_TAB} flex={1} style={{ minHeight: 0 }}>
        <SqlMessageList statements={statements} cancelled={cancelled} />
      </Tabs.Panel>
    </Tabs>
  );
}
export default memo(SqlResultPanel);
