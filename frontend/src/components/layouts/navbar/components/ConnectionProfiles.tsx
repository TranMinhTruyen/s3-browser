import { Box, Card, isLightColor, Loader, Menu, Stack, Text } from '@mantine/core';
import { ConnectS3ByProfile, Disconnect } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DeleteProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { Events } from '@wailsio/runtime';
import { Cable, PlugZap, SquarePen, Trash, Unplug } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionProfile, useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import classes from '@/components/layouts/layout.module.css';
import ConfirmModal from '@/components/modals/ConfirmModal';
import ConnectModal from '@/components/modals/ConnectModal';

function ConnectionProfiles() {
  const { t } = useTranslation('connectionProfiles');

  const [connectingKeys, setConnectingKeys] = useState<Set<string>>(new Set());
  const [openedMenuKey, setOpenedMenuKey] = useState<string | null>(null);

  const connectionProfiles = useProfileStore(s => s.connectionProfiles);
  const autoConnectDoneRef = useRef(false);
  const connectingRef = useRef(new Set<string>());

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
    const unsubscribe = Events.On('bucket:connect-save-profile', e => {
      if (!e.data.id) return;
      autoConnectDoneRef.current = false;
      updateConnectionProfiles(e.data.id, { ...e.data });
    });

    return () => {
      unsubscribe();
    };
  }, [updateConnectionProfiles]);

  const onClickOpenConnectModal = useCallback((value: ConnectionProfile, mode: 'manualconnect' | 'editProfile') => {
    ConnectModal.show({
      mode: mode,
      connectionProfile: { ...value },
    });
  }, []);

  const onClickConnect = useCallback(
    (key: string, value: ConnectionProfile) => async () => {
      if (!value || value.isConnected || connectingRef.current.has(key)) return;
      if (autoConnectDoneRef.current && !value.secretKey) {
        onClickOpenConnectModal(value, 'manualconnect');
        return;
      }
      connectingRef.current.add(key);
      setConnectingKeys(new Set(connectingRef.current));
      try {
        const output = await callIPC(ConnectS3ByProfile, [key]);
        if (output?.isConnected) {
          updateConnectionProfiles(key, { ...value, isConnected: true });
        }
      } finally {
        connectingRef.current.delete(key);
        setConnectingKeys(new Set(connectingRef.current));
      }
    },
    [onClickOpenConnectModal, updateConnectionProfiles]
  );

  const onClickDisconnect = useCallback(
    (key: string, value: ConnectionProfile) => async () => {
      if (!value || !value.isConnected || connectingRef.current.has(key)) return;
      connectingRef.current.add(key);
      setConnectingKeys(new Set(connectingRef.current));
      try {
        const output = await callIPC(Disconnect, [key]);
        if (output) {
          updateConnectionProfiles(key, { ...value, isConnected: false });
          resetViewByProfile(key);
        }
      } finally {
        connectingRef.current.delete(key);
        setConnectingKeys(new Set(connectingRef.current));
      }
    },
    [updateConnectionProfiles, resetViewByProfile]
  );

  const onClickEditProfile = useCallback(
    (value: ConnectionProfile) => () => {
      onClickOpenConnectModal(value, 'editProfile');
    },
    [onClickOpenConnectModal]
  );

  const onClickDeleteProfile = useCallback(
    (key: string, value: ConnectionProfile) => async () => {
      if (!value.id || connectingRef.current.has(key)) return;

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

  const onClickMenuChange = useCallback(
    (key: string) => (opened: boolean) => {
      setOpenedMenuKey(prev => {
        if (opened) return key;
        return prev === key ? null : prev;
      });
    },
    []
  );

  useEffect(() => {
    if (autoConnectDoneRef.current) return;

    const entries = Object.entries(connectionProfiles);
    if (entries.length === 0) return;

    autoConnectDoneRef.current = true;

    entries.forEach(([key, value]) => {
      if (!value?.autoConnect || value.isConnected) return;
      void onClickConnect(key, value)();
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionProfiles]);

  const connectionProfilesComponent = Object.entries(connectionProfiles)
    .filter((entry): entry is [string, ConnectionProfile] => entry[1] !== undefined)
    .map(([key, value]) => {
      return (
        <Menu key={key} width={200} opened={openedMenuKey === key} onChange={onClickMenuChange(key)}>
          <Menu.ContextMenu>
            <Card
              padding="8px"
              withBorder
              orientation="horizontal"
              onDoubleClick={onClickConnect(key, value)}
              c={isLightColor(value.color ?? '#d0ebff') ? '#000000' : '#FFFFFF'}
              className={classes.card}
            >
              <Card.Section
                inheritPadding
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  minWidth: '40px',
                  justifyContent: 'center',
                  backgroundColor: value.isConnected ? '#83f175' : '#FFFFFF',
                }}
              >
                {connectingKeys.has(key) ? (
                  <Loader color="blue" size="sm" />
                ) : value.isConnected ? (
                  <Cable />
                ) : (
                  <Unplug />
                )}
              </Card.Section>
              <Card.Section
                px="xs"
                inheritPadding
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: value.color ?? '#FFFFFF',
                }}
              >
                <Box>
                  <Text c="inherit" truncate="end">
                    {value.name}
                  </Text>
                  <Text c="dimmed">{value.provider}</Text>
                </Box>
              </Card.Section>
            </Card>
          </Menu.ContextMenu>

          <Menu.Dropdown>
            {!value.isConnected && (
              <Menu.Item leftSection={<PlugZap size="16px" />} onClick={onClickConnect(key, value)}>
                {t('contextMenu.connect')}
              </Menu.Item>
            )}
            {value.isConnected && (
              <Menu.Item leftSection={<Unplug size="16px" />} color="red" onClick={onClickDisconnect(key, value)}>
                {t('contextMenu.disconnect')}
              </Menu.Item>
            )}
            {!value.isConnected && (
              <Menu.Item leftSection={<SquarePen size="16px" />} onClick={onClickEditProfile(value)}>
                {t('contextMenu.edit')}
              </Menu.Item>
            )}
            <Menu.Divider />
            <Menu.Item leftSection={<Trash size="16px" />} color="red" onClick={onClickDeleteProfile(key, value)}>
              {t('contextMenu.delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      );
    });

  return (
    <Stack h="100%" gap="8px" align="stretch">
      {connectionProfilesComponent}
    </Stack>
  );
}

export default ConnectionProfiles;
