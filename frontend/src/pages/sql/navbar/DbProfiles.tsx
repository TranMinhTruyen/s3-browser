import { type FlattenedTreeNodeData, flattenTreeData, Menu, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileDown, PlugZap, RefreshCw, SquarePen, Trash, Unplug } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import DbProfileItem, { CARD_HEIGHT } from '@/pages/sql/navbar/DbProfileItem';
import classes from '@/pages/sql/navbar/DbProfiles.module.css';
import DbTreeRow, { DbTreeStatusRow, NODE_HEIGHT } from '@/pages/sql/navbar/DbTreeRow';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useDbTreeStore } from '@/pages/sql/stores/dbTreeStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { isTableDirty } from '@/pages/sql/utils/dirtyTables';
import { notifyNoBackend } from '@/pages/sql/utils/sqlToast';

// Space above every card except the first one, so the list has the same 8px space at the top and bottom.
const CARD_GAP = 8;

/** A row of the flat list: a profile card, a node of its object tree, or a status line under the card. */
type ListRow =
  | { key: string; type: 'card'; profileKey: string }
  | { key: string; type: 'node'; profileKey: string; flat: FlattenedTreeNodeData }
  | { key: string; type: 'status'; profileKey: string; status: 'loading' | 'error' | 'empty' };

/** Height of a row in px at the medium interface size (a card also holds the gap above it). */
const getRowHeight = (row: ListRow, index: number) =>
  row.type === 'card' ? CARD_HEIGHT + (index > 0 ? CARD_GAP : 0) : NODE_HEIGHT;

/**
 * Virtualized list of database profiles with a shared right-click menu (same behavior as the S3 list).
 * The cards and the object trees of the open profiles are one flat list, so the tree rows are virtualized too.
 */
