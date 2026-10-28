import { AppShell, Group, Splitter, Tooltip } from '@mantine/core';
import { RotateCcwClock, Settings } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import ActionIcon from '@/components/buttons/ActionIcon';
import DownloaderWindow from '@/components/layouts/downloader/DownloaderWindow';
import LeftNavbar from '@/components/layouts/navbar/LeftNavbar';
import UploaderWindow from '@/components/layouts/uploader/UploaderWindow';
import { showHistoryModal, showSettingModal } from '@/components/modals/lazyModals';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

/** App shell: header (settings, history), navbar + routed page splitter, and transfer windows. */
function MainLayout() {
  const { t } = useTranslation('historyModal');
  const { t: tSetting } = useTranslation('settingModal');

  const onClickHistory = useCallback(() => {
    showHistoryModal();
  }, []);

  const onClickSetting = useCallback(() => {
    showSettingModal();
  }, []);

  return (
    <AppShell header={{ height: '48px' }} styles={{ main: { height: '100vh' } }}>
      <AppShell.Header>
        <Group h="100%" px="sm" style={{ backgroundColor: INFO_BG_COLOR }}>
          <Group gap="xs"></Group>
          <Group ml="auto">
            <Tooltip label={tSetting('title')}>
              <ActionIcon aria-label={tSetting('title')} color="gray" onClick={onClickSetting}>
                <Settings />
              </ActionIcon>
            </Tooltip>

            <Tooltip label={t('title')}>
              <ActionIcon aria-label={t('title')} color="gray" onClick={onClickHistory}>
                <RotateCcwClock />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Splitter h="100%">
          <Splitter.Pane defaultSize="18%" min="18%" p={'4px 4px 4px 4px'}>
            <LeftNavbar />
          </Splitter.Pane>
          <Splitter.Pane defaultSize="85%" min="50%" p={'4px 4px 4px 4px'}>
            <Outlet />
          </Splitter.Pane>
        </Splitter>

        <DownloaderWindow />
        <UploaderWindow />
      </AppShell.Main>
    </AppShell>
  );
}

export default MainLayout;
