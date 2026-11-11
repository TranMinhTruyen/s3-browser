import { Group, Stack } from '@mantine/core';
import { ChooseImportFile, ImportProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { FileUp, ListPlus, PlugZap, RefreshCw } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import { showConnectModal, showImportPasswordModal } from '@/components/modals/lazyModals';
import { type ConnectionProfile, useProfileStore } from '@/pages/s3/stores/profileStore';

function S3HeaderButtonGroup() {
  const { t } = useTranslation('connectionProfiles');
  const loadConnectionProfiles = useProfileStore(s => s.loadConnectionProfiles);
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const importing = useRef(false);

  const onClickConnect = useCallback(() => {
    showConnectModal({ mode: 'connect' });
  }, []);

  const onClickCreateProfile = useCallback(() => {
    showConnectModal({ mode: 'createProfile' });
  }, []);

  const addProfile = useCallback(
    (profile: ConnectionProfile | null | undefined) => {
      if (profile) updateConnectionProfiles(profile.id, profile);
    },
    [updateConnectionProfiles]
  );

  // Picks a profile file and adds it to the list as a new profile; never connects (even with autoConnect).
  const importProfileFromFile = useCallback(async () => {
    const file = await callIPC(ChooseImportFile, []);
    if (!file?.path) return null;
    return file.encrypted
      ? showImportPasswordModal({ path: file.path, name: file.name })
      : callIPC(ImportProfile, [{ path: file.path, password: '' }]);
  }, []);

  const onClickImportProfile = useCallback(async () => {
    if (importing.current) return;
    importing.current = true;
    try {
      addProfile(await importProfileFromFile());
    } finally {
      importing.current = false;
    }
  }, [importProfileFromFile, addProfile]);

  const onClickRefresh = useCallback(async () => {
    await loadConnectionProfiles();
  }, [loadConnectionProfiles]);

  return (
    <Stack p="4px">
      <Group gap="xs">
        <ActionIcon onClick={onClickConnect} tooltip={t('tooltip.connect')}>
          <PlugZap />
        </ActionIcon>

        <ActionIcon onClick={onClickCreateProfile} tooltip={t('tooltip.createProfile')}>
          <ListPlus />
        </ActionIcon>

        <ActionIcon onClick={onClickImportProfile} tooltip={t('tooltip.importProfile')}>
          <FileUp />
        </ActionIcon>

        <ActionIcon onClick={onClickRefresh} tooltip={t('tooltip.refresh')} ml="auto">
          <RefreshCw />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
export default S3HeaderButtonGroup;