function DbProfiles() {
  const { t } = useTranslation('sqlNavbar');
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const keys = useDbProfileStore(useShallow(s => Object.keys(s.dbProfiles)));
  // Only the connected flag of the profile owning the shared menu is needed (undefined = no menu / deleted).
  const menuConnected = useDbProfileStore(s => (menuKey ? s.dbProfiles[menuKey]?.isConnected : undefined));
  const getDbProfileById = useDbProfileStore(s => s.getDbProfileById);
  const removeDbProfile = useDbProfileStore(s => s.removeDbProfile);
  const connectDbProfile = useDbProfileStore(s => s.connectDbProfile);
  const disconnectDbProfile = useDbProfileStore(s => s.disconnectDbProfile);
  const clearProfile = useSqlTabStore(s => s.clearProfile);
  const closeProfileTables = useSqlTabStore(s => s.closeProfileTables);
  const openTreeProfile = useDbTreeStore(s => s.openProfile);
  const toggleTreeProfile = useDbTreeStore(s => s.toggleProfile);
  const toggleTreeNode = useDbTreeStore(s => s.toggleNode);
  const selectTreeNode = useDbTreeStore(s => s.selectNode);
  const refreshTreeProfile = useDbTreeStore(s => s.refreshProfile);
  const dropTreeProfile = useDbTreeStore(s => s.dropProfile);
  const openedTrees = useDbTreeStore(s => s.opened);
  const trees = useDbTreeStore(s => s.trees);
  const expanded = useDbTreeStore(s => s.expanded);
  const selectedNode = useDbTreeStore(s => s.selected);
  const openTableTab = useSqlTabStore(s => s.openTableTab);
  // The profile of the selected tab: its tree opens by itself when it is closed.
  const activeTab = useSqlTabStore(s => s.activeTab);
  const activeProfileId = useSqlTabStore(s => s.tabList[activeTab]?.profileId ?? null);
  const activeConnected = useDbProfileStore(s => !!(activeProfileId && s.dbProfiles[activeProfileId]?.isConnected));

  // Handlers take the key and read the latest profile from the store, so they stay stable for memoized items.
  // SQLite connects for real; PostgreSQL is still fake (only the flag). The store keeps the flag when it fails.
  const onClickConnect = useCallback(
    async (key: string) => {
      const profile = getDbProfileById(key);
      if (!profile || profile.isConnected) return;
      if (await connectDbProfile(key)) toast.success(t('toast.connected', { name: profile.name }));
    },
    [getDbProfileById, connectDbProfile, t]
  );

  // Disconnecting or deleting closes the profile's table tabs: ask first when one has uncommitted row changes.
  const confirmDiscardEdits = useCallback(async (key: string, name: string) => {
    const { tabList } = useSqlTabStore.getState();
    const dirty = Object.entries(tabList).some(([id, tab]) => tab.profileId === key && tab.table && isTableDirty(id));
    return !dirty || (await ConfirmModal.show({ type: 'warning', confirmCode: 'C000013', params: { name } }));
  }, []);

  const onClickDisconnect = useCallback(
    async (key: string) => {
      const profile = getDbProfileById(key);
      if (!profile?.isConnected) return;
      if (!(await confirmDiscardEdits(key, profile.name))) return;
      if (!(await disconnectDbProfile(key))) return;
      dropTreeProfile(key);
      closeProfileTables(key);
      toast.success(t('toast.disconnected', { name: profile.name }));
    },
    [getDbProfileById, confirmDiscardEdits, disconnectDbProfile, dropTreeProfile, closeProfileTables, t]
  );

  const onClickEditProfile = useCallback(
    (key: string) => {
      const profile = getDbProfileById(key);
      if (profile) void DbProfileModal.show({ profile });
    },
    [getDbProfileById]
  );

  const onClickDeleteProfile = useCallback(
    async (key: string) => {
      const profile = getDbProfileById(key);
      if (!profile) return;

      if (profile.isConnected) {
        const confirmDisconnect = await ConfirmModal.show({ type: 'warning', confirmCode: 'C000003' });
        if (!confirmDisconnect) return;
      }

      const confirmDelete = await ConfirmModal.show({ type: 'warning', confirmCode: 'C000002' });
      if (!confirmDelete) return;
      if (!(await confirmDiscardEdits(key, profile.name))) return;

      if (!(await removeDbProfile(key))) return;
      dropTreeProfile(key);
      closeProfileTables(key);
      clearProfile(key);
      toast.success(t('toast.deleted', { name: profile.name }));
    },
    [getDbProfileById, confirmDiscardEdits, removeDbProfile, dropTreeProfile, closeProfileTables, clearProfile, t]
  );

  // One shared context menu for all rows (a Menu per row is costly with hundreds of profiles).
  // Right click resolves the row from the DOM; the menu is positioned by Mantine at the mouse.
  const onContextMenuRows = useCallback((e: MouseEvent<HTMLElement>) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-profile-key]')?.dataset.profileKey;
    if (key) setMenuKey(key);
    else e.preventDefault();
  }, []);

  const onChangeMenu = useCallback((opened: boolean) => {
    if (!opened) setMenuKey(null);
  }, []);

  const onClickMenuConnect = useCallback(() => menuKey && onClickConnect(menuKey), [menuKey, onClickConnect]);
  const onClickMenuDisconnect = useCallback(() => menuKey && onClickDisconnect(menuKey), [menuKey, onClickDisconnect]);
  const onClickMenuRefresh = useCallback(() => menuKey && refreshTreeProfile(menuKey), [menuKey, refreshTreeProfile]);
  const onClickMenuEdit = useCallback(() => menuKey && onClickEditProfile(menuKey), [menuKey, onClickEditProfile]);
  const onClickMenuDelete = useCallback(
    () => menuKey && onClickDeleteProfile(menuKey),
    [menuKey, onClickDeleteProfile]
  );

  // Selecting a tab of a connected profile opens its tree when closed; a tree opened or closed by hand stays so.
  // activeTab: selecting another tab of the same profile must reopen a tree the user closed.
  useEffect(() => {
    if (activeProfileId && activeConnected) void openTreeProfile(activeProfileId);
  }, [activeTab, activeProfileId, activeConnected, openTreeProfile]);

  const rows = useMemo(
    () =>
      keys.flatMap((key): ListRow[] => {
        const card: ListRow = { key, type: 'card', profileKey: key };
        const tree = openedTrees[key] ? trees[key] : undefined;
        if (!tree) return [card];
        if (tree.status !== 'ready' || tree.nodes.length === 0) {
          const status = tree.status === 'ready' ? 'empty' : tree.status;
          return [card, { key: `status:${key}`, type: 'status', profileKey: key, status }];
        }
        const nodes = flattenTreeData(tree.nodes, expanded);
        return [card, ...nodes.map((flat): ListRow => ({ key: flat.node.value, type: 'node', profileKey: key, flat }))];
      }),
    [keys, openedTrees, trees, expanded]
  );

  const scale = useUiScale();

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // Fixed row heights: the virtualizer never measures, so the scroll size stays stable while scrolling.
    // Rounded: at small/large the scale gives fractional px, which blurs icons and offsets translateY by half a pixel.
    estimateSize: idx => Math.round(getRowHeight(rows[idx], idx) * scale),
    getItemKey: idx => rows[idx].key,
    overscan: 10,
  });

  useRemeasureOnScale(virtualizer, scale);

  const virtualItems = virtualizer.getVirtualItems();
  const menuOpened = menuKey !== null && menuConnected !== undefined;

  // The menu is anchored to the mouse point, so close it when the list scrolls (listener only while open).
  useEffect(() => {
    const el = scrollRef.current;
    if (!menuOpened || !el) return;
    const onScroll = () => setMenuKey(null);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [menuOpened]);

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.5rem' }}>
      {keys.length === 0 ? (
        <Text c="dimmed" ta="center" p="md">
          {t('profile.empty')}
        </Text>
      ) : null}
      <Menu width="12.5rem" opened={menuOpened} onChange={onChangeMenu}>
        <Menu.ContextMenu>
          <div style={{ position: 'relative', height: virtualizer.getTotalSize() }} onContextMenu={onContextMenuRows}>
            {virtualItems.map(item => {
              const row = rows[item.index];
              // A group is a card followed by its tree rows; the row before the next card (or the end) closes it.
              const hasTreeBelow = rows[item.index + 1] ? rows[item.index + 1].type !== 'card' : false;
              const className =
                row.type === 'card'
                  ? hasTreeBelow
                    ? classes.cardOpen
                    : undefined
                  : `${classes.inGroup}${hasTreeBelow ? '' : ` ${classes.groupEnd}`}`;
              return (
                <div
                  key={item.key}
                  className={className}
                  style={{
                    position: 'absolute',
                    width: '100%',
                    height: item.size,
                    boxSizing: 'border-box',
                    // The gap above a card is rem, so it follows the interface size like the card itself.
                    paddingTop: row.type === 'card' && item.index > 0 ? `${CARD_GAP / 16}rem` : undefined,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {row.type === 'card' ? (
                    <DbProfileItem
                      profileKey={row.profileKey}
                      onConnect={onClickConnect}
                      onToggleTree={toggleTreeProfile}
                    />
                  ) : row.type === 'node' ? (
                    <DbTreeRow
                      profileKey={row.profileKey}
                      flat={row.flat}
                      selected={row.flat.node.value === selectedNode}
                      onToggle={toggleTreeNode}
                      onSelect={selectTreeNode}
                      onOpenTable={openTableTab}
                    />
                  ) : (
                    <DbTreeStatusRow status={row.status} />
                  )}
                </div>
              );
            })}
          </div>
        </Menu.ContextMenu>

        <Menu.Dropdown>
          {!menuConnected && (
            <Menu.Item leftSection={<PlugZap size="1rem" />} onClick={onClickMenuConnect}>
              {t('contextMenu.connect')}
            </Menu.Item>
          )}
          {menuConnected && (
            <Menu.Item
              leftSection={<Unplug size="1rem" />}
              color="var(--mantine-color-red-6)"
              onClick={onClickMenuDisconnect}
            >
              {t('contextMenu.disconnect')}
            </Menu.Item>
          )}
          {menuConnected && (
            <Menu.Item leftSection={<RefreshCw size="1rem" />} onClick={onClickMenuRefresh}>
              {t('contextMenu.refresh')}
            </Menu.Item>
          )}
          {!menuConnected && (
            <Menu.Item leftSection={<SquarePen size="1rem" />} onClick={onClickMenuEdit}>
              {t('contextMenu.edit')}
            </Menu.Item>
          )}
          <Menu.Item leftSection={<FileDown size="1rem" />} onClick={notifyNoBackend}>
            {t('contextMenu.export')}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<Trash size="1rem" />} color="var(--mantine-color-red-6)" onClick={onClickMenuDelete}>
            {t('contextMenu.delete')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

export default DbProfiles;
