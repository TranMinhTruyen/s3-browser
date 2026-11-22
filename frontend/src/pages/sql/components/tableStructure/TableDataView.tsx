import { Center, Loader, Stack, Text } from '@mantine/core';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import DataGrid from '@/components/display/dataGrid/DataGrid';
import { useTableRows } from '@/pages/sql/hooks/useTableRows';
import type { Provider } from '@/pages/sql/stores/dbProfileStore';

type TableDataViewProps = {
  tabId: string;
  provider: Provider;
  profileId: string;
  schema: string;
  table: string;
};

/** Read-only rows of a table; the next page loads when the grid is scrolled near the end. */
function TableDataView({ tabId, provider, profileId, schema, table }: TableDataViewProps) {
  const { t } = useTranslation('tableStructure');
  const { columns, rows, hasMore, loading, loadingMore, loadMore } = useTableRows(
    tabId,
    provider,
    profileId,
    schema,
    table
  );

  if (loading) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  return (
    <Stack gap={0} h="100%">
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          columns={columns}
          rows={rows}
          nullText={t('nullValue')}
          hasMore={hasMore}
          loading={loadingMore}
          onEndReached={loadMore}
        />
      </div>
      {loadingMore ? (
        <Text size="xs" c="dimmed" px="0.5rem" py="0.25rem" style={{ flexShrink: 0 }}>
          {t('loadingMore')}
        </Text>
      ) : null}
    </Stack>
  );
}

export default memo(TableDataView);
