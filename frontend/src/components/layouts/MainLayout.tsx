import { AppShell, Group, SegmentedControl, Splitter, Tooltip } from '@mantine/core';
import { RotateCcwClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import ActionIcon from '@/components/buttons/ActionIcon';
import DownloaderWindow from '@/components/layouts/downloader/DownloaderWindow';
import LeftNavbar from '@/components/layouts/navbar/LeftNavbar';
import UploaderWindow from '@/components/layouts/uploader/UploaderWindow';
import HistoryModal from '@/components/modals/HistoryModal';
import i18n from '@/locales/i18n';

function MainLayout() {
  const { t } = useTranslation('historyModal');

  return (
    <AppShell header={{ height: '48px' }} styles={{ main: { height: '100vh' } }}>
      <AppShell.Header>
        <Group h="100%" px="sm" style={{ backgroundColor: '#d0ebff' }}>
          <Group gap="xs"></Group>
          <Group ml="auto">
            <Tooltip label={t('title')}>
              <ActionIcon
                aria-label={t('title')}
                color="gray"
                onClick={() => {
                  HistoryModal.show();
                }}
              >
                <RotateCcwClock />
              </ActionIcon>
            </Tooltip>

            <SegmentedControl<'en' | 'ja' | 'vi'>
              defaultValue={'en'}
              onChange={(value: 'en' | 'ja' | 'vi') => i18n.changeLanguage(value)}
              style={{ height: '35px' }}
              data={[
                {
                  label: 'EN',
                  value: 'en',
                },
                {
                  label: 'VI',
                  value: 'vi',
                },
                {
                  label: 'JA',
                  value: 'ja',
                },
              ]}
            />
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
