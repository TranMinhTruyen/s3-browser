import { act } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SqlTabDetail from '@/pages/sql/components/SqlTabDetail';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const bar = vi.hoisted(() => ({ props: {} as Record<string, any> }));

vi.mock('@/pages/sql/components/SqlTabActionBar', () => ({
  default: (props: Record<string, any>) => {
    bar.props = props;
    return <div data-testid="bar" data-options={JSON.stringify(props.profileOptions)} />;
  },
}));
vi.mock('@/pages/sql/components/sqlEditor/SqlEditor', () => ({ default: () => <div /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const tabId = () => useSqlTabStore.getState().activeTab;

describe('SqlTabDetail guards that the disabled buttons normally hide', () => {
  beforeEach(() => {
    useDbProfileStore.getState().reset();
    useSqlTabStore.getState().reset();
  });

  it('Connect without a chosen profile does nothing', () => {
    renderWithProviders(<SqlTabDetail tabId={tabId()} />);
    act(() => bar.props.onClickConnect());
    expect(toast.success).not.toHaveBeenCalled();
    expect(Object.values(useDbProfileStore.getState().dbProfiles).some(p => p?.isConnected)).toBe(false);
  });

  it('Connect on an already connected profile does not toast again', () => {
    useSqlTabStore.getState().setTabProfile(tabId(), 'mock-pg-local');
    useDbProfileStore.getState().setConnected('mock-pg-local', true);
    renderWithProviders(<SqlTabDetail tabId={tabId()} />);
    act(() => bar.props.onClickConnect());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('lists a missing profile entry with an empty name', () => {
    useDbProfileStore.setState(state => ({ dbProfiles: { ...state.dbProfiles, broken: undefined } }));
    renderWithProviders(<SqlTabDetail tabId={tabId()} />);
    expect(bar.props.profileOptions).toContainEqual({ name: '', value: 'broken' });
  });
});
