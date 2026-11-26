import { Badge, Box, Card, Group, isLightColor, Loader, useComputedColorScheme } from '@mantine/core';
import { Cable, Unplug } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import classes from '@/components/display/ProfileCard.module.css';
import TruncatedText from '@/components/display/TruncatedText';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { getAuthType } from '@/pages/s3/utils/authUtils';

/** Chiều cao thẻ cố định: hàng không đổi kích thước theo nội dung hoặc phông chữ nên danh sách ảo dùng trực tiếp được. */
export const CARD_HEIGHT = 68;

/** Tỷ lệ màu profile được giữ lại ở chế độ tối; phần còn lại lấy màu nền để màu sáng không gây chói. */
const DARK_COLOR_PERCENT = 35;

/** Chữ đen/trắng tương phản với màu profile do người dùng chọn; dùng màu chữ theo giao diện nếu không có màu hoặc ở chế độ tối. */
const getProfileTextColor = (color: string | undefined, dark: boolean) =>
  color && !dark
    ? isLightColor(color)
      ? 'var(--mantine-color-black)'
      : 'var(--mantine-color-white)'
    : 'var(--mantine-color-text)';

/** Màu profile theo lựa chọn ở chế độ sáng, được làm dịu về màu nền trong chế độ tối. */
const getProfileBackground = (color: string | undefined, dark: boolean) => {
  if (!color) return 'var(--mantine-color-body)';
  return dark ? `color-mix(in srgb, ${color} ${DARK_COLOR_PERCENT}%, var(--mantine-color-body))` : color;
};

type ConnectionProfileItemProps = {
  profileKey: string;
  connecting: boolean;
  // Phải ổn định (do component cha quản lý) để memo bỏ qua các mục không đổi.
  onConnect: (key: string) => void;
};

// Tự chọn profile của mình nên kết nối/ngắt kết nối một profile chỉ render lại mục tương ứng.
// Menu ngữ cảnh dùng chung do ConnectionProfiles quản lý; mỗi hàng có `data-profile-key` để menu xác định hàng.
function ConnectionProfileItem({ profileKey, connecting, onConnect }: ConnectionProfileItemProps) {
  const { t } = useTranslation('connectModal');
  const profile = useProfileStore(s => s.connectionProfiles[profileKey]);
  const dark = useComputedColorScheme('light') === 'dark';

  const onDoubleClickCard = useCallback(() => onConnect(profileKey), [onConnect, profileKey]);

  if (!profile) return null;

  return (
    <Card
      padding="0.5rem"
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
          minWidth: '2.5rem',
          justifyContent: 'center',
          // Trạng thái dùng màu của biến thể "light" trong Mantine: xanh khi kết nối, đỏ khi mất kết nối.
          color: profile.isConnected
            ? 'var(--mantine-color-green-light-color)'
            : 'var(--mantine-color-red-light-color)',
          backgroundColor: profile.isConnected ? 'var(--mantine-color-green-light)' : 'var(--mantine-color-red-light)',
          // Dùng vạch phân cách nhạt để ô trạng thái vẫn tách biệt khi profile có màu cùng tông.
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
