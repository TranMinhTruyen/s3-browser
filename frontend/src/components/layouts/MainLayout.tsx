import { AppShell, Group, Splitter } from '@mantine/core';
import { Outlet } from 'react-router-dom';
import LeftNavbar from '@/components/layouts/navbar/LeftNavbar';

function MainLayout() {
  return (
    <AppShell header={{ height: '48px' }} styles={{ main: { height: '100vh' } }}>
      <AppShell.Header>
        <Group h="100%" px="sm">
          Header
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Splitter h="100%">
          <Splitter.Pane defaultSize="15%" min="10%" max="100%" p={'8px 4px 8px 8px'}>
            <LeftNavbar />
          </Splitter.Pane>
          <Splitter.Pane defaultSize="85%" p={'8px 8px 8px 4px'}>
            <Outlet />
          </Splitter.Pane>
        </Splitter>
      </AppShell.Main>
    </AppShell>
  );
}

export default MainLayout;
