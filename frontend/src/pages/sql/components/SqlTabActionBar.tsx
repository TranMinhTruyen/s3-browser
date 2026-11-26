import { Group } from '@mantine/core';
import { Play, PlugZap, Square } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';
import Combobox from '@/components/inputs/combobox/Combobox';

type SqlTabActionBarProps = {
  isConnected: boolean;
  selectedProfileId: string | null;
  profileOptions: { name: string; value: string }[];
  onChangeSelectProfile: (value: string | null) => void;
  onClickConnect: () => void;
  onClickExecute: () => void;
  /** Đang thực thi truy vấn: Execute bị tắt và nút Cancel được hiển thị. */
  running: boolean;
  onClickCancel: () => void;
};

/** Thanh công cụ của tab SQL: chọn hồ sơ, kết nối, thực thi và hủy. */
function SqlTabActionBar(props: SqlTabActionBarProps) {
  const {
    isConnected,
    selectedProfileId,
    profileOptions,
    onChangeSelectProfile,
    onClickConnect,
    onClickExecute,
    running,
    onClickCancel,
  } = props;
  const { t } = useTranslation('sqlTab');

  return (
    <Group gap="xs" p="0.25rem" style={{ flexShrink: 0 }}>
      <Combobox
        value={selectedProfileId}
        onChange={onChangeSelectProfile}
        data={profileOptions}
        searchPlaceholder={t('search.placeholderProfile')}
        emptyText={t('search.emptyProfile')}
        style={{ width: '12.5rem' }}
      />

      <ActionIcon onClick={onClickConnect} tooltip={t('tooltip.connect')} disabled={isConnected || !selectedProfileId}>
        <PlugZap />
      </ActionIcon>

      {/* Running only needs a chosen profile, not a connection. */}
      <ActionIcon onClick={onClickExecute} tooltip={t('tooltip.execute')} disabled={!selectedProfileId || running}>
        <Play />
      </ActionIcon>

      {running && (
        <ActionIcon onClick={onClickCancel} tooltip={t('tooltip.cancel')} color="var(--mantine-color-red-6)">
          <Square />
        </ActionIcon>
      )}
    </Group>
  );
}
export default memo(SqlTabActionBar);
