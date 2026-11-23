import { Center, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { Check, ChevronsLeftRight, Plus, RefreshCw, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { type ChangeEvent, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/buttons/Button';
import DataGrid, { type DataGridHandle } from '@/components/display/dataGrid/DataGrid';
import { type GridEdit, isAllDeletedLoaded } from '@/components/display/dataGrid/useGridEdit';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { useTableEdits } from '@/pages/sql/hooks/useTableEdits';
import { useTableRows } from '@/pages/sql/hooks/useTableRows';
import type { Provider } from '@/pages/sql/stores/dbProfileStore';
import { setTableDirty } from '@/pages/sql/utils/dirtyTables';

type TableDataViewProps = {
  tabId: string;
  provider: Provider;
  profileId: string;
  schema: string;
  table: string;
};

/**
 * Rows of a table in an editable grid; the next page loads when the grid is scrolled near the end. Edits, new rows
 * and deleted rows stay pending (Rollback drops them); Commit is disabled until the backend can write them.
 */
function TableDataView({ tabId, provider, profileId, schema, table }: TableDataViewProps) {
  const { t, i18n } = useTranslation('tableStructure');
  const { columns, rows, hasMore, loading, loadingMore, fetchAll, loadMore, setFetchAllRows, refresh, resetKey } =
    useTableRows(tabId, provider, profileId, schema, table);
  const { edits, changedCount, addRow, setCell, setCells, toggleDeleteRows, rollback } = useTableEdits(
    rows,
    columns,
    resetKey
  );
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const gridRef = useRef<DataGridHandle>(null);

  // Closing the tab asks for confirmation while changes are pending.
  const dirty = changedCount > 0;
  useEffect(() => {
    setTableDirty(tabId, dirty);
    return () => setTableDirty(tabId, false);
  }, [tabId, dirty]);

  const newCount = edits.newRows.length;
  // The delete button restores when every selected row is a deleted loaded row.
  const restore = isAllDeletedLoaded(selectedRows, newCount, edits.deleted);

  const labels = useMemo(
    () => ({
      setNull: t('edit.setNull'),
      deleteRows: t('edit.deleteRow'),
      restoreRows: t('edit.restoreRow'),
      rowNew: t('edit.rowNew'),
      rowEdited: t('edit.rowEdited'),
      rowDeleted: t('edit.rowDeleted'),
    }),
    [t]
  );
  const copyLabels = useMemo(() => ({ copy: t('edit.copy'), copyWithHeaders: t('edit.copyWithHeaders') }), [t]);
  const edit = useMemo(
    (): GridEdit => ({
      newRows: edits.newRows,
      edited: edits.edited,
      deleted: edits.deleted,
      labels,
      onSetCell: setCell,
      onSetCells: setCells,
      onToggleDeleteRows: toggleDeleteRows,
      onSelectionChange: setSelectedRows,
    }),
    [edits, labels, setCell, setCells, toggleDeleteRows]
  );

  const fetchAllId = useId();
  const fetchAllDisabled = !fetchAll && (!hasMore || loadingMore);

  const onClickFitColumns = useCallback(() => gridRef.current?.fitColumns(), []);
  const onChangeFetchAll = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setFetchAllRows(e.currentTarget.checked),
    [setFetchAllRows]
  );
  /** Reloads the first page; pending changes are dropped with it, after a confirmation. */
  const onClickRefresh = useCallback(async () => {
    if (dirty && !(await ConfirmModal.show({ type: 'warning', confirmCode: 'C000014', params: { table } }))) return;
    rollback();
    setSelectedRows([]);
    refresh();
  }, [dirty, table, rollback, refresh]);
  const onClickDelete = useCallback(() => toggleDeleteRows(selectedRows), [toggleDeleteRows, selectedRows]);

  if (loading) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  return (
    <Stack gap={0} h="100%">
      <Group
        gap="0.25rem"
        p="0.25rem"
        style={{ flexShrink: 0, borderBottom: '1px solid var(--mantine-color-default-border)' }}
      >
        <Button size="xs" color="gray" leftSection={<RefreshCw size="1rem" />} onClick={onClickRefresh}>
          {t('edit.refresh')}
        </Button>
        <Button size="xs" leftSection={<Plus size="1rem" />} onClick={addRow}>
          {t('edit.addRow')}
        </Button>
        <Button
          size="xs"
          color="red"
          leftSection={restore ? <RotateCcw size="1rem" /> : <Trash2 size="1rem" />}
          disabled={selectedRows.length === 0}
          onClick={onClickDelete}
        >
          {restore ? t('edit.restoreRow') : t('edit.deleteRow')}
        </Button>
        {/* The span receives the hover: a disabled button sends no mouse events to the tooltip. */}
        <Tooltip label={t('edit.commitUnsupported')} openDelay={300}>
          <span style={{ display: 'inline-flex' }}>
            <Button size="xs" leftSection={<Check size="1rem" />} disabled>
              {t('edit.commit')}
            </Button>
          </span>
        </Tooltip>
        <Button size="xs" color="gray" leftSection={<Undo2 size="1rem" />} disabled={!dirty} onClick={rollback}>
          {t('edit.rollback')}
        </Button>
        <Button
          size="xs"
          color="gray"
          leftSection={<ChevronsLeftRight size="1rem" />}
          disabled={columns.length === 0 || rows.length === 0}
          onClick={onClickFitColumns}
        >
          {t('edit.fitColumns')}
        </Button>
        <Text size="xs" c="dimmed" ml="0.25rem">
          {t('edit.changedRows', { total: changedCount })}
        </Text>
        {/* Rows already loaded stay in the grid; the checkbox is only live while there is more to read or a read runs. */}
        <Group gap="0.5rem" ml="auto" pr="0.5rem" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {t('loadedRows', { total: rows.length.toLocaleString(i18n.language) })}
          </Text>
          {fetchAll && loadingMore ? <Loader size="1rem" /> : null}
          {/* The label is a Text like the row count, so both texts line up (the Mantine label sits differently). */}
          <Group gap="0.375rem" wrap="nowrap">
            <CheckBoxInput
              id={fetchAllId}
              size="xs"
              checked={fetchAll}
              disabled={fetchAllDisabled}
              onChange={onChangeFetchAll}
            />
            <Text
              component="label"
              htmlFor={fetchAllId}
              size="xs"
              c="dimmed"
              style={{ cursor: fetchAllDisabled ? 'not-allowed' : 'pointer' }}
            >
              {t('fetchAll')}
            </Text>
          </Group>
        </Group>
      </Group>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          ref={gridRef}
          columns={columns}
          rows={rows}
          nullText={t('nullValue')}
          copyLabels={copyLabels}
          hasMore={hasMore}
          loading={loadingMore}
          onEndReached={loadMore}
          edit={edit}
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
