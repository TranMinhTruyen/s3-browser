import { Badge, Box, Card, Group, isLightColor, Loader, Text } from '@mantine/core';
import { Cable, Unplug } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '@/common/stores/profileStore';
import { getAuthType } from '@/common/utils/authUtils';
import classes from '@/components/layouts/navbar/components/ConnectionProfileItem.module.css';

/** Fixed card height: rows never change size with content or font, so the virtual list can use it as-is. */
export const CARD_HEIGHT = 68;

/** Black/white text that contrasts with the user-chosen profile color; theme text when no color is set. */
const getProfileTextColor = (color?: string) =>
  color
    ? isLightColor(color)
      ? 'var(--mantine-color-black)'
      : 'var(--mantine-color-white)'
    : 'var(--mantine-color-text)';

type ConnectionProfileItemProps = {
  profileKey: string;
  connecting: boolean;
  // Must be stable (owned by the parent) so memo skips unchanged items.
  onConnect: (key: string) => void;
};

// Selects its own profile, so connecting/disconnecting one profile re-renders only this item.
// The context menu is shared and owned by ConnectionProfiles; rows carry `data-profile-key` for it.
function ConnectionProfileItem({ profileKey, connecting, onConnect }: ConnectionProfileItemProps) {
  const { t } = useTranslation('connectModal');
  const profile = useProfileStore(s => s.connectionProfiles[profileKey]);

  const onDoubleClickCard = useCallback(() => onConnect(profileKey), [onConnect, profileKey]);

  if (!profile) return null;

  return (
    <Card
      padding="8px"
      withBorder
      orientation="horizontal"
      h={CARD_HEIGHT}
      data-profile-key={profileKey}
      onDoubleClick={onDoubleClickCard}
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
          backgroundColor: profile.isConnected ? 'var(--mantine-color-green-light)' : 'var(--mantine-color-red-light)',
        }}
      >
        {connecting ? (
          <Loader color="var(--mantine-color-blue-filled)" size="sm" />
        ) : profile.isConnected ? (
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
          backgroundColor: profile.color ?? 'var(--mantine-color-body)',
        }}
      >
        {/* miw=0 lets the flex item shrink below its content width so truncate can apply */}
        <Box flex={1} miw={0}>
          <Text c="inherit" truncate="end" title={profile.name}>
            {profile.name}
          </Text>
          <Group gap="xs" wrap="nowrap">
            <Text c="inherit" truncate="end" className={classes.provider}>
              {profile.provider}
            </Text>
            <Badge size="xs" variant="outline" className={classes.badge} style={{ flexShrink: 0 }}>
              {t(`authType.${getAuthType(profile)}.label`)}
            </Badge>
          </Group>
        </Box>
      </Card.Section>
    </Card>
  );
}

export default memo(ConnectionProfileItem);
