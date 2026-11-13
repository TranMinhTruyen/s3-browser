import { act, render, screen, waitFor } from '@testing-library/react';
import { GetAllConnectionProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { StrictMode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import i18n from '@/locales/i18n';
import { useCredentialExpiring } from '@/pages/s3/hooks/useCredentialExpiring';
import { useMasterDataStore } from '@/pages/s3/stores/masterDataStore';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { normalizeTabProfiles } from '@/pages/s3/utils/tabPersistence';

vi.mock('@/components/layouts/MainLayout', () => ({ default: () => <div>main layout</div> }));
vi.mock('@/components/layouts/AppUpdateToast', () => ({ default: () => <div>update toast</div> }));
vi.mock('@/pages/s3/hooks/useCredentialExpiring', () => ({ useCredentialExpiring: vi.fn() }));
const toaster = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }));
vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => {
    toaster.props = props;
    return <div>toaster</div>;
  },
  toast: { error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ GetAllConnectionProfile: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/settinghandler', () => ({ GetTabState: vi.fn(), SaveTabState: vi.fn() }));

const output = (profiles: Record<string, unknown>) => ({
  result: true,
  messageList: [],
  body: { connectionProfiles: profiles },
});
const profileState = () => useProfileStore.getState();
const addTab = (id: string, profileId: string | null) =>
  useTabListStore.setState(s => ({
    tabList: {
      ...s.tabList,
      [id]: { profileId, currentView: 'bucketList', prefix: '', selectionItem: {}, deletingItems: {} } as never,
    },
  }));

describe('App', () => {
  const loadAll = vi.fn();
  const reset = vi.fn();

  beforeEach(() => {
    useMasterDataStore.setState({ loadAll, reset });
    useProfileStore.getState().reset();
    useTabListStore.getState().reset();
    vi.mocked(GetAllConnectionProfile).mockResolvedValue(output({}) as never);
  });

  describe('layout', () => {
    it('renders the main layout directly and the toaster', async () => {
      render(<App />);
      expect(await screen.findByText(/main layout/)).toBeInTheDocument();
      expect(screen.getByText('toaster')).toBeInTheDocument();
    });

    it('keeps the toaster position, duration and look', () => {
      render(<App />);

      expect(toaster.props).toMatchObject({
        position: 'top-center',
        richColors: true,
        closeButton: true,
        duration: 10000,
      });
    });

    it('sizes the toasts in rem so they follow the interface size', () => {
      render(<App />);

      expect(toaster.props?.style).toEqual({ '--width': '22.25rem' });
      expect(toaster.props?.toastOptions).toEqual({
        style: { fontSize: 'var(--mantine-font-size-sm)', padding: '1rem' },
      });
    });
  });

  describe('credential expiring', () => {
    it('registers the credential expiring listener for the whole app', () => {
      const { rerender } = render(<App />);
      rerender(<App />);

      expect(useCredentialExpiring).toHaveBeenCalled();
    });
  });

  describe('app update', () => {
    it('renders the app update toast component for the whole app', () => {
      render(<App />);

      expect(screen.getByText('update toast')).toBeInTheDocument();
    });
  });

  describe('master data', () => {
    it('loads the master data on mount and resets it on unmount', () => {
      const { unmount } = render(<App />);
      expect(loadAll).toHaveBeenCalledTimes(1);
      expect(reset).not.toHaveBeenCalled();

      unmount();
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  describe('profiles', () => {
    it('loads the profiles once on mount and resets them on unmount', async () => {
      vi.mocked(GetAllConnectionProfile).mockResolvedValue(output({ p1: { id: 'p1', name: 'one' } }) as never);
      const { unmount } = render(<App />);

      await waitFor(() => expect(profileState().loaded).toBe(true));
      expect(GetAllConnectionProfile).toHaveBeenCalledTimes(1);
      expect(Object.keys(profileState().connectionProfiles)).toEqual(['p1']);

      unmount();

      expect(profileState().loaded).toBe(false);
      expect(profileState().connectionProfiles).toEqual({});
    });

    it('clears the tabs of deleted profiles after loading and keeps the others', async () => {
      addTab('keep', 'p1');
      addTab('drop', 'gone');
      vi.mocked(GetAllConnectionProfile).mockResolvedValue(output({ p1: { id: 'p1', name: 'one' } }) as never);

      render(<App />);

      await waitFor(() => expect(useTabListStore.getState().tabList.drop.profileId).toBeNull());
      expect(useTabListStore.getState().tabList.keep.profileId).toBe('p1');
    });

    it('survives mount -> unmount -> mount (StrictMode): reloads, ignores the first load and keeps the list', async () => {
      addTab('keep', 'p1');
      addTab('drop', 'gone');
      // The first load finishes after the second one: its stale result must be dropped.
      let finishFirst!: (v: unknown) => void;
      vi.mocked(GetAllConnectionProfile)
        .mockReturnValueOnce(new Promise(resolve => (finishFirst = resolve)) as never)
        .mockResolvedValueOnce(output({ p1: { id: 'p1', name: 'one' } }) as never);

      render(
        <StrictMode>
          <App />
        </StrictMode>
      );

      await waitFor(() => expect(profileState().loaded).toBe(true));
      expect(GetAllConnectionProfile).toHaveBeenCalledTimes(2);
      expect(Object.keys(profileState().connectionProfiles)).toEqual(['p1']);

      await act(async () => finishFirst(output({ stale: { id: 'stale', name: 'stale' } })));

      expect(Object.keys(profileState().connectionProfiles)).toEqual(['p1']);
      expect(useTabListStore.getState().tabList.drop.profileId).toBeNull();
      expect(useTabListStore.getState().tabList.keep.profileId).toBe('p1');
    });

    it('normalizing the tabs again with the same profiles changes nothing (idempotent)', async () => {
      addTab('keep', 'p1');
      addTab('drop', 'gone');
      vi.mocked(GetAllConnectionProfile).mockResolvedValue(output({ p1: { id: 'p1', name: 'one' } }) as never);
      render(<App />);
      await waitFor(() => expect(useTabListStore.getState().tabList.drop.profileId).toBeNull());
      const before = useTabListStore.getState().tabList;

      normalizeTabProfiles(Object.keys(profileState().connectionProfiles));

      expect(useTabListStore.getState().tabList).toEqual(before);
    });

    it('shows the load error as a toast and leaves the tabs as they are', async () => {
      addTab('kept', 'p1');
      vi.mocked(GetAllConnectionProfile).mockRejectedValue(new Error('db down'));

      render(<App />);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(i18n.t('ipcMessage:common.CME001'), { description: 'db down' })
      );
      expect(profileState().loaded).toBe(false);
      expect(useTabListStore.getState().tabList.kept.profileId).toBe('p1');
    });
  });
});
