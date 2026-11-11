import { Badge, Box, Card, Group, isLightColor, Loader, useComputedColorScheme } from '@mantine/core';
import { Cable, Unplug } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import classes from '@/components/display/ProfileCard.module.css';
import TruncatedText from '@/components/display/TruncatedText';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { getAuthType } from '@/pages/s3/utils/authUtils';

/** Fixed card height: rows never change size with content or font, so the virtual list can use it as-is. */
export const CARD_HEIGHT = 68;

/** Share of the profile color kept in dark mode; the rest is the body color, so light colors don't glare. */
const DARK_COLOR_PERCENT = 35;

/** Black/white text that contrasts with the user-chosen profile color; theme text when no color or in dark mode. */
const getProfileTextColor = (color: string | undefined, dark: boolean) =>
  color && !dark
    ? isLightColor(color)
      ? 'var(--mantine-color-black)'
      : 'var(--mantine-color-white)'
    : 'var(--mantine-color-text)';

/** The profile color as chosen in light mode, dimmed toward the body color in dark mode. */
const getProfileBackground = (color: string | undefined, dark: boolean) => {
  if (!color) return 'var(--mantine-color-body)';
  return dark ? `color-mix(in srgb, ${color} ${DARK_COLOR_PERCENT}%, var(--mantine-color-body))` : color;
};

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
  const dark = useComputedColorScheme('light') === 'dark';

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
      c={getProfileTextColor(profile.color, dark)}
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
          // Light divider so the status cell stays apart from a profile color of the same hue
          borderRight: '1px solid var(--mantine-color-default-border)',
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
          backgroundColor: getProfileBackground(profile.color, dark),
        }}
      >
        {/* miw=0 lets the flex item shrink below its content width so truncate can apply */}
        <Box flex={1} miw={0}>
          <TruncatedText c="inherit">{profile.name}</TruncatedText>
          <Group gap="xs" wrap="nowrap">
            <TruncatedText c="inherit" className={classes.provider}>
              {profile.provider}
            </TruncatedText>
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
