import { Badge, Box, Card, Group, isLightColor, Loader, Menu, Text } from '@mantine/core';
import { Cable, PlugZap, SquarePen, Trash, Unplug } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionProfile } from '@/common/stores/profileStore';
import { getAuthType } from '@/common/utils/authUtils';
import classes from '@/components/layouts/navbar/components/ConnectionProfileItem.module.css';

/** Black/white text that contrasts with the user-chosen profile color; theme text when no color is set. */
const getProfileTextColor = (color?: string) =>
  color
    ? isLightColor(color)
      ? 'var(--mantine-color-black)'
      : 'var(--mantine-color-white)'
    : 'var(--mantine-color-text)';

type ConnectionProfileItemProps = {
  profileKey: string;
  profile: ConnectionProfile;
  connecting: boolean;
  menuOpened: boolean;
  // Callbacks must be stable (owned by the parent) so memo skips unchanged items.
  onConnect: (key: string) => void;
  onDisconnect: (key: string) => void;
  onEdit: (key: string) => void;
  onDelete: (key: string) => void;
  onMenuChange: (key: string, opened: boolean) => void;
};

function ConnectionProfileItem({
  profileKey,
  profile,
  connecting,
  menuOpened,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  onMenuChange,
}: ConnectionProfileItemProps) {
  const { t } = useTranslation(['connectionProfiles', 'connectModal']);

  const onChangeMenu = useCallback((opened: boolean) => onMenuChange(profileKey, opened), [onMenuChange, profileKey]);
  const onClickConnect = useCallback(() => onConnect(profileKey), [onConnect, profileKey]);
  const onClickDisconnect = useCallback(() => onDisconnect(profileKey), [onDisconnect, profileKey]);
  const onClickEdit = useCallback(() => onEdit(profileKey), [onEdit, profileKey]);
  const onClickDelete = useCallback(() => onDelete(profileKey), [onDelete, profileKey]);

  return (
    <Menu width={200} opened={menuOpened} onChange={onChangeMenu}>
      <Menu.ContextMenu>
        <Card
          padding="8px"
          withBorder
          orientation="horizontal"
          onDoubleClick={onClickConnect}
          c={getProfileTextColor(profile.color)}
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
              // Status uses Mantine "light" variant colors: connected = green, disconnected = red
              color: profile.isConnected
                ? 'var(--mantine-color-green-light-color)'
                : 'var(--mantine-color-red-light-color)',
              backgroundColor: profile.isConnected
                ? 'var(--mantine-color-green-light)'
                : 'var(--mantine-color-red-light)',
            }}
          >
            {connecting ? <Loader color="blue" size="sm" /> : profile.isConnected ? <Cable /> : <Unplug />}
          </Card.Section>
          <Card.Section
            px="xs"
            inheritPadding
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              backgroundColor: profile.color ?? 'var(--mantine-color-body)',
            }}
          >
            {/* miw=0 lets the flex item shrink below its content width so truncate can apply */}
            <Box flex={1} miw={0}>
              <Text c="inherit" truncate="end" title={profile.name}>
                {profile.name}
              </Text>
              <Group gap="xs" wrap="nowrap">
                <Text c="dimmed" truncate="end">
                  {profile.provider}
                </Text>
                <Badge size="xs" variant="light" color="var(--mantine-color-gray-6)" style={{ flexShrink: 0 }}>
                  {t(`connectModal:authType.${getAuthType(profile)}.label`)}
                </Badge>
              </Group>
            </Box>
          </Card.Section>
        </Card>
      </Menu.ContextMenu>

      <Menu.Dropdown>
        {!profile.isConnected && (
          <Menu.Item leftSection={<PlugZap size="16px" />} onClick={onClickConnect}>
            {t('contextMenu.connect')}
          </Menu.Item>
        )}
        {profile.isConnected && (
          <Menu.Item leftSection={<Unplug size="16px" />} color="red" onClick={onClickDisconnect}>
            {t('contextMenu.disconnect')}
          </Menu.Item>
        )}
        {!profile.isConnected && (
          <Menu.Item leftSection={<SquarePen size="16px" />} onClick={onClickEdit}>
            {t('contextMenu.edit')}
          </Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item leftSection={<Trash size="16px" />} color="red" onClick={onClickDelete}>
          {t('contextMenu.delete')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export default memo(ConnectionProfileItem);
