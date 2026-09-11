import NiceModal from '@ebay/nice-modal-react';
import { Card, isLightColor, Loader, Menu, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { ConnectS3ByProfile, Disconnect } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models/profile/models';
import { Events } from '@wailsio/runtime';
import { Cable, Unplug } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavBarStore } from '@/common/stores/navBarStore';
import { callIPC } from '@/common/utils/ipcUtils';
import S3ConnectModal from '@/components/modals/S3ConnectModal';

function ConnectionProfiles() {
  const loadConnectionProfiles = useNavBarStore(s => s.loadConnectionProfiles);
  const updateConnectionProfiles = useNavBarStore(s => s.updateConnectionProfiles);
  const reset = useNavBarStore(s => s.reset);
  const connectionProfiles = useNavBarStore(s => s.connectionProfiles);
  const autoConnectDoneRef = useRef(false);

  const [connectLoading, { open: openConnectLoading, close: closeConnectLoading }] = useDisclosure();

  useEffect(() => {
    loadConnectionProfiles();

    return () => {
      reset();
    };
  }, [loadConnectionProfiles, reset]);

  useEffect(() => {
    const unsubscribe = Events.On('profile:reload-connection-profiles', () => {
      autoConnectDoneRef.current = false;
      loadConnectionProfiles();
    });

    return () => {
      unsubscribe();
    };
  }, [loadConnectionProfiles]);

  const handleOpenConnectToS3Modal = (value: ConnectionProfileOutput) => {
    NiceModal.show(S3ConnectModal, {
      mode: 'edit',
      id: value.id,
      version: value.version,
      connectionInfo: { ...value },
    });
  };

  const handleConnect = (key: string, value: ConnectionProfileOutput) => async () => {
    if (!value || value.isConnected) return;
    if (autoConnectDoneRef.current && !value.savePassword) {
      handleOpenConnectToS3Modal(value);
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

  const handleDisconnect = (key: string, value: ConnectionProfileOutput) => async () => {
    if (!value || !value.isConnected) return;
    openConnectLoading();
    try {
      const output = await callIPC(Disconnect, [key]);
      if (output) {
        updateConnectionProfiles(key, { ...value, isConnected: false });
      }
    } finally {
      closeConnectLoading();
    }
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
    .filter((entry): entry is [string, ConnectionProfileOutput] => entry[1] !== undefined)
    .map(([key, value]) => {
      return (
        <Menu key={key} shadow="md" width={200}>
          <Menu.ContextMenu>
            <Card
              padding="xs"
              withBorder
              orientation="horizontal"
              onDoubleClick={handleConnect(key, value)}
              bg={value.color ?? 'indigo'}
              c={isLightColor(value.color ?? 'indigo') ? 'black' : 'white'}
              style={{
                cursor: 'pointer',
              }}
            >
              <Card.Section
                inheritPadding
                px="xs"
                withBorder
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  minWidth: '56px',
                  justifyContent: 'center',
                  backgroundColor: value.isConnected ? '#1ae300' : '',
                }}
              >
                {connectLoading ? <Loader color="blue" size="sm" /> : value.isConnected ? <Cable /> : <Unplug />}
              </Card.Section>
              <Card.Section
                inheritPadding
                px="xs"
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}
              >
                <Text c="inherit" truncate="end">
                  {value.name}
                </Text>
              </Card.Section>
            </Card>
          </Menu.ContextMenu>

          <Menu.Dropdown>
            {!value.isConnected && <Menu.Item onClick={handleConnect(key, value)}>Connect</Menu.Item>}
            {value.isConnected && (
              <Menu.Item color="red" onClick={handleDisconnect(key, value)}>
                Disconnect
              </Menu.Item>
            )}
            <Menu.Item>Edit</Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red">Delete</Menu.Item>
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
