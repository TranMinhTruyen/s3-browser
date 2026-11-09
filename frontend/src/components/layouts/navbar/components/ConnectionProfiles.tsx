import { Menu, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Disconnect } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DeleteProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import type { ConnectionProfileInput } from '@wails/S3Browser/models';
import { Events } from '@wailsio/runtime';
import { FileDown, PlugZap, SquarePen, Trash, Unplug } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useConnectProfile } from '@/common/hooks/useConnectProfile';
import { ConnectionProfile, useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { needsManualInput } from '@/common/utils/authUtils';
import { callIPC } from '@/common/utils/ipcUtils';
import ConnectionProfileItem, { CARD_HEIGHT } from '@/components/layouts/navbar/components/ConnectionProfileItem';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { showConnectModal, showExportProfileModal } from '@/components/modals/lazyModals';

// Gap between cards only (none after the last one), so the list has the same 8px space at the top and bottom.
const ROW_GAP = 8;

// The delete only needs the identity of the profile.
const toDeleteInput = ({ id, name, version, authConfig }: ConnectionProfile): ConnectionProfileInput => ({
  id,
  name,
  version,
  authConfig,
  authSecret: {},
});

function ConnectionProfiles() {
  const { t } = useTranslation('connectionProfiles');
  const [connectingKeys, setConnectingKeys] = useState<Set<string>>(new Set());
  const [menuKey, setMenuKey] = useState<string | null>(null);

  const keys = useProfileStore(
    useShallow(s =>
      Object.entries(s.connectionProfiles)
        .filter(e => e[1] !== undefined)
        .map(e => e[0])
    )
  );
  // Only the connected flag of the profile owning the shared menu is needed (undefined = no menu / deleted).
  const menuConnected = useProfileStore(s => (menuKey ? s.connectionProfiles[menuKey]?.isConnected : undefined));
  const loaded = useProfileStore(s => s.loaded);
  const autoConnectDoneRef = useRef(false);
  const connectingRef = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConnectionProfiles = useProfileStore(s => s.loadConnectionProfiles);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const deleteConnectionProfiles = useProfileStore(s => s.deleteConnectionProfiles);
  const getConnectionProfileById = useProfileStore(s => s.getConnectionProfileById);
  const connectProfile = useConnectProfile();
  const resetViewByProfile = useTabListStore(s => s.resetViewByProfile);
  const clearProfile = useTabListStore(s => s.clearProfile);

  // Marks a profile as (not) connecting; the ref guards re-entry, the state drives the spinner.
  const setConnecting = useCallback((key: string, connecting: boolean) => {
    if (connecting) connectingRef.current.add(key);
    else connectingRef.current.delete(key);
    setConnectingKeys(new Set(connectingRef.current));
  }, []);

  const onClickOpenConnectModal = useCallback((value: ConnectionProfile, mode: 'manualconnect' | 'editProfile') => {
    showConnectModal({
      mode: mode,
      connectionProfile: { ...value },
    });
  }, []);

  // Handlers take the key and read the latest profile from the store, so they stay stable for memoized items.
  const onClickConnect = useCallback(
    async (key: string) => {
      const value = getConnectionProfileById(key);
      if (!value || value.isConnected || connectingRef.current.has(key)) return;
      if (autoConnectDoneRef.current && needsManualInput(value)) {
        onClickOpenConnectModal(value, 'manualconnect');
        return;
      }
      setConnecting(key, true);
      try {
        await connectProfile(key, value);
      } finally {
        setConnecting(key, false);
      }
    },
    [getConnectionProfileById, onClickOpenConnectModal, connectProfile, setConnecting]
  );

  const onClickDisconnect = useCallback(
    async (key: string) => {
      const value = getConnectionProfileById(key);
      if (!value || !value.isConnected || connectingRef.current.has(key)) return;
      setConnecting(key, true);
      try {
        const output = await callIPC(Disconnect, [key]);
        if (output) {
          updateConnectionProfiles(key, { ...value, isConnected: false });
          resetViewByProfile(key);
        }
      } finally {
        setConnecting(key, false);
      }
    },
    [getConnectionProfileById, updateConnectionProfiles, resetViewByProfile, setConnecting]
  );

  const onClickEditProfile = useCallback(
    (key: string) => {
      const value = getConnectionProfileById(key);
      if (value) onClickOpenConnectModal(value, 'editProfile');
    },
    [getConnectionProfileById, onClickOpenConnectModal]
  );

  const onClickDeleteProfile = useCallback(
    async (key: string) => {
      const value = getConnectionProfileById(key);
      if (!value?.id || connectingRef.current.has(key)) return;

      // The backend disconnects before deleting and refuses while transfers are running,
      // so the connection is kept if the delete is rejected.
      if (value.isConnected) {
        const confirmDisconnect = await ConfirmModal.show({
          type: 'warning',
          confirmCode: 'C000003',
        });
        if (!confirmDisconnect) return;
      }

      const confirmDelete = await ConfirmModal.show({
        type: 'warning',
        confirmCode: 'C000002',
      });
      if (!confirmDelete) return;

      const output = await callIPC(DeleteProfileById, [toDeleteInput(value)]);
      if (output) {
        deleteConnectionProfiles(value.id);
        clearProfile(value.id);
        return;
      }

      // Rejected for running transfers keeps the connection; a DB failure has already disconnected it.
      await loadConnectionProfiles();
      if (value.isConnected && !getConnectionProfileById(key)?.isConnected) {
        resetViewByProfile(key);
      }
    },
    [deleteConnectionProfiles, clearProfile, loadConnectionProfiles, getConnectionProfileById, resetViewByProfile]
  );

  // Auto-connects once after the first profiles arrive (and again after a profile is saved).
  const runAutoConnect = useCallback(() => {
    if (autoConnectDoneRef.current) return;

    const profiles = useProfileStore.getState().connectionProfiles;
    const all = Object.keys(profiles);
    if (all.length === 0) return;

    autoConnectDoneRef.current = true;
    all.forEach(key => {
      const value = profiles[key];
      if (!value?.autoConnect || value.isConnected) return;
      void onClickConnect(key);
    });
  }, [onClickConnect]);

  useEffect(() => {
    // Events.On returns the unsubscribe function.
    return Events.On('bucket:connect-save-profile', e => {
      if (!e.data.id) return;
      autoConnectDoneRef.current = false;
      updateConnectionProfiles(e.data.id, { ...e.data });
      runAutoConnect();
    });
  }, [updateConnectionProfiles, runAutoConnect]);

  useEffect(runAutoConnect, [keys, runAutoConnect]);

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
  const onClickMenuExport = useCallback(() => {
    const profile = getConnectionProfileById(menuKey);
    if (profile) void showExportProfileModal({ profile });
  }, [menuKey, getConnectionProfileById]);
  const onClickMenuDelete = useCallback(
    () => menuKey && onClickDeleteProfile(menuKey),
    [menuKey, onClickDeleteProfile]
  );

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scrollRef.current,
    // Fixed card height: the virtualizer never measures, so the scroll size stays stable while scrolling.
    estimateSize: () => CARD_HEIGHT,
    gap: ROW_GAP,
    getItemKey: idx => keys[idx],
    overscan: 10,
  });

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
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px' }}>
      {loaded && keys.length === 0 ? (
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
                  height: CARD_HEIGHT,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <ConnectionProfileItem
                  profileKey={keys[row.index]}
                  connecting={connectingKeys.has(keys[row.index])}
                  onConnect={onClickConnect}
                />
              </div>
            ))}
          </div>
        </Menu.ContextMenu>

        <Menu.Dropdown>
          {!menuConnected && (
            <Menu.Item leftSection={<PlugZap size="16px" />} onClick={onClickMenuConnect}>
              {t('contextMenu.connect')}
            </Menu.Item>
          )}
          {menuConnected && (
            <Menu.Item
              leftSection={<Unplug size="16px" />}
              color="var(--mantine-color-red-6)"
              onClick={onClickMenuDisconnect}
            >
              {t('contextMenu.disconnect')}
            </Menu.Item>
          )}
          {!menuConnected && (
            <Menu.Item leftSection={<SquarePen size="16px" />} onClick={onClickMenuEdit}>
              {t('contextMenu.edit')}
            </Menu.Item>
          )}
          <Menu.Item leftSection={<FileDown size="16px" />} onClick={onClickMenuExport}>
            {t('contextMenu.export')}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<Trash size="16px" />} color="var(--mantine-color-red-6)" onClick={onClickMenuDelete}>
            {t('contextMenu.delete')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

export default ConnectionProfiles;
