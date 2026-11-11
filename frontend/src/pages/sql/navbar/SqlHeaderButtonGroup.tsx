import { Group, Stack } from '@mantine/core';
import { FileUp, ListPlus, PlugZap, RefreshCw } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';
import DbProfileModal from '@/pages/sql/modals/dbProfile/DbProfileModal';
import { notifyNoBackend } from '@/pages/sql/utils/sqlToast';

/** Button group on top of the SQL navbar; only "create" works, the others need the DB backend. */
function SqlHeaderButtonGroup() {
  const { t } = useTranslation('sqlNavbar');

  const onClickCreateProfile = useCallback(() => {
    void DbProfileModal.show();
  }, []);

  return (
    <Stack p="4px">
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

        <ActionIcon onClick={notifyNoBackend} tooltip={t('tooltip.refresh')} ml="auto">
          <RefreshCw />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
export default SqlHeaderButtonGroup;
