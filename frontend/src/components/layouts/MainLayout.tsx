import { AppShell, Group, Paper } from '@mantine/core';
import { useCallback, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { MAX_WIDTH, MIN_WIDTH, useNavBarStore } from '@/common/stores/navBarStore';
import LeftNavbar from '@/components/layouts/navbar/LeftNavbar';

function MainLayout() {
  const [resizing, setResizing] = useState(false);

  const navbarRef = useRef<HTMLDivElement>(null);
  const setLeftNavbarWidth = useNavBarStore(s => s.setLeftNavbarWidth);
  const leftNavbarWidth = useNavBarStore(s => s.leftNavbarWidth);

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
      setLeftNavbarWidth(next);
    },
    [resizing, setLeftNavbarWidth]
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
      navbar={{ width: leftNavbarWidth, breakpoint: 'sm' }}
      padding="4px"
      styles={{ main: { height: '100vh' } }}
    >
      <AppShell.Header>
        <Group h="100%" px="sm">
          Header
        </Group>
      </AppShell.Header>

      <AppShell.Navbar ref={navbarRef} styles={{ navbar: { border: 'none' } }} p={'4px 0px 4px 4px'}>
        <LeftNavbar />
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={() => setLeftNavbarWidth(MAX_WIDTH)}
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
