import { Card, isLightColor, Menu, Stack, Text } from '@mantine/core';
import { ConnectS3ByProfile, Disconnect } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models/profile/models';
import { Events } from '@wailsio/runtime';
import { Cable, Unplug } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useNavBarStore } from '@/common/stores/navBarStore';
import { callIPC } from '@/common/utils/ipcUtils';

function ConnectionProfiles() {
  const loadConnectionProfiles = useNavBarStore(s => s.loadConnectionProfiles);
  const updateConnectionProfiles = useNavBarStore(s => s.updateConnectionProfiles);
  const reset = useNavBarStore(s => s.reset);
  const connectionProfiles = useNavBarStore(s => s.connectionProfiles);

  useEffect(() => {
    loadConnectionProfiles();

    return () => {
      reset();
    };
  }, [loadConnectionProfiles, reset]);

  useEffect(() => {
    const unsubscribe = Events.On('profile:reload-connection-profiles', () => {
      loadConnectionProfiles();
    });

    return () => {
      unsubscribe();
    };
  }, [loadConnectionProfiles]);

  const handleConnect = useCallback(
    (key: string, value: ConnectionProfileOutput) => async () => {
      const output = await callIPC(() => ConnectS3ByProfile(key));
      if (output && output.isConnected) {
        updateConnectionProfiles(key, { ...value, isConnected: output.isConnected });
      }
    },
    [updateConnectionProfiles]
  );

  const handleDisconnect = useCallback(
    (connectionId: string, value: ConnectionProfileOutput) => async () => {
      const output = await callIPC(() => Disconnect(connectionId));
      if (output) {
        updateConnectionProfiles(connectionId, { ...value, isConnected: false });
      }
    },
    [updateConnectionProfiles]
  );

  const connectionProfilesComponent = useMemo(
    () =>
      Object.entries(connectionProfiles)
        .filter((entry): entry is [string, ConnectionProfileOutput] => entry[1] !== undefined)
        .map(([key, value]) => (
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
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}
                >
                  {value.isConnected ? <Cable /> : <Unplug />}
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
        )),
    [connectionProfiles, handleConnect, handleDisconnect]
  );

  return (
    <Stack h="100%" gap="8px" align="stretch">
      {connectionProfilesComponent}
    </Stack>
  );
}

export default ConnectionProfiles;
