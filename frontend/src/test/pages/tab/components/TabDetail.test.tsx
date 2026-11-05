import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectS3ByProfile, UploadObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { ObjectItem } from '@wails/S3Browser/models/bucket';
import { Activity, type Ref, useImperativeHandle } from 'react';
import { toast } from 'sonner';
import { useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import {
  showBucketPolicyModal,
  showConnectModal,
  showCreateBucketModal,
  showUploadPickerModal,
} from '@/components/modals/lazyModals';
import TabDetail from '@/pages/tab/components/TabDetail';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

type BucketStubProps = {
  tabId: string;
  keyword?: string;
  profile?: { id?: string } | null;
  active: boolean;
  onSelectBucket: (bucket?: string) => void;
  onEditPolicy: (bucket?: string) => void;
  ref: Ref<unknown>;
};
type ObjectStubProps = { bucket?: string; keyword?: string; ref: Ref<unknown> };

const h = vi.hoisted(() => ({ bucketRefresh: vi.fn(), objectRefresh: vi.fn(), menu: vi.fn() }));

// The two list views are tested on their own: here they are stubs exposing their ref and callbacks.
vi.mock('@/pages/tab/bucket/BucketListView', () => ({
  default: function BucketListViewStub({
    tabId,
    profile,
    active,
    keyword,
    onSelectBucket,
    onEditPolicy,
    ref,
  }: BucketStubProps) {
    useImperativeHandle(ref, () => ({ onRefresh: h.bucketRefresh }), []);
    return (
      <div>
        <span>{`bucket list profile=${profile?.id ?? 'none'} active=${active}`}</span>
        <span>{`bucket keyword=[${keyword}]`}</span>
        <span>{`bucket tab=${tabId}`}</span>
        <button type="button" onClick={() => onSelectBucket('my-bucket')}>
          pick bucket
        </button>
        <button type="button" onClick={() => onSelectBucket(undefined)}>
          pick nothing
        </button>
        <button type="button" onClick={() => onEditPolicy('my-bucket')}>
          edit policy
        </button>
        <button type="button" onClick={() => onEditPolicy(undefined)}>
          edit nothing
        </button>
      </div>
    );
  },
}));
vi.mock('@/pages/tab/object/ObjectListView', () => ({
  default: function ObjectListViewStub({ bucket, keyword, ref }: ObjectStubProps) {
    useImperativeHandle(ref, () => ({ onRefresh: h.objectRefresh, onClickMenuButton: h.menu }), []);
    return (
      <div>
        <span>{`object list bucket=${bucket}`}</span>
        <span>{`keyword=[${keyword}]`}</span>
      </div>
    );
  },
}));
vi.mock('@/pages/tab/components/ObjectDetailDrawer', () => ({
  default: ({ connectionId, bucket }: { connectionId: string; bucket: string }) => (
    <div>{`drawer ${connectionId} ${bucket}`}</div>
  ),
}));
vi.mock('@/pages/tab/components/BucketDetailDrawer', () => ({
  default: ({ tabId, connectionId, profileName }: { tabId: string; connectionId: string; profileName?: string }) => (
    <div>{`bucket drawer ${tabId} ${connectionId} ${profileName}`}</div>
  ),
}));
vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showUploadPickerModal: vi.fn(),
  showCreateBucketModal: vi.fn(),
  showBucketPolicyModal: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  ConnectS3ByProfile: vi.fn(),
  UploadObject: vi.fn(),
}));

const TAB = 't1';
const profile = (patch: Partial<ConnectionProfileOutput> = {}) =>
  ({
    id: 'p1',
    name: 'Prof',
    accessKey: 'ak',
    savedSecrets: ['secretKey'],
    isConnected: false,
    ...patch,
  }) as ConnectionProfileOutput;
