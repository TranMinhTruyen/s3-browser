import { AppShell, Box, Burger, Group, Paper } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Outlet } from 'react-router-dom';

function MainLayout() {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);
  const isMobile = useMediaQuery('(max-width: 48em)');

  return (
    <AppShell
      header={{ height: '48px' }}
      navbar={{
        width: !desktopOpened ? '250px' : '80px',
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened },
      }}
      padding="8px"
      styles={{
        main: {
          height: '100vh',
        },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="sm">
          {/* Burger mobile */}
          <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
          {/* Burger desktop */}
          <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="sm" />
          Header has a burger icon below sm breakpoint
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        styles={{
          navbar: {
            transition: 'width 300ms ease',
            border: 'none',
          },
        }}
        p={isMobile ? '8px' : '8px 0px 8px 8px'}
      >
        <Paper shadow="xs" withBorder h="100%">
          <Box p="8px">Navbar</Box>
        </Paper>
      </AppShell.Navbar>

      <AppShell.Main>
        <Paper shadow="xs" withBorder h="100%">
          <Box p="8px">
            <Outlet />
          </Box>
        </Paper>
      </AppShell.Main>
    </AppShell>
  );
}
export default MainLayout;
