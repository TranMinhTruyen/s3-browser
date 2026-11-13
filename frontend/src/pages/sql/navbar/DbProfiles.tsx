import { Menu, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileDown, PlugZap, SquarePen, Trash, Unplug } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import DbProfileItem, { CARD_HEIGHT } from '@/pages/sql/navbar/DbProfileItem';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { notifyNoBackend } from '@/pages/sql/utils/sqlToast';

// Gap between cards only (none after the last one), so the list has the same 8px space at the top and bottom.
const ROW_GAP = 8;

/** Virtualized list of database profiles with a shared right-click menu (same behavior as the S3 list). */
function DbProfiles() {
  const { t } = useTranslation('sqlNavbar');
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const keys = useDbProfileStore(useShallow(s => Object.keys(s.dbProfiles)));
  // Only the connected flag of the profile owning the shared menu is needed (undefined = no menu / deleted).
  const menuConnected = useDbProfileStore(s => (menuKey ? s.dbProfiles[menuKey]?.isConnected : undefined));
  const getDbProfileById = useDbProfileStore(s => s.getDbProfileById);
  const deleteDbProfile = useDbProfileStore(s => s.deleteDbProfile);
  const setConnected = useDbProfileStore(s => s.setConnected);
  const clearProfile = useSqlTabStore(s => s.clearProfile);

  // Handlers take the key and read the latest profile from the store, so they stay stable for memoized items.
  // Connecting is fake for now: it only flips the flag.
  const onClickConnect = useCallback(
    (key: string) => {
      const profile = getDbProfileById(key);
      if (!profile || profile.isConnected) return;
      setConnected(key, true);
      toast.success(t('toast.connected', { name: profile.name }));
    },
    [getDbProfileById, setConnected, t]
  );

  const onClickDisconnect = useCallback(
    (key: string) => {
      const profile = getDbProfileById(key);
      if (!profile?.isConnected) return;
      setConnected(key, false);
      toast.success(t('toast.disconnected', { name: profile.name }));
    },
    [getDbProfileById, setConnected, t]
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

      deleteDbProfile(key);
      clearProfile(key);
      toast.success(t('toast.deleted', { name: profile.name }));
    },
    [getDbProfileById, deleteDbProfile, clearProfile, t]
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
  const onClickMenuEdit = useCallback(() => menuKey && onClickEditProfile(menuKey), [menuKey, onClickEditProfile]);
  const onClickMenuDelete = useCallback(
    () => menuKey && onClickDeleteProfile(menuKey),
    [menuKey, onClickDeleteProfile]
  );

  const scale = useUiScale();

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scrollRef.current,
    // Fixed card height: the virtualizer never measures, so the scroll size stays stable while scrolling.
    estimateSize: () => CARD_HEIGHT * scale,
    gap: ROW_GAP * scale,
    getItemKey: idx => keys[idx],
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
      <Menu width={200} opened={menuOpened} onChange={onChangeMenu}>
        <Menu.ContextMenu>
          <div style={{ position: 'relative', height: virtualizer.getTotalSize() }} onContextMenu={onContextMenuRows}>
            {virtualItems.map(row => (
              <div
                key={row.key}
                style={{
                  position: 'absolute',
                  width: '100%',
                  height: CARD_HEIGHT * scale,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <DbProfileItem profileKey={keys[row.index]} onConnect={onClickConnect} />
              </div>
            ))}
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