const tabState = (patch: Record<string, unknown> = {}) => ({
  currentView: 'bucketList' as const,
  prefix: '',
  selectionItem: {},
  deletingItems: {},
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
    useTabListStore.setState({ uploadingTabId: null });
    h.objectRefresh.mockResolvedValue(undefined);
    h.menu.mockResolvedValue(undefined);
    setTab();
    setProfile();
  });

  describe('header', () => {
    it('lists the profiles and updates the tab when one is chosen', async () => {
      setTab({ profileId: null, selectionItem: { x: true }, bucket: 'old', prefix: 'a/' });
      const user = setup();
      await user.click(profilePicker());
      await user.click(await screen.findByText('Prof'));
      expect(tab()).toMatchObject({
        profileId: 'p1',
        currentView: 'bucketList',
        bucket: undefined,
        prefix: '',
        selectionItem: {},
        detailBucket: undefined,
      });
    });

    it('closes the bucket drawer when another profile is chosen', async () => {
      useProfileStore.setState({
        connectionProfiles: { p1: profile(), p2: profile({ id: 'p2', name: 'Other' }) },
      });
      setTab({ detailBucket: { name: 'my-bucket' } as never });
      const user = setup();
      await user.click(profilePicker());
      await user.click(await screen.findByText('Other'));
      expect(tab().detailBucket).toBeUndefined();
      expect(tab().profileId).toBe('p2');
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
      expect(showConnectModal).toHaveBeenCalledExactlyOnceWith({
        mode: 'manualconnect',
        connectionProfile: profile({ accessKey: '' }),
      });
      expect(callIPC).not.toHaveBeenCalled();
    });

    it('opens the connect modal when the secret key is not saved', async () => {
      setProfile({ savedSecrets: [] });
      const user = setup();
      await user.click(btn('Connect'));
      expect(showConnectModal).toHaveBeenCalledExactlyOnceWith({
        mode: 'manualconnect',
        connectionProfile: profile({ savedSecrets: [] }),
      });
      expect(callIPC).not.toHaveBeenCalled();
    });

    it('opens the connect modal for an assume role profile with an MFA device', async () => {
      setProfile({ authType: 'assumeRole', authConfig: { mfaSerial: 'arn:mfa' } as never });
      const user = setup();
      await user.click(btn('Connect'));
      expect(showConnectModal).toHaveBeenCalledTimes(1);
      expect(callIPC).not.toHaveBeenCalled();
    });

    it('connects directly a profile that needs no secret', async () => {
      vi.mocked(callIPC).mockResolvedValue({ isConnected: true } as never);
      setProfile({ authType: 'defaultChain', accessKey: '', savedSecrets: [] });
      const user = setup();
      await user.click(btn('Connect'));
      expect(callIPC).toHaveBeenCalledExactlyOnceWith(ConnectS3ByProfile, ['p1'], { signal: expect.any(AbortSignal) });
      expect(showConnectModal).not.toHaveBeenCalled();
    });

    it('connects through the backend and marks the profile as connected', async () => {
      vi.mocked(callIPC).mockResolvedValue({ isConnected: true } as never);
      const user = setup();
      await user.click(btn('Connect'));
      expect(callIPC).toHaveBeenCalledExactlyOnceWith(ConnectS3ByProfile, ['p1'], { signal: expect.any(AbortSignal) });
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
      expect(showConnectModal).not.toHaveBeenCalled();
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

  describe('create bucket', () => {
    const createBtn = () => btn('Create bucket');

    beforeEach(() => {
      vi.mocked(showCreateBucketModal).mockReset();
      h.bucketRefresh.mockReset();
    });

    it('is disabled until connected', () => {
      setup();
      expect(createBtn()).toBeDisabled();
    });

    it('is not offered to an anonymous connection', () => {
      setProfile({ isConnected: true, authType: 'anonymous' });
      setup();
      expect(screen.queryByRole('button', { name: 'Create bucket' })).not.toBeInTheDocument();
    });

    it('is not offered in the object list', () => {
      setProfile({ isConnected: true });
      setTab({ currentView: 'objectList', bucket: 'b' });
      setup();
      expect(screen.queryByRole('button', { name: 'Create bucket' })).not.toBeInTheDocument();
    });

    it('asks for the region on AWS without endpoint (default: profile region) and refreshes when created', async () => {
      vi.mocked(showCreateBucketModal).mockResolvedValue(true as never);
      setProfile({ isConnected: true, provider: 'aws', endpoint: '', region: 'eu-west-1' });
      const user = setup();

      await user.click(createBtn());

      expect(showCreateBucketModal).toHaveBeenCalledExactlyOnceWith({
        connectionId: 'p1',
        profileName: 'Prof',
        withRegion: true,
        defaultRegion: 'eu-west-1',
      });
      await waitFor(() => expect(h.bucketRefresh).toHaveBeenCalledTimes(1));
    });

    it.each([
      ['MinIO', { provider: 'minio', endpoint: '', region: 'us-east-1' }],
      ['AWS with a custom endpoint', { provider: 'aws', endpoint: 'https://s3.example.com', region: 'us-east-1' }],
    ])('does not ask for the region on %s', async (_name, patch) => {
      vi.mocked(showCreateBucketModal).mockResolvedValue(true as never);
      setProfile({ isConnected: true, ...patch } as Partial<ConnectionProfileOutput>);
      const user = setup();

      await user.click(createBtn());

      expect(showCreateBucketModal).toHaveBeenCalledExactlyOnceWith({
        connectionId: 'p1',
        profileName: 'Prof',
        withRegion: false,
        defaultRegion: undefined,
      });
    });

    it.each([
      ['false (canceled)', false],
      ['undefined (chunk failed)', undefined],
    ])('does not refresh when the modal resolves %s', async (_name, value) => {
      vi.mocked(showCreateBucketModal).mockResolvedValue(value as never);
      setProfile({ isConnected: true });
      const user = setup();

      await user.click(createBtn());

      await waitFor(() => expect(showCreateBucketModal).toHaveBeenCalledTimes(1));
      await act(async () => {});
      expect(h.bucketRefresh).not.toHaveBeenCalled();
    });

    it('is disabled without a selected profile', () => {
      setTab({ profileId: null });
      useProfileStore.setState({ connectionProfiles: {} });
      setup();

      expect(createBtn()).toBeDisabled();
      expect(showCreateBucketModal).not.toHaveBeenCalled();
    });
  });

  describe('bucket policy', () => {
    beforeEach(() => {
      vi.mocked(showBucketPolicyModal).mockReset();
    });

    it('opens the policy modal of the bucket of the connected profile', async () => {
      setProfile({ isConnected: true });
      const user = setup();

      await user.click(screen.getByText('edit policy'));

      expect(showBucketPolicyModal).toHaveBeenCalledExactlyOnceWith({
        connectionId: 'p1',
        profileName: 'Prof',
        bucket: 'my-bucket',
      });
    });

    it('ignores a request without a bucket name', async () => {
      setProfile({ isConnected: true });
      const user = setup();

      await user.click(screen.getByText('edit nothing'));

      expect(showBucketPolicyModal).not.toHaveBeenCalled();
    });

    it('ignores a request without a profile', async () => {
      setTab({ profileId: null });
      useProfileStore.setState({ connectionProfiles: {} });
      const user = setup();

      await user.click(screen.getByText('edit policy'));

      expect(showBucketPolicyModal).not.toHaveBeenCalled();
    });
  });

  describe('bucket detail drawer', () => {
    const bucket = { name: 'my-bucket' } as never;

    it('shows the drawer in the bucket list when a bucket is open', () => {
      setProfile({ isConnected: true });
      setTab({ detailBucket: bucket });
      setup();

      expect(screen.getByText(`bucket drawer ${TAB} p1 Prof`)).toBeInTheDocument();
    });

    it('does not show the drawer without an open bucket', () => {
      setProfile({ isConnected: true });
      setup();

      expect(screen.queryByText(/bucket drawer/)).not.toBeInTheDocument();
    });

    it('does not show the drawer in the object list', () => {
      setProfile({ isConnected: true });
      setTab({ currentView: 'objectList', bucket: 'b', detailBucket: bucket });
      setup();

      expect(screen.queryByText(/bucket drawer/)).not.toBeInTheDocument();
    });

    it('does not show the drawer without a profile', () => {
      setTab({ profileId: null, detailBucket: bucket });
      useProfileStore.setState({ connectionProfiles: {} });
      setup();

      expect(screen.queryByText(/bucket drawer/)).not.toBeInTheDocument();
    });
  });

  describe('object list', () => {
    beforeEach(() => {
      setProfile({ isConnected: true });
    });

    it('refreshes the object list and clears the selection', async () => {
      setTab({ currentView: 'objectList', bucket: 'b', selectionItem: { k: true } });
      const user = setup();
      await user.click(btn('Refresh object list'));
      expect(h.objectRefresh).toHaveBeenCalledTimes(1);
      expect(h.bucketRefresh).not.toHaveBeenCalled();
      expect(tab().selectionItem).toEqual({});
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
      setTab({ currentView: 'objectList', bucket: 'b', selectionItem: { k1: true, k2: true } });
      const user = setup();
      await user.click(btn('Download selected'));
      expect(h.menu).toHaveBeenLastCalledWith(['k1', 'k2'], 'download');
      await user.click(btn('Delete selected'));
      expect(h.menu).toHaveBeenLastCalledWith(['k1', 'k2'], 'delete');
      await user.click(btn('Clear selected'));
      expect(tab().selectionItem).toEqual({});
    });

    it('disables clear and download while a selected item is being deleted', () => {
      setTab({ currentView: 'objectList', bucket: 'b', selectionItem: { k1: true }, deletingItems: { k1: true } });
      setup();
      expect(btn('Clear selected')).toBeDisabled();
      expect(btn('Download selected')).toBeDisabled();
      expect(btn('Delete selected')).toBeEnabled();
    });

    it('keeps the selection actions enabled when only other items are being deleted', () => {
      setTab({ currentView: 'objectList', bucket: 'b', selectionItem: { k1: true }, deletingItems: { other: true } });
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

    describe('search', () => {
      const searchBox = () => screen.getByPlaceholderText('Search by key');
      const objectTab = (patch: Record<string, unknown> = {}) =>
        setTab({ currentView: 'objectList', bucket: 'b', ...patch });

      it('is shown in the bucket list with its own placeholder', () => {
        setTab();
        setProfile({ isConnected: true });
        setup();
        expect(screen.getByPlaceholderText('Search by name')).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Search by key')).not.toBeInTheDocument();
        expect(btn('Search')).toBeEnabled();
      });

      it('is disabled in the bucket list while not connected', () => {
        setTab();
        setProfile({ isConnected: false });
        setup();
        expect(screen.getByPlaceholderText('Search by name')).toBeDisabled();
        expect(btn('Search')).toBeDisabled();
      });

      describe('in the bucket list', () => {
        const nameBox = () => screen.getByPlaceholderText('Search by name');
        beforeEach(() => {
          setProfile({ isConnected: true });
          setTab({ selectionItem: { k: true } });
        });

        it('applies the keyword to the bucket list only, without touching the selection', async () => {
          const user = setup();
          expect(screen.getByText('bucket keyword=[]')).toBeInTheDocument();
          await user.type(nameBox(), ' foo {Enter}');
          expect(screen.getByText('bucket keyword=[foo]')).toBeInTheDocument();
          expect(tab().selectionItem).toEqual({ k: true });
        });

        it('refreshes the bucket list when the same keyword is submitted again', async () => {
          const user = setup();
          await user.type(nameBox(), 'foo{Enter}');
          expect(h.bucketRefresh).not.toHaveBeenCalled();
          await user.click(btn('Search'));
          expect(h.bucketRefresh).toHaveBeenCalledTimes(1);
          expect(h.objectRefresh).not.toHaveBeenCalled();
          expect(screen.getByText('bucket keyword=[foo]')).toBeInTheDocument();
        });

        it('clears the keyword without touching the selection', async () => {
          const user = setup();
          await user.type(nameBox(), 'foo{Enter}');
          await user.click(btn('Clear search'));
          expect(screen.getByText('bucket keyword=[]')).toBeInTheDocument();
          expect(nameBox()).toHaveValue('');
          expect(tab().selectionItem).toEqual({ k: true });
        });

        it('gives the bucket list no keyword while the object list is shown, and drops it on return', async () => {
          const user = setup();
          await user.type(nameBox(), 'foo{Enter}');
          await user.click(screen.getByText('pick bucket'));
          expect(screen.getByText('bucket keyword=[]')).toBeInTheDocument();
          expect(screen.getByText('keyword=[]')).toBeInTheDocument();
          act(() => useTabListStore.getState().changeCurrentView(TAB, 'bucketList'));
          expect(screen.getByText('bucket keyword=[]')).toBeInTheDocument();
          expect(nameBox()).toHaveValue('');
        });
      });

      it('applies the keyword to the object list and clears the selection', async () => {
        objectTab({ selectionItem: { k: true } });
        const user = setup();
        expect(screen.getByText('keyword=[]')).toBeInTheDocument();
        await user.type(searchBox(), ' foo {Enter}');
        expect(screen.getByText('keyword=[foo]')).toBeInTheDocument();
        expect(tab().selectionItem).toEqual({});
      });

      it('searches with the search button', async () => {
        objectTab();
        const user = setup();
        await user.type(searchBox(), 'bar');
        await user.click(btn('Search'));
        expect(screen.getByText('keyword=[bar]')).toBeInTheDocument();
      });

      it('clears the keyword with the clear button or by submitting empty text', async () => {
        objectTab();
        const user = setup();
        await user.type(searchBox(), 'foo{Enter}');
        await user.click(btn('Clear search'));
        expect(screen.getByText('keyword=[]')).toBeInTheDocument();
        expect(searchBox()).toHaveValue('');

        await user.type(searchBox(), 'foo{Enter}');
        expect(screen.getByText('keyword=[foo]')).toBeInTheDocument();
        await user.clear(searchBox());
        await user.type(searchBox(), '{Enter}');
        expect(screen.getByText('keyword=[]')).toBeInTheDocument();
      });

      it('changes nothing when cleared without an applied keyword', async () => {
        objectTab({ selectionItem: { k: true } });
        const user = setup();
        await user.type(searchBox(), '{Enter}');
        await user.type(searchBox(), 'foo');
        await user.click(btn('Clear search'));
        expect(screen.getByText('keyword=[]')).toBeInTheDocument();
        expect(searchBox()).toHaveValue('');
        expect(tab().selectionItem).toEqual({ k: true });
        expect(h.objectRefresh).not.toHaveBeenCalled();
      });

      it('clears the selection on clear only when a keyword is applied', async () => {
        objectTab({ selectionItem: { k: true } });
        const user = setup();
        // Empty Enter with no keyword: selection stays.
        await user.type(searchBox(), '{Enter}');
        expect(tab().selectionItem).toEqual({ k: true });
        // Text typed but never applied, then cleared: selection stays.
        await user.type(searchBox(), 'foo');
        await user.click(btn('Clear search'));
        expect(tab().selectionItem).toEqual({ k: true });
        // Applied keyword, then cleared: selection is cleared.
        await user.type(searchBox(), 'foo{Enter}');
        act(() => useTabListStore.getState().addSelectItem(TAB, ['k2']));
        expect(tab().selectionItem).toEqual({ k2: true });
        await user.click(btn('Clear search'));
        expect(tab().selectionItem).toEqual({});
      });

      it('searches again from the first page when the same keyword is submitted', async () => {
        objectTab();
        const user = setup();
        await user.type(searchBox(), 'foo{Enter}');
        expect(h.objectRefresh).not.toHaveBeenCalled();
        act(() => useTabListStore.getState().addSelectItem(TAB, ['k']));
        await user.click(btn('Search'));
        expect(h.objectRefresh).toHaveBeenCalledTimes(1);
        expect(screen.getByText('keyword=[foo]')).toBeInTheDocument();
        expect(tab().selectionItem).toEqual({});
      });

      it('does not refresh when the keyword differs from the applied one', async () => {
        objectTab();
        const user = setup();
        await user.type(searchBox(), 'foo{Enter}');
        await user.type(searchBox(), 'x{Enter}');
        expect(screen.getByText('keyword=[foox]')).toBeInTheDocument();
        expect(h.objectRefresh).not.toHaveBeenCalled();
      });

      it('is disabled while the profile is not connected', () => {
        setProfile({ isConnected: false });
        objectTab();
        setup();
        // Disconnected tabs fall back to the bucket list: its search box is shown but disabled.
        expect(screen.queryByPlaceholderText('Search by key')).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('Search by name')).toBeDisabled();
      });

      it.each([
        ['folder', () => useTabListStore.getState().changePrefix(TAB, 'x/')],
        ['bucket', () => useTabListStore.getState().changeCurrentView(TAB, 'objectList', 'other')],
      ])('resets the keyword when the %s changes', async (_name, change) => {
        objectTab();
        const user = setup();
        await user.type(searchBox(), 'foo{Enter}');
        expect(screen.getByText('keyword=[foo]')).toBeInTheDocument();

        act(() => change());
        await waitFor(() => expect(screen.getByText('keyword=[]')).toBeInTheDocument());
        expect(searchBox()).toHaveValue('');
      });

      it('starts without a keyword when the same bucket is opened again after leaving the object list', async () => {
        objectTab();
        const user = setup();
        await user.type(searchBox(), 'foo{Enter}');
        act(() => useTabListStore.getState().changeCurrentView(TAB, 'bucketList'));
        expect(screen.getByPlaceholderText('Search by name')).toBeInTheDocument();
        act(() => useTabListStore.getState().changeCurrentView(TAB, 'objectList', 'b'));
        expect(screen.getByText('keyword=[]')).toBeInTheDocument();
        expect(searchBox()).toHaveValue('');
      });

      it('resets the keyword when the profile changes', async () => {
        objectTab();
        const user = setup();
        await user.type(searchBox(), 'foo{Enter}');
        act(() => {
          useProfileStore.setState({
            connectionProfiles: { p1: profile({ isConnected: true }), p2: profile({ id: 'p2', isConnected: true }) },
          });
          useTabListStore.getState().updateTab(TAB, { profileId: 'p2' });
        });
        await waitFor(() => expect(screen.getByText('keyword=[]')).toBeInTheDocument());
        expect(searchBox()).toHaveValue('');
      });
    });

    it('does not show the drawer in the bucket list', () => {
      setTab({ detailItem: new ObjectItem({ key: 'k' }) });
      setup();
      expect(screen.queryByText(/^drawer/)).not.toBeInTheDocument();
      expect(document.querySelector(`[data-tab-id="${TAB}"]`)).not.toHaveAttribute('data-file-drop-target');
    });
  });

  describe('upload', () => {
    const pickerMock = vi.mocked(showUploadPickerModal);
    const file = (name: string) => ({ path: `/local/${name}`, relKey: name, size: 1, isLarge: false });
    const picked = (bucket: string, names: string[] = ['a.txt']) => ({ bucket, files: names.map(file) });
    const uploadBtn = () => btn('Upload files');
    const objectTab = (patch: Record<string, unknown> = {}) =>
      setTab({ currentView: 'objectList', bucket: 'b', prefix: 'a/', ...patch });

    beforeEach(() => {
      setProfile({ isConnected: true });
      h.objectRefresh.mockResolvedValue(undefined);
      vi.mocked(callIPC).mockResolvedValue({} as never);
      pickerMock.mockResolvedValue(null as never);
    });

    it('shows the upload button in the bucket list and in the object list', () => {
      setup();
      expect(uploadBtn()).toBeEnabled();
      cleanup();
      objectTab();
      setup();
      expect(uploadBtn()).toBeEnabled();
    });

    it('disables the upload button until the profile is connected', () => {
      setProfile({ isConnected: false });
      setup();
      expect(uploadBtn()).toBeDisabled();
    });

    it('opens the picker for the current bucket and folder in the object list', async () => {
      objectTab();
      const user = setup();
      await user.click(uploadBtn());
      expect(pickerMock).toHaveBeenCalledExactlyOnceWith({
        tabId: TAB,
        connectionId: 'p1',
        profileName: 'Prof',
        bucket: 'b',
        prefix: 'a/',
      });
    });

    it('opens the picker without a fixed bucket and an empty prefix in the bucket list', async () => {
      setTab({ prefix: 'stale/' });
      const user = setup();
      await user.click(uploadBtn());
      expect(pickerMock).toHaveBeenCalledExactlyOnceWith({
        tabId: TAB,
        connectionId: 'p1',
        profileName: 'Prof',
        bucket: undefined,
        prefix: '',
      });
    });

    it('opens the picker without a fixed bucket when the object view has no bucket', async () => {
      setTab({ currentView: 'objectList', bucket: undefined, prefix: 'a/' });
      const user = setup();
      await user.click(uploadBtn());
      expect(pickerMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ bucket: undefined, prefix: '' }));
    });

    it('does nothing when the profile has no id', async () => {
      setProfile({ isConnected: true, id: '' });
      const user = setup();
      await user.click(uploadBtn());
      expect(pickerMock).not.toHaveBeenCalled();
    });

    it('warns and does not open the picker while another upload is running', async () => {
      useTabListStore.setState({ uploadingTabId: 'other' });
      const user = setup();
      await user.click(uploadBtn());
      expect(toast.warning).toHaveBeenCalledWith('Another upload is running, please wait until it finishes.');
      expect(pickerMock).not.toHaveBeenCalled();
    });

    it('does not upload when the picker is canceled', async () => {
      pickerMock.mockResolvedValue(null as never);
      const user = setup();
      await user.click(uploadBtn());
      expect(callIPC).not.toHaveBeenCalled();
      expect(useTabListStore.getState().uploadingTabId).toBeNull();
    });

    it('does not upload when the picker chunk failed to load (undefined)', async () => {
      pickerMock.mockResolvedValue(undefined);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(pickerMock).toHaveBeenCalledTimes(1));
      expect(callIPC).not.toHaveBeenCalled();
      expect(useTabListStore.getState().uploadingTabId).toBeNull();
    });

    it('does not upload when no file was ticked', async () => {
      pickerMock.mockResolvedValue({ bucket: 'b', files: [] } as never);
      const user = setup();
      await user.click(uploadBtn());
      expect(callIPC).not.toHaveBeenCalled();
    });

    it('uploads the files into the current folder, then refreshes the same list', async () => {
      objectTab();
      pickerMock.mockResolvedValue(picked('b', ['a.txt', 'b.txt']) as never);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(h.objectRefresh).toHaveBeenCalledTimes(1));
      expect(callIPC).toHaveBeenCalledExactlyOnceWith(UploadObject, [
        {
          connectionId: 'p1',
          profileName: 'Prof',
          bucket: 'b',
          prefix: 'a/',
          objList: [
            { path: '/local/a.txt', relKey: 'a.txt' },
            { path: '/local/b.txt', relKey: 'b.txt' },
          ],
        },
      ]);
      expect(useTabListStore.getState().uploadingTabId).toBeNull();
    });

    it('marks the tab as uploading while the upload runs', async () => {
      objectTab();
      pickerMock.mockResolvedValue(picked('b') as never);
      let seen: string | null = null;
      vi.mocked(callIPC).mockImplementation((async () => {
        seen = useTabListStore.getState().uploadingTabId;
        return {};
      }) as never);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(h.objectRefresh).toHaveBeenCalled());
      expect(seen).toBe(TAB);
    });

    it('uploads to the root of the bucket chosen in the picker from the bucket list and does not refresh', async () => {
      pickerMock.mockResolvedValue(picked('chosen') as never);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(callIPC).toHaveBeenCalledTimes(1));
      expect(vi.mocked(callIPC).mock.calls[0][1]).toEqual([expect.objectContaining({ bucket: 'chosen', prefix: '' })]);
      await waitFor(() => expect(useTabListStore.getState().uploadingTabId).toBeNull());
      expect(h.objectRefresh).not.toHaveBeenCalled();
      expect(h.bucketRefresh).not.toHaveBeenCalled();
    });

    it('refreshes when the user opened the target bucket root during the upload', async () => {
      pickerMock.mockResolvedValue(picked('chosen') as never);
      vi.mocked(callIPC).mockImplementation((async () => {
        useTabListStore.getState().changeCurrentView(TAB, 'objectList', 'chosen');
        return {};
      }) as never);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(h.objectRefresh).toHaveBeenCalledTimes(1));
    });

    it.each([
      ['another folder', { prefix: 'other/' }],
      ['another bucket', { bucket: 'else' }],
      ['the bucket list', { currentView: 'bucketList' }],
    ])('does not refresh when the user moved to %s during the upload', async (_name, patch) => {
      objectTab();
      pickerMock.mockResolvedValue(picked('b') as never);
      vi.mocked(callIPC).mockImplementation((async () => {
        useTabListStore.getState().updateTab(TAB, patch as never);
        return {};
      }) as never);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(useTabListStore.getState().uploadingTabId).toBeNull());
      expect(h.objectRefresh).not.toHaveBeenCalled();
    });

    it('does not refresh when the tab was closed during the upload', async () => {
      objectTab();
      pickerMock.mockResolvedValue(picked('b') as never);
      vi.mocked(callIPC).mockImplementation((async () => {
        useTabListStore.setState({ tabList: {} });
        return {};
      }) as never);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(useTabListStore.getState().uploadingTabId).toBeNull());
      expect(h.objectRefresh).not.toHaveBeenCalled();
    });

    it('still refreshes and releases the tab when the upload fails (callIPC returns null)', async () => {
      objectTab();
      pickerMock.mockResolvedValue(picked('b') as never);
      vi.mocked(callIPC).mockResolvedValue(null as never);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(h.objectRefresh).toHaveBeenCalledTimes(1));
      expect(useTabListStore.getState().uploadingTabId).toBeNull();
    });

    it('does not upload when another upload started while the picker was open', async () => {
      objectTab();
      pickerMock.mockImplementation((async () => {
        useTabListStore.setState({ uploadingTabId: 'other' });
        return picked('b');
      }) as never);
      const user = setup();
      await user.click(uploadBtn());
      await waitFor(() => expect(toast.warning).toHaveBeenCalled());
      expect(callIPC).not.toHaveBeenCalled();
      expect(useTabListStore.getState().uploadingTabId).toBe('other');
    });
  });

  it('passes its tab id to the bucket list', () => {
    setup();
    expect(screen.getByText(`bucket tab=${TAB}`)).toBeInTheDocument();
  });

  describe('scroll position when the tab is hidden (Activity)', () => {
    // jsdom has no layout: back scrollTop with a variable and let the test play the browser (display none resets it).
    const scroller = () => {
      const el = document.querySelector<HTMLElement>(`[data-tab-id="${TAB}"]`)!;
      const box = { top: 0, writes: [] as number[] };
      Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => box.top,
        set: (value: number) => {
          box.top = value;
          box.writes.push(value);
        },
      });
      return box;
    };
    const ui = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <TabDetail tabId={TAB} />
      </Activity>
    );

    it('restores the scroll offset that the browser reset while the tab was hidden', () => {
      const view = renderWithProviders(ui('visible'));
      const box = scroller();
      box.top = 240;

      view.rerender(ui('hidden'));
      box.top = 0;
      view.rerender(ui('visible'));

      expect(box.top).toBe(240);
    });

    it('does not touch the scroll offset when the tab was never scrolled', () => {
      const view = renderWithProviders(ui('visible'));
      const box = scroller();

      view.rerender(ui('hidden'));
      view.rerender(ui('visible'));

      expect(box.writes).toEqual([]);
    });

    it('keeps the latest offset across several hide and show rounds', () => {
      const view = renderWithProviders(ui('visible'));
      const box = scroller();
      box.top = 100;
      view.rerender(ui('hidden'));
      box.top = 0;
      view.rerender(ui('visible'));
      box.top = 300;

      view.rerender(ui('hidden'));
      box.top = 0;
      view.rerender(ui('visible'));

      expect(box.top).toBe(300);
    });
  });
});
