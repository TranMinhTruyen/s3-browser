import { AppShell, Group, Image, Splitter, Text, Tooltip } from '@mantine/core';
import { Window } from '@wailsio/runtime';
import { RotateCcwClock, Settings } from 'lucide-react';
import { type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import ActionIcon from '@/components/buttons/ActionIcon';
import LeftNavbar from '@/components/layouts/navbar/LeftNavbar';
import DownloaderWindow from '@/components/layouts/transfer/downloader/DownloaderWindow';
import UploaderWindow from '@/components/layouts/transfer/uploader/UploaderWindow';
import WindowControls from '@/components/layouts/window/WindowControls';
import { showHistoryModal, showSettingModal } from '@/components/modals/lazyModals';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

/** App shell: header (settings, history), navbar + routed page splitter, and transfer windows. */
function MainLayout() {
  const { t } = useTranslation('historyModal');
  const { t: tSetting } = useTranslation('settingModal');
  const { t: tCommon } = useTranslation('common');

  const onClickHistory = useCallback(() => {
    showHistoryModal();
  }, []);

  const onDoubleClickHeader = useCallback((e: MouseEvent<HTMLElement>) => {
    if (!(e.target as HTMLElement).closest('button')) Window.ToggleMaximise();
  }, []);

  const onClickSetting = useCallback(() => {
    showSettingModal();
  }, []);

  return (
    <AppShell header={{ height: '48px' }} styles={{ main: { height: '100vh' } }}>
      <AppShell.Header>
        <Group
          h="100%"
          px="sm"
          style={{ backgroundColor: INFO_BG_COLOR, '--wails-draggable': 'drag' }}
          onDoubleClick={onDoubleClickHeader}
        >
          <Group gap="xs" wrap="nowrap">
            <Image src="/favicon.ico" alt="" w={20} h={20} />
            <Text fw={600}>{tCommon('appName')}</Text>
          </Group>

          <Group gap="xs" wrap="nowrap" ml="auto" style={{ '--wails-draggable': 'no-drag' }}>
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

            <WindowControls />
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
