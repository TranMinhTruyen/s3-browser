import { act, fireEvent, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DbProfileItem, { CARD_HEIGHT } from '@/pages/sql/navbar/DbProfileItem';
import { type DbProfile, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const scheme = vi.hoisted(() => ({ value: 'light' as 'light' | 'dark' }));
vi.mock('@mantine/core', async importActual => {
  const actual = await importActual<typeof import('@mantine/core')>();
  return { ...actual, useComputedColorScheme: () => scheme.value };
});

const onConnect = vi.fn();

const pg: DbProfile = {
  id: 'p1',
  name: 'My PG',
  color: '#d0ebff',
  dbType: 'postgresql',
  host: 'db.local',
  port: 5433,
  database: 'app',
  username: 'u',
  password: '',
  sslMode: 'prefer',
  filePath: '',
  isConnected: false,
};

function renderItem(profile: Partial<DbProfile> = {}) {
  useDbProfileStore.setState({ dbProfiles: { p1: { ...pg, ...profile } } });
  return renderWithProviders(<DbProfileItem profileKey="p1" onConnect={onConnect} />);
}

const card = () => screen.getByText('My PG').closest<HTMLElement>('.mantine-Card-root')!;
const section = () => card().querySelectorAll<HTMLElement>('.mantine-Card-section')[1];
const status = () => card().querySelectorAll<HTMLElement>('.mantine-Card-section')[0];

describe('DbProfileItem', () => {
  beforeEach(() => {
    scheme.value = 'light';
    useDbProfileStore.setState({ dbProfiles: {} });
  });

  it('exports the fixed card height', () => {
    expect(CARD_HEIGHT).toBe(68);
  });

  it('shows the name, host:port/database and the DB type badge for PostgreSQL', () => {
    renderItem();
    expect(screen.getByText('My PG')).toBeInTheDocument();
    expect(screen.getByText('db.local:5433/app')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
  });

  it('shows the file path and the SQLite badge for SQLite', () => {
    renderItem({ dbType: 'sqlite', filePath: 'C:/data/a.db', host: '', port: 0, database: '' });
    expect(screen.getByText('C:/data/a.db')).toBeInTheDocument();
    expect(screen.getByText('SQLite')).toBeInTheDocument();
  });

  it('carries the profile key for the shared context menu', () => {
    renderItem();
    expect(card()).toHaveAttribute('data-profile-key', 'p1');
  });

  it('renders nothing when the profile does not exist', () => {
    const { container } = renderWithProviders(<DbProfileItem profileKey="gone" onConnect={onConnect} />);
    expect(container.querySelector('.mantine-Card-root')).not.toBeInTheDocument();
  });

  it('connects on double click with the profile key', () => {
    renderItem();
    fireEvent.doubleClick(card());
    expect(onConnect).toHaveBeenCalledWith('p1');
  });

  describe('re-render (D31e)', () => {
    const renderCounted = () => {
      const onRender = vi.fn();
      useDbProfileStore.setState({ dbProfiles: { p1: pg, p2: { ...pg, id: 'p2', name: 'Other' } } });
      renderWithProviders(
        <Profiler id="item" onRender={onRender}>
          <DbProfileItem profileKey="p1" onConnect={onConnect} />
        </Profiler>
      );
      onRender.mockClear();
      return onRender;
    };

    it('does not re-render when another profile changes', () => {
      const onRender = renderCounted();
      act(() => {
        useDbProfileStore.setState(s => ({
          dbProfiles: { ...s.dbProfiles, p2: { ...s.dbProfiles.p2, name: 'Renamed', isConnected: true } },
        }));
      });
      expect(onRender).not.toHaveBeenCalled();
      expect(screen.getByText('My PG')).toBeInTheDocument();
    });

    it('re-renders when its own profile changes', () => {
      const onRender = renderCounted();
      act(() => {
        useDbProfileStore.setState(s => ({
          dbProfiles: { ...s.dbProfiles, p1: { ...s.dbProfiles.p1, name: 'Renamed PG' } },
        }));
      });
      expect(onRender).toHaveBeenCalled();
      expect(screen.getByText('Renamed PG')).toBeInTheDocument();
    });
  });

  describe('status', () => {
    it('is red (disconnected) when not connected', () => {
      renderItem({ isConnected: false });
      expect(status().style.color).toBe('var(--mantine-color-red-light-color)');
      expect(status().style.backgroundColor).toBe('var(--mantine-color-red-light)');
    });

    it('is green (connected) when connected', () => {
      renderItem({ isConnected: true });
      expect(status().style.color).toBe('var(--mantine-color-green-light-color)');
      expect(status().style.backgroundColor).toBe('var(--mantine-color-green-light)');
    });

    it('swaps the icon with the connection state', () => {
      const { unmount } = renderItem({ isConnected: false });
      const disconnectedIcon = status().querySelector('svg')?.getAttribute('class');
      unmount();
      renderItem({ isConnected: true });
      expect(status().querySelector('svg')?.getAttribute('class')).not.toBe(disconnectedIcon);
    });
  });

  describe('colors', () => {
    it('uses the profile color as background in light mode', () => {
      renderItem({ color: '#d0ebff' });
      expect(section().style.backgroundColor).toBe('rgb(208, 235, 255)');
    });

    it('mixes the profile color with the body color in dark mode', () => {
      scheme.value = 'dark';
      renderItem({ color: '#d0ebff' });
      expect(section().style.backgroundColor).toContain('color-mix(in srgb, #d0ebff 35%');
    });

    it('falls back to the body color when there is no color', () => {
      renderItem({ color: '' });
      expect(section().style.backgroundColor).toBe('var(--mantine-color-body)');
    });

    it.each([
      ['black on a light color', 'light', '#d0ebff', 'var(--mantine-color-black)'],
      ['white on a dark color', 'light', '#1c3d5a', 'var(--mantine-color-white)'],
      ['theme text in dark mode', 'dark', '#d0ebff', 'var(--mantine-color-text)'],
      ['theme text without a color', 'light', '', 'var(--mantine-color-text)'],
    ] as const)('uses %s', (_n, mode, color, expected) => {
      scheme.value = mode;
      renderItem({ color });
      expect(card().style.color).toBe(expected);
    });
  });
});
