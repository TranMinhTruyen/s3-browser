import { AppShell, Group, SegmentedControl, Splitter } from '@mantine/core';
import { Outlet } from 'react-router-dom';
import DownloaderWindow from '@/components/layouts/downloader/DownloaderWindow';
import LeftNavbar from '@/components/layouts/navbar/LeftNavbar';
import i18n from '@/locales/i18n';

function MainLayout() {
  return (
    <AppShell header={{ height: '48px' }} styles={{ main: { height: '100vh' } }}>
      <AppShell.Header>
        <Group h="100%" px="sm" style={{ backgroundColor: '#d0ebff' }}>
          <Group gap="xs"></Group>
          <Group ml="auto">
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
          <Splitter.Pane defaultSize="15%" min="10%" p={'4px 4px 4px 4px'}>
            <LeftNavbar />
          </Splitter.Pane>
          <Splitter.Pane defaultSize="85%" min="50%" p={'4px 4px 4px 4px'}>
            <Outlet />
          </Splitter.Pane>
        </Splitter>

        <DownloaderWindow />
      </AppShell.Main>
    </AppShell>
  );
}

export default MainLayout;
