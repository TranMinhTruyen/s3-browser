import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectS3ByProfile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { ObjectItem } from '@wails/S3Browser/models/bucket';
import { type Ref, useImperativeHandle } from 'react';
import { useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import TabDetail from '@/components/layouts/tab/components/TabDetail';
import ConnectModal from '@/components/modals/ConnectModal';
import { renderWithProviders } from '@/test/renderWithProviders';

type BucketStubProps = {
  profile?: { id?: string } | null;
  active: boolean;
  onSelectBucket: (bucket?: string) => void;
  ref: Ref<unknown>;
};
type ObjectStubProps = { bucket?: string; ref: Ref<unknown> };

const h = vi.hoisted(() => ({ bucketRefresh: vi.fn(), objectRefresh: vi.fn(), menu: vi.fn() }));

// The two list views are tested on their own: here they are stubs exposing their ref and callbacks.
vi.mock('@/pages/bucket/BucketListView', () => ({
  default: function BucketListViewStub({ profile, active, onSelectBucket, ref }: BucketStubProps) {
    useImperativeHandle(ref, () => ({ onRefresh: h.bucketRefresh }), []);
    return (
      <div>
        <span>{`bucket list profile=${profile?.id ?? 'none'} active=${active}`}</span>
        <button type="button" onClick={() => onSelectBucket('my-bucket')}>
          pick bucket
        </button>
        <button type="button" onClick={() => onSelectBucket(undefined)}>
          pick nothing
        </button>
      </div>
    );
  },
}));
vi.mock('@/pages/object/ObjectListView', () => ({
  default: function ObjectListViewStub({ bucket, ref }: ObjectStubProps) {
    useImperativeHandle(ref, () => ({ onRefresh: h.objectRefresh, onClickMenuButton: h.menu }), []);
    return <div>{`object list bucket=${bucket}`}</div>;
  },
}));
vi.mock('@/components/layouts/tab/components/ObjectDetailDrawer', () => ({
  default: ({ connectionId, bucket }: { connectionId: string; bucket: string }) => (
    <div>{`drawer ${connectionId} ${bucket}`}</div>
  ),
}));
vi.mock('@/components/modals/ConnectModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ConnectS3ByProfile: vi.fn() }));

const TAB = 't1';
const profile = (patch: Partial<ConnectionProfileOutput> = {}) =>
  ({ id: 'p1', name: 'Prof', accessKey: 'ak', isConnected: false, ...patch }) as ConnectionProfileOutput;
const tabState = (patch: Record<string, unknown> = {}) => ({
  currentView: 'bucketList' as const,
  prefix: '',
  selectionItem: [] as string[],
  deletingItems: [] as string[],
  profileId: 'p1',
  ...patch,
});
const setTab = (patch: Record<string, unknown> = {}) =>
  useTabListStore.setState({ activeTab: TAB, tabList: { [TAB]: tabState(patch) } });
const setProfile = (patch: Partial<ConnectionProfileOutput> = {}) =>
  useProfileStore.setState({ connectionProfiles: { p1: profile(patch) } });
const tab = () => useTabListStore.getState().tabList[TAB];
const btn = (name: string) => screen.getByRole('button', { name });

// The profile combobox has no accessible name (no label), so it is found by its listbox popup.
const profilePicker = () => screen.getAllByRole('button').find(b => b.getAttribute('aria-haspopup') === 'listbox')!;

function setup() {
  renderWithProviders(<TabDetail tabId={TAB} />);
  return userEvent.setup();
}

describe('TabDetail', () => {
  beforeEach(() => {
    h.objectRefresh.mockResolvedValue(undefined);
    h.menu.mockResolvedValue(undefined);
    setTab();
    setProfile();
  });

  describe('header', () => {
    it('lists the profiles and updates the tab when one is chosen', async () => {
      setTab({ profileId: null, selectionItem: ['x'], bucket: 'old', prefix: 'a/' });
      const user = setup();
      await user.click(profilePicker());
      await user.click(await screen.findByText('Prof'));
      expect(tab()).toMatchObject({
        profileId: 'p1',
        currentView: 'bucketList',
        bucket: undefined,
        prefix: '',
        selectionItem: [],
      });
    });

    it('treats a profile entry without data as an unnamed option', async () => {
      useProfileStore.setState({ connectionProfiles: { ghost: undefined } });
      setTab({ profileId: null });
      const user = setup();
      await user.click(profilePicker());
      const options = await screen.findAllByRole('option', { hidden: true });
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('');
    });

    it('disables connect without a profile and refresh when disconnected', () => {
      setTab({ profileId: null });
      setup();
      expect(btn('Connect')).toBeDisabled();
      expect(btn('Refresh bucket list')).toBeDisabled();
    });

    it('works for a tab that is not in the store', () => {
      setTab();
      renderWithProviders(<TabDetail tabId="missing" />);
      expect(btn('Connect')).toBeDisabled();
      expect(screen.getByText('bucket list profile=none active=true')).toBeInTheDocument();
    });
  });

  describe('connect', () => {
    it('opens the connect modal when the profile has no access key', async () => {
      setProfile({ accessKey: '' });
      const user = setup();
      await user.click(btn('Connect'));
      expect(ConnectModal.show).toHaveBeenCalledExactlyOnceWith({
        mode: 'manualconnect',
        connectionProfile: profile({ accessKey: '' }),
      });
      expect(callIPC).not.toHaveBeenCalled();
    });

    it('connects through the backend and marks the profile as connected', async () => {
      vi.mocked(callIPC).mockResolvedValue({ isConnected: true } as never);
      const user = setup();
      await user.click(btn('Connect'));
      expect(callIPC).toHaveBeenCalledExactlyOnceWith(ConnectS3ByProfile, ['p1']);
      await waitFor(() => expect(useProfileStore.getState().connectionProfiles.p1?.isConnected).toBe(true));
      expect(btn('Connect')).toBeDisabled();
    });

    it('keeps the profile disconnected when the backend does not connect', async () => {
      vi.mocked(callIPC).mockResolvedValue(null as never);
      const user = setup();
      await user.click(btn('Connect'));
      expect(callIPC).toHaveBeenCalledTimes(1);
      expect(useProfileStore.getState().connectionProfiles.p1?.isConnected).toBe(false);
    });

    it('does nothing when the selected profile no longer exists', async () => {
      useProfileStore.setState({ connectionProfiles: {} });
      const user = setup();
      await user.click(btn('Connect'));
      expect(callIPC).not.toHaveBeenCalled();
      expect(ConnectModal.show).not.toHaveBeenCalled();
    });
  });

  describe('bucket list', () => {
    it('gives the bucket list no profile until connected', () => {
      setup();
      expect(screen.getByText('bucket list profile=none active=true')).toBeInTheDocument();
    });

    it('passes the connected profile to the bucket list and refreshes it', async () => {
      setProfile({ isConnected: true });
      const user = setup();
      expect(screen.getByText('bucket list profile=p1 active=true')).toBeInTheDocument();
      await user.click(btn('Refresh bucket list'));
      expect(h.bucketRefresh).toHaveBeenCalledTimes(1);
      expect(h.objectRefresh).not.toHaveBeenCalled();
    });

    it('opens the object list of the picked bucket', async () => {
      setProfile({ isConnected: true });
      const user = setup();
      await user.click(screen.getByText('pick bucket'));
      expect(tab()).toMatchObject({ currentView: 'objectList', bucket: 'my-bucket' });
      expect(screen.getByText('object list bucket=my-bucket')).toBeInTheDocument();
    });

    it('ignores a pick without a bucket name', async () => {
      setProfile({ isConnected: true });
      const user = setup();
      await user.click(screen.getByText('pick nothing'));
      expect(tab().currentView).toBe('bucketList');
    });

    it('shows the bucket list instead of the object list when the profile is disconnected', () => {
      setTab({ currentView: 'objectList', bucket: 'b' });
      setup();
      expect(screen.queryByText(/object list bucket/)).not.toBeInTheDocument();
      expect(screen.getByText(/bucket list profile/)).toBeInTheDocument();
    });
  });

  describe('object list', () => {
    beforeEach(() => {
      setProfile({ isConnected: true });
    });

    it('refreshes the object list and clears the selection', async () => {
      setTab({ currentView: 'objectList', bucket: 'b', selectionItem: ['k'] });
      const user = setup();
      await user.click(btn('Refresh object list'));
      expect(h.objectRefresh).toHaveBeenCalledTimes(1);
      expect(h.bucketRefresh).not.toHaveBeenCalled();
      expect(tab().selectionItem).toEqual([]);
    });

    it('goes back to the bucket list from the bucket root', async () => {
      setTab({ currentView: 'objectList', bucket: 'b' });
      const user = setup();
      await user.click(btn('Back to bucket'));
      expect(tab().currentView).toBe('bucketList');
    });

    it.each([
      ['a/b/', 'a/'],
      ['a/', ''],
      ['a//', 'a/'],
    ])('goes up from prefix "%s" to "%s"', async (prefix, parent) => {
      setTab({ currentView: 'objectList', bucket: 'b', prefix });
      const user = setup();
      await user.click(btn('Back to parent folder'));
      expect(tab().prefix).toBe(parent);
      expect(tab().currentView).toBe('objectList');
    });

    it('shows the bucket as plain text at the root', () => {
      setTab({ currentView: 'objectList', bucket: 'my-bucket' });
      setup();
      expect(screen.getByText('my-bucket')).not.toHaveAttribute('data-prefix');
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('builds one breadcrumb per folder and navigates when an ancestor is clicked', async () => {
      setTab({ currentView: 'objectList', bucket: 'my-bucket', prefix: 'a/b/c/' });
      const user = setup();
      const crumbs = document.querySelectorAll<HTMLElement>('[data-prefix]');
      expect([...crumbs].map(c => [c.textContent, c.dataset.prefix])).toEqual([
        ['my-bucket', ''],
        ['a', 'a/'],
        ['b', 'a/b/'],
      ]);
      expect(screen.getByText('c')).not.toHaveAttribute('data-prefix');

      await user.click(screen.getByText('b'));
      expect(tab().prefix).toBe('a/b/');
      await user.click(screen.getByText('my-bucket'));
      expect(tab().prefix).toBe('');
    });

    it('names an empty folder crumb "/"', () => {
      setTab({ currentView: 'objectList', bucket: 'b', prefix: 'a//' });
      setup();
      // The empty-named folder is the last crumb "/" (the other two are separators).
      expect(screen.getAllByText('/')).toHaveLength(3);
      expect([...document.querySelectorAll<HTMLElement>('[data-prefix]')].map(c => c.dataset.prefix)).toEqual([
        '',
        'a/',
      ]);
    });

    it('shows no selection actions without a selection', () => {
      setTab({ currentView: 'objectList', bucket: 'b' });
      setup();
      expect(screen.queryByRole('button', { name: 'Clear selected' })).not.toBeInTheDocument();
    });

    it('clears, downloads and deletes the selection', async () => {
      setTab({ currentView: 'objectList', bucket: 'b', selectionItem: ['k1', 'k2'] });
      const user = setup();
      await user.click(btn('Download selected'));
      expect(h.menu).toHaveBeenLastCalledWith(['k1', 'k2'], 'download');
      await user.click(btn('Delete selected'));
      expect(h.menu).toHaveBeenLastCalledWith(['k1', 'k2'], 'delete');
      await user.click(btn('Clear selected'));
      expect(tab().selectionItem).toEqual([]);
    });

    it('disables clear and download while a selected item is being deleted', () => {
      setTab({ currentView: 'objectList', bucket: 'b', selectionItem: ['k1'], deletingItems: ['k1'] });
      setup();
      expect(btn('Clear selected')).toBeDisabled();
      expect(btn('Download selected')).toBeDisabled();
      expect(btn('Delete selected')).toBeEnabled();
    });

    it('keeps the selection actions enabled when only other items are being deleted', () => {
      setTab({ currentView: 'objectList', bucket: 'b', selectionItem: ['k1'], deletingItems: ['other'] });
      setup();
      expect(btn('Clear selected')).toBeEnabled();
    });

    it('marks the scroll area as a file drop target', () => {
      setTab({ currentView: 'objectList', bucket: 'b' });
      setup();
      expect(document.querySelector(`[data-tab-id="${TAB}"]`)).toHaveAttribute('data-file-drop-target');
    });

    it('shows the detail drawer when an item is open', () => {
      setTab({ currentView: 'objectList', bucket: 'b', detailItem: new ObjectItem({ key: 'k' }) });
      setup();
      expect(screen.getByText('drawer p1 b')).toBeInTheDocument();
    });

    it('does not show the drawer without an open item', () => {
      setTab({ currentView: 'objectList', bucket: 'b' });
      setup();
      expect(screen.queryByText(/^drawer/)).not.toBeInTheDocument();
    });

    it('does not show the drawer in the bucket list', () => {
      setTab({ detailItem: new ObjectItem({ key: 'k' }) });
      setup();
      expect(screen.queryByText(/^drawer/)).not.toBeInTheDocument();
      expect(document.querySelector(`[data-tab-id="${TAB}"]`)).not.toHaveAttribute('data-file-drop-target');
    });
  });
});
