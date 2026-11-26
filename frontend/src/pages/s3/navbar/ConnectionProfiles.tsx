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
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import { callIPC } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { showConnectModal, showExportProfileModal } from '@/components/modals/lazyModals';
import { useConnectProfile } from '@/pages/s3/hooks/useConnectProfile';
import ConnectionProfileItem, { CARD_HEIGHT } from '@/pages/s3/navbar/ConnectionProfileItem';
import { ConnectionProfile, useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { needsManualInput } from '@/pages/s3/utils/authUtils';

// Chỉ chừa khoảng cách giữa các thẻ (không chừa sau thẻ cuối) để đầu và cuối danh sách đều cách 8px.
const ROW_GAP = 8;

// Thao tác xóa chỉ cần định danh của profile.
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
  // Chỉ cần trạng thái kết nối của profile sở hữu menu dùng chung (undefined = không có menu / đã xóa).
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

  // Đánh dấu profile đang (hoặc không còn) kết nối; ref ngăn gọi lặp, state điều khiển spinner.
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

  // Handler nhận key rồi đọc profile mới nhất từ store để giữ ổn định khi dùng với các mục được memo.
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

      // Backend ngắt kết nối trước khi xóa và từ chối xóa khi đang truyền file,
      // nên kết nối vẫn được giữ nếu yêu cầu xóa bị từ chối.
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

      // Nếu bị từ chối do đang truyền file thì kết nối vẫn còn; lỗi DB xảy ra sau khi đã ngắt kết nối.
      await loadConnectionProfiles();
      if (value.isConnected && !getConnectionProfileById(key)?.isConnected) {
        resetViewByProfile(key);
      }
    },
    [deleteConnectionProfiles, clearProfile, loadConnectionProfiles, getConnectionProfileById, resetViewByProfile]
  );

  // Tự động kết nối một lần sau khi nhận được các profile đầu tiên (và kết nối lại sau khi lưu profile).
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
    // Events.On trả về hàm hủy đăng ký.
    return Events.On('bucket:connect-save-profile', e => {
      if (!e.data.id) return;
      autoConnectDoneRef.current = false;
      updateConnectionProfiles(e.data.id, { ...e.data });
      runAutoConnect();
    });
  }, [updateConnectionProfiles, runAutoConnect]);

  useEffect(runAutoConnect, [keys, runAutoConnect]);

  // Dùng chung một menu ngữ cảnh cho mọi hàng (tạo một Menu mỗi hàng sẽ tốn kém khi có hàng trăm profile).
  // Khi nhấn chuột phải, tìm hàng từ DOM; Mantine đặt menu tại vị trí con trỏ.
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

  const scale = useUiScale();

  // React Compiler đang tắt nên quy tắc lint chỉ dành cho compiler này không áp dụng.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scrollRef.current,
    // Chiều cao thẻ cố định: virtualizer không cần đo nên kích thước vùng cuộn ổn định khi cuộn.
    estimateSize: () => CARD_HEIGHT * scale,
    gap: ROW_GAP * scale,
    getItemKey: idx => keys[idx],
    overscan: 10,
  });

  useRemeasureOnScale(virtualizer, scale);

  const virtualItems = virtualizer.getVirtualItems();
  const menuOpened = menuKey !== null && menuConnected !== undefined;

  // Menu neo tại vị trí con trỏ nên đóng menu khi danh sách cuộn (chỉ đăng ký listener lúc menu mở).
  useEffect(() => {
    const el = scrollRef.current;
    if (!menuOpened || !el) return;
    const onScroll = () => setMenuKey(null);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [menuOpened]);

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.5rem' }}>
      {loaded && keys.length === 0 ? (
        <Text c="dimmed" ta="center" p="md">
          {t('profile.empty')}
        </Text>
      ) : null}
      <Menu width="12.5rem" opened={menuOpened} onChange={onChangeMenu}>
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
          <Menu.Item leftSection={<FileDown size="1rem" />} onClick={onClickMenuExport}>
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

export default ConnectionProfiles;
