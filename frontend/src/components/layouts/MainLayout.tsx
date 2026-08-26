import { AppShell, Group, Paper } from '@mantine/core';
import { useCallback, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

function MainLayout() {
  // const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  // const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);
  // const isMobile = useMediaQuery('(max-width: 48em)');

  const [width, setWidth] = useState(MAX_WIDTH);
  const [resizing, setResizing] = useState(false);
  const navbarRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!resizing) return;
      const left = navbarRef.current?.getBoundingClientRect().left ?? 0;
      const next = Math.min(Math.max(event.clientX - left, MIN_WIDTH), MAX_WIDTH);
      setWidth(next);
    },
    [resizing]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!resizing) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    },
    [resizing]
  );

  return (
    <AppShell
      header={{ height: '48px' }}
      navbar={{
        width: width,
        breakpoint: 'sm',
        // collapsed: { mobile: !mobileOpened },
      }}
      padding="4px"
      styles={{
        main: {
          height: '100vh',
          transition: resizing ? 'none' : undefined,
        },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="sm">
          {/* <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
          <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="sm" lineSize={2} /> */}
          Header has a burger icon below sm breakpoint
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        ref={navbarRef}
        styles={{
          navbar: {
            transition: resizing ? 'none' : 'width 300ms ease',
            border: 'none',
          },
        }}
        p={'4px 0px 4px 4px'}
      >
        <Paper shadow="xs" withBorder h="100%" p="8px" style={{ overflowX: 'hidden' }}>
          Navbar
        </Paper>

        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={() => setWidth(250)}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '6px',
            height: '100%',
            cursor: 'col-resize',
            zIndex: 10,
          }}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <Paper shadow="xs" withBorder h="100%" p="8px" style={{ overflow: 'auto' }}>
          <Outlet />
        </Paper>
      </AppShell.Main>
    </AppShell>
  );
}

export default MainLayout;
