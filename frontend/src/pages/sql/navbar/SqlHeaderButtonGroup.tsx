import { Group, Stack } from '@mantine/core';
import { FileUp, ListPlus, PlugZap, RefreshCw } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { notifyNoBackend } from '@/pages/sql/utils/sqlToast';

/** Nhóm nút phía trên thanh điều hướng SQL; tạo mới và làm mới đã hoạt động, còn kết nối và nhập dữ liệu vẫn cần backend DB. */
function SqlHeaderButtonGroup() {
  const { t } = useTranslation('sqlNavbar');
  const loadDbProfiles = useDbProfileStore(s => s.loadDbProfiles);

  const onClickCreateProfile = useCallback(() => {
    void DbProfileModal.show();
  }, []);

  const onClickRefresh = useCallback(async () => {
    await loadDbProfiles();
  }, [loadDbProfiles]);

  return (
    <Stack p="0.25rem">
      <Group gap="xs">
        <ActionIcon onClick={notifyNoBackend} tooltip={t('tooltip.connect')}>
          <PlugZap />
        </ActionIcon>

        <ActionIcon onClick={onClickCreateProfile} tooltip={t('tooltip.createProfile')}>
          <ListPlus />
        </ActionIcon>

        <ActionIcon onClick={notifyNoBackend} tooltip={t('tooltip.importProfile')}>
          <FileUp />
        </ActionIcon>

        <ActionIcon onClick={onClickRefresh} tooltip={t('tooltip.refresh')} ml="auto">
          <RefreshCw />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
export default SqlHeaderButtonGroup;
