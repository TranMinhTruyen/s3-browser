import { Badge, Box, Card, Group, isLightColor, useComputedColorScheme } from '@mantine/core';
import { Cable, ChevronDown, ChevronRight, Unplug } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';
import classes from '@/components/display/ProfileCard.module.css';
import TruncatedText from '@/components/display/TruncatedText';
import { type DbProfile, PROVIDER_LABEL_KEY, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useDbTreeStore } from '@/pages/sql/stores/dbTreeStore';

/** Chiều cao thẻ cố định, giống thẻ profile S3 để danh sách ảo có thể dùng trực tiếp. */
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

/** Dòng thứ hai của thẻ: vị trí database. */
const getLocation = ({ provider, config }: DbProfile) =>
  provider === 'sqlite' ? (config.filePath ?? '') : `${config.host}:${config.port}/${config.database}`;

type DbProfileItemProps = {
  profileKey: string;
  // Phải ổn định (do component cha quản lý) để memo bỏ qua các mục không đổi.
  onConnect: (key: string) => void;
  /** Mở hoặc đóng cây đối tượng bên dưới thẻ (Accordion). */
  onToggleTree: (key: string) => void;
};

// Tự chọn profile của mình nên kết nối một profile chỉ render lại mục tương ứng.
// Menu ngữ cảnh dùng chung do DbProfiles quản lý; mỗi hàng có `data-profile-key` để menu xác định hàng.
function DbProfileItem({ profileKey, onConnect, onToggleTree }: DbProfileItemProps) {
  const { t } = useTranslation('sqlNavbar');
  const profile = useDbProfileStore(s => s.dbProfiles[profileKey]);
  const treeOpen = useDbTreeStore(s => !!s.opened[profileKey]);
  const dark = useComputedColorScheme('light') === 'dark';

  const onDoubleClickCard = useCallback(() => onConnect(profileKey), [onConnect, profileKey]);
  const onClickToggleTree = useCallback(() => onToggleTree(profileKey), [onToggleTree, profileKey]);

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
          borderRight: '1px solid var(--mantine-color-default-border)',
        }}
      >
        {profile.isConnected ? <Cable /> : <Unplug />}
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
              {getLocation(profile)}
            </TruncatedText>
            <Badge size="xs" variant="outline" className={classes.badge} style={{ flexShrink: 0 }}>
              {t(`dbType.${PROVIDER_LABEL_KEY[profile.provider]}`)}
            </Badge>
          </Group>
        </Box>
        {profile.isConnected && (
          <ActionIcon
            variant="subtle"
            c="inherit"
            ml="xs"
            tooltip={t(treeOpen ? 'tree.collapse' : 'tree.expand')}
            onClick={onClickToggleTree}
          >
            {treeOpen ? <ChevronDown /> : <ChevronRight />}
          </ActionIcon>
        )}
      </Card.Section>
    </Card>
  );
}

export default memo(DbProfileItem);
