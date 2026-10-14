import { Card, isLightColor, Loader, Menu, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { ConnectS3ByProfile, Disconnect } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DeleteProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { Events } from '@wailsio/runtime';
import { Cable, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionProfile, useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import classes from '@/components/layouts/layout.module.css';
import ConfirmModal from '@/components/modals/ConfirmModal';
import ConnectModal from '@/components/modals/ConnectModal';

function ConnectionProfiles() {
  const { t } = useTranslation('connectionProfiles');

  const [connectLoading, { open: openConnectLoading, close: closeConnectLoading }] = useDisclosure();
  const [openedMenuKey, setOpenedMenuKey] = useState<string | null>(null);

  const connectionProfiles = useProfileStore(s => s.connectionProfiles);
  const autoConnectDoneRef = useRef(false);

  const loadConnectionProfiles = useProfileStore(s => s.loadConnectionProfiles);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const deleteConnectionProfiles = useProfileStore(s => s.deleteConnectionProfiles);
  const reset = useProfileStore(s => s.reset);
  const resetViewByProfile = useTabListStore(s => s.resetViewByProfile);

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

  const handleOpenConnectModal = (value: ConnectionProfile, mode: 'manualconnect' | 'editProfile') => {
    ConnectModal.show({
      mode: mode,
      connectionProfile: { ...value },
    });
  };

  const handleConnect = (key: string, value: ConnectionProfile) => async () => {
    if (!value || value.isConnected) return;
    if (autoConnectDoneRef.current && !value.secretKey) {
      handleOpenConnectModal(value, 'manualconnect');
      return;
    }
    openConnectLoading();
    try {
      const output = await callIPC(ConnectS3ByProfile, [key]);
      if (output?.isConnected) {
        updateConnectionProfiles(key, { ...value, isConnected: true });
      }
    } finally {
      closeConnectLoading();
    }
  };

  const handleDisconnect = (key: string, value: ConnectionProfile) => async () => {
    if (!value || !value.isConnected) return;
    openConnectLoading();
    try {
      const output = await callIPC(Disconnect, [key]);
      if (output) {
        updateConnectionProfiles(key, { ...value, isConnected: false });
        resetViewByProfile(key);
      }
    } finally {
      closeConnectLoading();
    }
  };

  const handleEditProfile = (value: ConnectionProfile) => () => {
    handleOpenConnectModal(value, 'editProfile');
  };

  const handleDeleteProfile = (value: ConnectionProfile) => async () => {
    const confirmModal = await ConfirmModal.show({
      type: 'warning',
      confirmCode: 'CFPF000002',
    });
    if (confirmModal && value.id) {
      const output = await callIPC(DeleteProfileById, [{ ...value }]);
      if (output) {
        deleteConnectionProfiles(value.id);
      }
    }
  };

  const handleMenuChange = (key: string) => (opened: boolean) => {
    setOpenedMenuKey(prev => {
      if (opened) return key;
      return prev === key ? null : prev;
    });
  };

  useEffect(() => {
    if (autoConnectDoneRef.current) return;

    const entries = Object.entries(connectionProfiles);
    if (entries.length === 0) return;

    autoConnectDoneRef.current = true;

    entries.forEach(([key, value]) => {
      if (!value?.autoConnect || value.isConnected) return;
      void handleConnect(key, value)();
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionProfiles]);

  const connectionProfilesComponent = Object.entries(connectionProfiles)
    .filter((entry): entry is [string, ConnectionProfile] => entry[1] !== undefined)
    .map(([key, value]) => {
      return (
        <Menu key={key} width={200} opened={openedMenuKey === key} onChange={handleMenuChange(key)}>
          <Menu.ContextMenu>
            <Card
              padding="8px"
              withBorder
              orientation="horizontal"
              onDoubleClick={handleConnect(key, value)}
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
                {connectLoading ? <Loader color="blue" size="sm" /> : value.isConnected ? <Cable /> : <Unplug />}
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
                <Text c="inherit" truncate="end">
                  {value.name}
                </Text>
              </Card.Section>
            </Card>
          </Menu.ContextMenu>

          <Menu.Dropdown>
            {!value.isConnected && (
              <Menu.Item onClick={handleConnect(key, value)}>{t('contextMenu.connect')}</Menu.Item>
            )}
            {value.isConnected && (
              <Menu.Item color="red" onClick={handleDisconnect(key, value)}>
                {t('contextMenu.disconnect')}
              </Menu.Item>
            )}
            <Menu.Item onClick={handleEditProfile(value)}>{t('contextMenu.edit')}</Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" onClick={handleDeleteProfile(value)}>
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
