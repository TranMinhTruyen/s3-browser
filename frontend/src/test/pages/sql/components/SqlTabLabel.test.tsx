import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import SqlTabLabel from '@/pages/sql/components/SqlTabLabel';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { pgProfile, toProfileMap } from '@/test/_helpers/dbProfiles';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const tabId = () => useSqlTabStore.getState().activeTab;
const swatch = (container: HTMLElement) => container.querySelector<HTMLElement>('.mantine-ColorSwatch-root');

describe('SqlTabLabel', () => {
  beforeEach(() => {
    useDbProfileStore.getState().reset();
    useDbProfileStore.setState({
      dbProfiles: toProfileMap(
        pgProfile('mock-pg-local', { name: 'Local PostgreSQL' }),
        pgProfile('mock-pg-staging', { name: 'Staging PostgreSQL' })
      ),
    });
    useSqlTabStore.getState().reset();
  });

  it('shows the default name and no status dot when no profile is chosen', () => {
    const { container } = renderWithProviders(<SqlTabLabel tabId={tabId()} />);
    expect(screen.getByText('New query')).toBeInTheDocument();
    expect(swatch(container)).not.toBeInTheDocument();
  });

  const dotColor = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('.mantine-ColorSwatch-colorOverlay')?.style.backgroundColor;

  it('shows a red status dot for a chosen profile that is not connected', () => {
    useSqlTabStore.getState().setTabProfile(tabId(), 'mock-pg-local');
    const { container } = renderWithProviders(<SqlTabLabel tabId={tabId()} />);
    expect(screen.getByText('Local PostgreSQL')).toBeInTheDocument();
    expect(swatch(container)).toBeInTheDocument();
    expect(dotColor(container)).toBe('var(--mantine-color-red-6)');
  });

  it('shows a green status dot once the chosen profile is connected, whatever its profile color', () => {
    useDbProfileStore.setState(state => ({
      dbProfiles: { ...state.dbProfiles, 'mock-pg-local': { ...state.dbProfiles['mock-pg-local']!, color: '' } },
    }));
    useDbProfileStore.getState().setConnected('mock-pg-local', true);
    useSqlTabStore.getState().setTabProfile(tabId(), 'mock-pg-local');
    const { container } = renderWithProviders(<SqlTabLabel tabId={tabId()} />);
    expect(dotColor(container)).toBe('var(--mantine-color-green-6)');
  });

  it('shows no dot when the chosen profile no longer exists', () => {
    useSqlTabStore.getState().setTabProfile(tabId(), 'gone');
    const { container } = renderWithProviders(<SqlTabLabel tabId={tabId()} />);
    expect(swatch(container)).not.toBeInTheDocument();
  });

  it('falls back to the default name when the chosen profile no longer exists', () => {
    useSqlTabStore.getState().setTabProfile(tabId(), 'gone');
    renderWithProviders(<SqlTabLabel tabId={tabId()} />);
    expect(screen.getByText('New query')).toBeInTheDocument();
  });

  it('falls back to the default name for an unknown tab', () => {
    renderWithProviders(<SqlTabLabel tabId="nope" />);
    expect(screen.getByText('New query')).toBeInTheDocument();
  });

  it('follows the store when the profile is chosen, renamed and deleted', () => {
    renderWithProviders(<SqlTabLabel tabId={tabId()} />);

    act(() => useSqlTabStore.getState().setTabProfile(tabId(), 'mock-pg-staging'));
    expect(screen.getByText('Staging PostgreSQL')).toBeInTheDocument();

    act(() => useDbProfileStore.getState().deleteDbProfile('mock-pg-staging'));
    expect(screen.getByText('New query')).toBeInTheDocument();
  });
  describe('TableStructure tab', () => {
    const openTable = () => {
      useSqlTabStore.getState().openTableTab('mock-pg-local', 'public', 'users');
      return useSqlTabStore.getState().activeTab;
    };

    it('shows a table icon and the table name, without the profile name or a status dot', () => {
      const { container } = renderWithProviders(<SqlTabLabel tabId={openTable()} />);

      expect(screen.getByText('users')).toBeInTheDocument();
      expect(screen.queryByText('Local PostgreSQL')).not.toBeInTheDocument();
      expect(swatch(container)).not.toBeInTheDocument();
      expect(container.querySelector('svg.lucide-table-2, svg.lucide-table2')).toBeInTheDocument();
    });

    it('keeps the SQL tab label unchanged next to it', () => {
      const sqlTab = tabId();
      openTable();
      useSqlTabStore.getState().setTabProfile(sqlTab, 'mock-pg-staging');

      renderWithProviders(<SqlTabLabel tabId={sqlTab} />);

      expect(screen.getByText('Staging PostgreSQL')).toBeInTheDocument();
    });
  });
});
