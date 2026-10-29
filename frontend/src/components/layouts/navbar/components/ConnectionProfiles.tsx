import { useVirtualizer } from '@tanstack/react-virtual';
import { ConnectS3ByProfile, Disconnect } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DeleteProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { Events } from '@wailsio/runtime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionProfile, useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ConnectionProfileItem from '@/components/layouts/navbar/components/ConnectionProfileItem';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { showConnectModal } from '@/components/modals/lazyModals';

// Initial row height (2 text lines + card padding); the real height comes from measureElement.
const ESTIMATED_ITEM_HEIGHT = 64;

function ConnectionProfiles() {
  const [connectingKeys, setConnectingKeys] = useState<Set<string>>(new Set());
  const [openedMenuKey, setOpenedMenuKey] = useState<string | null>(null);

  const connectionProfiles = useProfileStore(s => s.connectionProfiles);
  const autoConnectDoneRef = useRef(false);
  const connectingRef = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConnectionProfiles = useProfileStore(s => s.loadConnectionProfiles);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const deleteConnectionProfiles = useProfileStore(s => s.deleteConnectionProfiles);
  const getConnectionProfileById = useProfileStore(s => s.getConnectionProfileById);
  const reset = useProfileStore(s => s.reset);
  const resetViewByProfile = useTabListStore(s => s.resetViewByProfile);
  const clearProfile = useTabListStore(s => s.clearProfile);

  useEffect(() => {
    loadConnectionProfiles();

    return () => {
      reset();
    };
  }, [loadConnectionProfiles, reset]);

  useEffect(() => {
    // Events.On returns the unsubscribe function.
    return Events.On('bucket:connect-save-profile', e => {
      if (!e.data.id) return;
      autoConnectDoneRef.current = false;
      updateConnectionProfiles(e.data.id, { ...e.data });
    });
  }, [updateConnectionProfiles]);

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
      if (autoConnectDoneRef.current && !value.secretKey) {
        onClickOpenConnectModal(value, 'manualconnect');
        return;
      }
      setConnecting(key, true);
      try {
        const output = await callIPC(ConnectS3ByProfile, [key]);
        if (output?.isConnected) {
          updateConnectionProfiles(key, { ...value, isConnected: true });
        }
      } finally {
        setConnecting(key, false);
      }
    },
    [getConnectionProfileById, onClickOpenConnectModal, updateConnectionProfiles, setConnecting]
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

      const output = await callIPC(DeleteProfileById, [{ ...value }]);
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

  const onChangeMenu = useCallback((key: string, opened: boolean) => {
    setOpenedMenuKey(prev => {
      if (opened) return key;
      return prev === key ? null : prev;
    });
  }, []);

  useEffect(() => {
    if (autoConnectDoneRef.current) return;

    const keys = Object.keys(connectionProfiles);
    if (keys.length === 0) return;

    autoConnectDoneRef.current = true;

    keys.forEach(key => {
      const value = connectionProfiles[key];
      if (!value?.autoConnect || value.isConnected) return;
      void onClickConnect(key);
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionProfiles]);

  const entries = useMemo(
    () => Object.entries(connectionProfiles).filter((e): e is [string, ConnectionProfile] => e[1] !== undefined),
    [connectionProfiles]
  );

  // React Compiler is disabled, so this compiler-only lint does not apply.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    getItemKey: idx => entries[idx][0],
    gap: 8,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // An item scrolled out of the rendered range unmounts and closes its menu; clear the stale key.
  useEffect(() => {
    if (openedMenuKey && !virtualItems.some(row => entries[row.index]?.[0] === openedMenuKey)) {
      setOpenedMenuKey(null);
    }
  }, [openedMenuKey, virtualItems, entries]);

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px' }}>
      <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
        {virtualItems.map(row => {
          const [key, profile] = entries[row.index];
          return (
            <div
              key={key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', width: '100%', transform: `translateY(${row.start}px)` }}
            >
              <ConnectionProfileItem
                profileKey={key}
                profile={profile}
                connecting={connectingKeys.has(key)}
                menuOpened={openedMenuKey === key}
                onConnect={onClickConnect}
                onDisconnect={onClickDisconnect}
                onEdit={onClickEditProfile}
                onDelete={onClickDeleteProfile}
                onMenuChange={onChangeMenu}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ConnectionProfiles;
