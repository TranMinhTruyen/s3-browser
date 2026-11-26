import { Center, Code, Loader, Paper, Tabs, Text } from '@mantine/core';
import type { TableInfoOutput } from '@wails/S3Browser/models';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DataGrid from '@/components/display/dataGrid/DataGrid';
import TableDataView from '@/pages/sql/components/tableStructure/TableDataView';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { loadTableInfo } from '@/pages/sql/utils/dbObjectSource';
import { toColumnRows, toConstraintRows, toForeignKeyRows, toIndexRows } from '@/pages/sql/utils/tableInfoRows';

const TABS = ['data', 'column', 'index', 'constraint', 'fk', 'source'] as const;
const GRID_TABS = ['column', 'index', 'constraint', 'fk'] as const;
type GridTab = (typeof GRID_TABS)[number];

type Grid = { headers: string[]; rows: (string | null)[][] };

type InfoState = { loading: boolean; info: TableInfoOutput | null };

/** Hiện spinner khi đang tải cấu trúc, văn bản lỗi nếu tải thất bại, hoặc `children` khi thành công. */
function InfoPanel({ loading, loaded, children }: { loading: boolean; loaded: boolean; children: React.ReactNode }) {
  const { t } = useTranslation('tableStructure');
  if (loading) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }
  if (!loaded) {
    return (
      <Text c="dimmed" ta="center" p="md">
        {t('loadError')}
      </Text>
    );
  }
  return children;
}

type TableStructureDetailProps = {
  tabId: string;
};

/**
 * Nội dung tab TableStructure: Data, Column, Index, Constraint, FK và Source của một bảng.
 * Panel bị ẩn vẫn được mount (display: none) để giữ các hàng đã tải và vị trí cuộn khi chuyển tab.
 */
function TableStructureDetail({ tabId }: TableStructureDetailProps) {
  const { t } = useTranslation('tableStructure');
  const profileId = useSqlTabStore(s => s.tabList[tabId]?.profileId);
  const schema = useSqlTabStore(s => s.tabList[tabId]?.table?.schema);
  const table = useSqlTabStore(s => s.tabList[tabId]?.table?.name);
  const provider = useDbProfileStore(s => (profileId ? s.dbProfiles[profileId]?.provider : undefined));
  const [{ loading, info }, setState] = useState<InfoState>({ loading: true, info: null });

  useEffect(() => {
    if (!profileId || schema === undefined || table === undefined || !provider) return;
    const controller = new AbortController();
    void (async () => {
      const result = await loadTableInfo(provider, { profileId, schema, table }, controller.signal);
      if (!controller.signal.aborted) setState({ loading: false, info: result });
    })();
    return () => controller.abort();
  }, [profileId, schema, table, provider]);

  const yes = t('yes');
  const no = t('no');
  const copyLabels = useMemo(() => ({ copy: t('edit.copy'), copyWithHeaders: t('edit.copyWithHeaders') }), [t]);
  const grids = useMemo((): Record<GridTab, Grid> | null => {
    if (!info) return null;
    return {
      column: {
        headers: ['name', 'type', 'nullable', 'default', 'primaryKey'].map(key => t(`column.${key}`)),
        rows: toColumnRows(info, yes, no),
      },
      index: {
        headers: ['name', 'unique', 'origin', 'partial', 'columns'].map(key => t(`index.${key}`)),
        rows: toIndexRows(info, yes, no),
      },
      constraint: {
        headers: ['kind', 'name', 'columns', 'expression'].map(key => t(`constraint.${key}`)),
        rows: toConstraintRows(info),
      },
      fk: {
        headers: ['columns', 'refTable', 'refColumns', 'onUpdate', 'onDelete'].map(key => t(`fk.${key}`)),
        rows: toForeignKeyRows(info),
      },
    };
  }, [info, yes, no, t]);

  if (!profileId || schema === undefined || table === undefined || !provider) return null;

  return (
    <Paper withBorder h="100%" display="flex" style={{ flexDirection: 'column', overflow: 'hidden' }}>
      {/* display-none, not Activity: Activity tears down the effects of a hidden panel, so Data would reload from page 1. */}
      <Tabs
        defaultValue="data"
        keepMountedMode="display-none"
        h="100%"
        display="flex"
        style={{ flexDirection: 'column' }}
      >
        <Tabs.List style={{ flexShrink: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
          {TABS.map(key => (
            <Tabs.Tab key={key} value={key}>
              {t(`tab.${key}`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="data" flex={1} style={{ minHeight: 0 }}>
          <TableDataView tabId={tabId} provider={provider} profileId={profileId} schema={schema} table={table} />
        </Tabs.Panel>
        {GRID_TABS.map(key => (
          <Tabs.Panel key={key} value={key} flex={1} style={{ minHeight: 0 }}>
            <InfoPanel loading={loading} loaded={!!grids}>
              {grids && (
                <DataGrid
                  columns={grids[key].headers}
                  rows={grids[key].rows}
                  nullText={t('nullValue')}
                  copyLabels={copyLabels}
                />
              )}
            </InfoPanel>
          </Tabs.Panel>
        ))}
        <Tabs.Panel value="source" flex={1} style={{ minHeight: 0 }}>
          <InfoPanel loading={loading} loaded={!!info}>
            <Code block m="0.5rem" style={{ height: 'calc(100% - 1rem)', overflow: 'auto' }}>
              {info?.ddl ?? t('noSource')}
            </Code>
          </InfoPanel>
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}

export default memo(TableStructureDetail);
