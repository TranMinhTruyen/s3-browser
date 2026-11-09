import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectS3ByProfile, Disconnect } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DeleteProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { Events } from '@wailsio/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ConnectionProfiles from '@/components/layouts/navbar/components/ConnectionProfiles';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { showConnectModal, showExportProfileModal } from '@/components/modals/lazyModals';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// jsdom has no layout, so render every row except the keys listed in `hidden` (scrolled out of the range).
const virtual = vi.hoisted(() => ({
  hidden: new Set<string>(),
  options: null as null | Record<string, unknown>,
}));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number;
    getItemKey: (i: number) => string;
    estimateSize: () => number;
    gap?: number;
    getScrollElement: () => unknown;
  }) => {
    const size = options.estimateSize();
    const gap = options.gap ?? 0;
    virtual.options = { ...options, estimate: size };
    return {
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_, index) => ({
          key: options.getItemKey(index),
          index,
          start: index * (size + gap),
        })).filter(row => !virtual.hidden.has(String(row.key))),
      getTotalSize: () => Math.max(0, options.count * size + (options.count - 1) * gap),
    };
  },
}));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  ConnectS3ByProfile: vi.fn(),
  Disconnect: vi.fn(),
}));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({
  DeleteProfileById: vi.fn(),
  GetAllConnectionProfile: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showExportProfileModal: vi.fn(),
  showHistoryModal: vi.fn(),
}));

const callIPCMock = vi.mocked(callIPC);
const confirmMock = vi.mocked(ConfirmModal.show);
const connectModalMock = vi.mocked(showConnectModal);
const exportModalMock = vi.mocked(showExportProfileModal);
const flush = () => act(async () => {});

const profile = (id: string, extra: Partial<ConnectionProfileOutput> = {}) =>
  new ConnectionProfileOutput({
    id,
    name: `${id}-name`,
    provider: 'aws',
    color: '#d0ebff',
    accessKey: 'AK',
    savedSecrets: ['secretKey'],
    isConnected: false,
    ...extra,
  });

const profiles = () => useProfileStore.getState().connectionProfiles;

// Results of the backend calls, by binding; a function result is called lazily.
let ipcResult: Map<unknown, unknown>;
const loadConnectionProfiles = vi.fn();
const resetViewByProfile = vi.fn();
const clearProfile = vi.fn();
// Handlers registered through Events.On, by event name.
let handlers: Record<string, (e: { data: unknown }) => void>;
const unsubscribe = vi.fn();

function renderProfiles(initial: Record<string, ConnectionProfileOutput | undefined>, loaded = false) {
  useProfileStore.setState({ connectionProfiles: initial, loaded, loadConnectionProfiles });
  return renderWithProviders(<ConnectionProfiles />);
}

const card = (name: string) => screen.getByText(name).closest<HTMLElement>('.mantine-Card-root')!;

async function clickMenuItem(user: ReturnType<typeof userEvent.setup>, name: string, item: string) {
  fireEvent.contextMenu(card(name));
  // Matching by text: the accessible name is not reliable while the dropdown transition runs.
  const items = await screen.findAllByRole('menuitem');
  await user.click(items.find(i => i.textContent === item)!);
}

describe('ConnectionProfiles', () => {
  beforeEach(() => {
    ipcResult = new Map();
    virtual.hidden = new Set();
    handlers = {};
    loadConnectionProfiles.mockResolvedValue(undefined);
    callIPCMock.mockImplementation((async (binding: unknown) => ipcResult.get(binding) ?? null) as never);
    vi.mocked(Events.On).mockImplementation(((name: string, cb: (e: { data: unknown }) => void) => {
      handlers[name] = cb;
      return unsubscribe;
    }) as never);
    useTabListStore.setState({ resetViewByProfile, clearProfile });
  });

  describe('rendering', () => {
    it('lists the profiles without loading them and keeps the store on unmount (App owns the load)', async () => {
      const { unmount } = renderProfiles({ a: profile('a'), skipped: undefined, b: profile('b', { name: 'Bee' }) });

      expect(loadConnectionProfiles).not.toHaveBeenCalled();
      expect(screen.getByText('a-name')).toBeInTheDocument();
      expect(screen.getByText('Bee')).toBeInTheDocument();
      expect(screen.getAllByText('aws')).toHaveLength(2);

      unmount();

      expect(Object.keys(profiles())).toEqual(['a', 'skipped', 'b']);
      expect(loadConnectionProfiles).not.toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalled();
    });

    it('shows the empty state only when the profiles are loaded and the list is empty', () => {
      const empty = 'No connection profiles yet. Use the buttons above to create one.';
      const { unmount } = renderProfiles({}, false);
      expect(screen.queryByText(empty)).not.toBeInTheDocument();
      unmount();

      const loadedEmpty = renderProfiles({}, true);
      expect(screen.getByText(empty)).toBeInTheDocument();
      loadedEmpty.unmount();

      renderProfiles({ a: profile('a') }, true);
      expect(screen.queryByText(empty)).not.toBeInTheDocument();
    });

    it('shows a connected profile with a green status and a disconnected one with a red status', () => {
      renderProfiles({
        on: profile('on', { isConnected: true, color: undefined }),
        off: profile('off', { color: '#000000' }),
      });

      const status = (name: string) => card(name).querySelector<HTMLElement>('.mantine-Card-section')!;
      expect(status('on-name').style.backgroundColor).toBe('var(--mantine-color-green-light)');
      expect(status('on-name').style.color).toBe('var(--mantine-color-green-light-color)');
      expect(status('off-name').style.backgroundColor).toBe('var(--mantine-color-red-light)');
      expect(status('off-name').style.color).toBe('var(--mantine-color-red-light-color)');
      expect(card('on-name').querySelector('.lucide-cable')).toBeInTheDocument();
      expect(card('off-name').querySelector('.lucide-unplug')).toBeInTheDocument();
    });
  });

  describe('virtualization', () => {
    it('keys rows by profile id, uses a 68px card with an 8px gap, and attaches the scroll container', () => {
      renderProfiles({ a: profile('a'), b: profile('b') });

      const opts = virtual.options as {
        count: number;
        overscan: number;
        estimate: number;
        gap?: number;
        measureElement?: unknown;
        getScrollElement: () => HTMLElement;
        getItemKey: (i: number) => string;
      };
      expect(opts.count).toBe(2);
      expect(opts.gap).toBe(8);
      expect(opts.measureElement).toBeUndefined();
      expect(opts.overscan).toBe(10);
      expect(opts.estimate).toBe(68);
      expect(opts.getItemKey(1)).toBe('b');
      expect(opts.getScrollElement()).toContainElement(screen.getByText('a-name'));
    });

    it('sizes the list by cards plus gaps only between them (none after the last) and positions fixed-height rows without measuring them', () => {
      renderProfiles({ a: profile('a'), b: profile('b'), c: profile('c') });

      const row = (name: string) => card(name).parentElement as HTMLElement;
      expect(row('b-name').parentElement).toHaveStyle({ height: '220px' });
      expect(row('a-name')).toHaveStyle({ height: '68px', transform: 'translateY(0px)' });
      expect(row('c-name')).toHaveStyle({ height: '68px', transform: 'translateY(152px)' });
      expect(card('a-name')).not.toHaveAttribute('data-index');
    });

    it('only renders the rows the virtualizer returns', () => {
      virtual.hidden = new Set(['b']);
      renderProfiles({ a: profile('a'), b: profile('b') });

      expect(screen.getByText('a-name')).toBeInTheDocument();
      expect(screen.queryByText('b-name')).not.toBeInTheDocument();
    });
  });

  describe('text color', () => {
    it.each([
      ['light', '#ffffff', 'var(--mantine-color-black)'],
      ['dark', '#000000', 'var(--mantine-color-white)'],
      ['unset', undefined, 'var(--mantine-color-text)'],
    ])('uses a contrasting text color for a %s profile color', (_name, color, expected) => {
      renderProfiles({ p: profile('p', { color }) });

      expect(card('p-name').style.color).toBe(expected);
    });
  });

  describe('auto connect', () => {
    it('connects the profiles flagged as auto connect once, skipping the connected and the others', async () => {
      ipcResult.set(ConnectS3ByProfile, { isConnected: true });
      renderProfiles({
        auto: profile('auto', { autoConnect: true }),
        done: profile('done', { autoConnect: true, isConnected: true }),
        manual: profile('manual'),
        gone: undefined,
      });
      await flush();

      expect(callIPCMock).toHaveBeenCalledTimes(1);
      expect(callIPCMock).toHaveBeenCalledWith(ConnectS3ByProfile, ['auto'], { signal: expect.any(AbortSignal) });
      expect(profiles().auto?.isConnected).toBe(true);

      // A later change of the list does not auto connect again.
      act(() =>
        useProfileStore.getState().updateConnectionProfiles('manual', profile('manual', { autoConnect: true }))
      );
      await flush();
      expect(callIPCMock).toHaveBeenCalledTimes(1);
    });

    it('does not connect anything while the list is empty, then auto connects once it is loaded', async () => {
      ipcResult.set(ConnectS3ByProfile, { isConnected: true });
      renderProfiles({});
      await flush();
      expect(callIPCMock).not.toHaveBeenCalled();

      act(() => useProfileStore.setState({ connectionProfiles: { late: profile('late', { autoConnect: true }) } }));
      await flush();

      expect(callIPCMock).toHaveBeenCalledWith(ConnectS3ByProfile, ['late'], { signal: expect.any(AbortSignal) });
    });

    it('asks for the secret key instead when an auto connect profile has none saved', async () => {
      const noSecret = profile('p', { autoConnect: true, savedSecrets: [] });
      renderProfiles({ p: noSecret });
      await flush();

      expect(callIPCMock).not.toHaveBeenCalled();
      expect(connectModalMock).toHaveBeenCalledWith({ mode: 'manualconnect', connectionProfile: { ...noSecret } });
    });

    it('auto connects again after the backend saves a profile', async () => {
      ipcResult.set(ConnectS3ByProfile, { isConnected: true });
      renderProfiles({ a: profile('a') });
      await flush();
      expect(callIPCMock).not.toHaveBeenCalled();

      act(() => handlers['bucket:connect-save-profile']({ data: profile('a', { autoConnect: true }) }));
      await flush();

      expect(callIPCMock).toHaveBeenCalledWith(ConnectS3ByProfile, ['a'], { signal: expect.any(AbortSignal) });
    });
  });

  describe('save-profile event', () => {
    it('updates the stored profile', async () => {
      renderProfiles({ a: profile('a') });

      act(() => handlers['bucket:connect-save-profile']({ data: profile('a', { name: 'renamed', version: 2 }) }));

      expect(profiles().a?.name).toBe('renamed');
      expect(profiles().a?.version).toBe(2);
      expect(screen.getByText('renamed')).toBeInTheDocument();
    });

    it('ignores an event without a profile id', async () => {
      renderProfiles({ a: profile('a') });

      act(() => handlers['bucket:connect-save-profile']({ data: { name: 'x' } }));

      expect(Object.keys(profiles())).toEqual(['a']);
      expect(profiles().a?.name).toBe('a-name');
    });
  });

  describe('connect', () => {
    it('connects on double click and marks the profile as connected', async () => {
      ipcResult.set(ConnectS3ByProfile, { isConnected: true });
      renderProfiles({ a: profile('a') });

      fireEvent.doubleClick(card('a-name'));

      await waitFor(() => expect(card('a-name').querySelector('.lucide-cable')).toBeInTheDocument());
      expect(profiles().a?.isConnected).toBe(true);
      expect(callIPCMock).toHaveBeenCalledWith(ConnectS3ByProfile, ['a'], { signal: expect.any(AbortSignal) });
    });

    it('connects from the context menu', async () => {
      ipcResult.set(ConnectS3ByProfile, { isConnected: true });
      const user = userEvent.setup();
      renderProfiles({ a: profile('a') });

      await clickMenuItem(user, 'a-name', 'Connect');

      await waitFor(() => expect(profiles().a?.isConnected).toBe(true));
    });

    it('keeps the profile disconnected when the backend does not connect', async () => {
      ipcResult.set(ConnectS3ByProfile, { isConnected: false });
      renderProfiles({ a: profile('a') });

      fireEvent.doubleClick(card('a-name'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      await flush();
      expect(profiles().a?.isConnected).toBe(false);
      expect(card('a-name').querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    });

    it('shows a loader and ignores further double clicks while connecting', async () => {
      let finish!: (v: unknown) => void;
      callIPCMock.mockReturnValue(new Promise(resolve => (finish = resolve)) as never);
      renderProfiles({ a: profile('a') });

      fireEvent.doubleClick(card('a-name'));
      await flush();
      expect(card('a-name').querySelector('.mantine-Loader-root')).toBeInTheDocument();

      fireEvent.doubleClick(card('a-name'));
      await flush();
      expect(callIPCMock).toHaveBeenCalledTimes(1);

      await act(async () => finish({ isConnected: true }));
      expect(card('a-name').querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
      expect(profiles().a?.isConnected).toBe(true);
    });

    it('does nothing on a connected profile', async () => {
      renderProfiles({ a: profile('a', { isConnected: true }) });

      fireEvent.doubleClick(card('a-name'));
      await flush();

      expect(callIPCMock).not.toHaveBeenCalled();
      expect(connectModalMock).not.toHaveBeenCalled();
    });

    it('opens the connect modal for a profile without a saved secret key once auto connect ran', async () => {
      const noSecret = profile('a', { savedSecrets: [] });
      renderProfiles({ a: noSecret });
      await flush(); // the auto connect pass runs on the first non-empty list

      fireEvent.doubleClick(card('a-name'));

      expect(connectModalMock).toHaveBeenCalledWith({ mode: 'manualconnect', connectionProfile: { ...noSecret } });
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('opens the connect modal for an assume role profile with an MFA device', async () => {
      const mfa = profile('a', { authType: 'assumeRole', authConfig: { mfaSerial: 'arn:mfa' } as never });
      renderProfiles({ a: mfa });
      await flush();

      fireEvent.doubleClick(card('a-name'));

      expect(connectModalMock).toHaveBeenCalledWith({ mode: 'manualconnect', connectionProfile: { ...mfa } });
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('connects directly a profile that needs no secret, such as an AWS CLI profile', async () => {
      ipcResult.set(ConnectS3ByProfile, { isConnected: true });
      renderProfiles({ a: profile('a', { authType: 'sharedProfile', accessKey: '', savedSecrets: [] }) });
      await flush();

      fireEvent.doubleClick(card('a-name'));

      await waitFor(() => expect(profiles().a?.isConnected).toBe(true));
      expect(callIPCMock).toHaveBeenCalledWith(ConnectS3ByProfile, ['a'], { signal: expect.any(AbortSignal) });
      expect(connectModalMock).not.toHaveBeenCalled();
    });

    it('does not auto connect an assume role profile with an MFA device but asks for the code', async () => {
      const mfa = profile('a', {
        autoConnect: true,
        authType: 'assumeRole',
        authConfig: { mfaSerial: 'arn:mfa' } as never,
      });
      renderProfiles({ a: mfa });
      await flush();

      expect(callIPCMock).not.toHaveBeenCalled();
      expect(connectModalMock).toHaveBeenCalledWith({ mode: 'manualconnect', connectionProfile: { ...mfa } });
    });
  });

  describe('disconnect', () => {
    it('disconnects from the context menu, updates the profile and resets its views', async () => {
      ipcResult.set(Disconnect, { ok: true });
      const user = userEvent.setup();
      renderProfiles({ a: profile('a', { isConnected: true }) });

      await clickMenuItem(user, 'a-name', 'Disconnect');

      await waitFor(() => expect(profiles().a?.isConnected).toBe(false));
      expect(callIPCMock).toHaveBeenCalledWith(Disconnect, ['a']);
      expect(resetViewByProfile).toHaveBeenCalledWith('a');
    });

    it('keeps the connection when the backend fails to disconnect', async () => {
      const user = userEvent.setup();
      renderProfiles({ a: profile('a', { isConnected: true }) });

      await clickMenuItem(user, 'a-name', 'Disconnect');

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      await flush();
      expect(profiles().a?.isConnected).toBe(true);
      expect(resetViewByProfile).not.toHaveBeenCalled();
    });

    it('ignores a second disconnect while the first is running', async () => {
      let finish!: (v: unknown) => void;
      callIPCMock.mockReturnValue(new Promise(resolve => (finish = resolve)) as never);
      renderProfiles({ a: profile('a', { isConnected: true }) });

      fireEvent.contextMenu(card('a-name'));
      const disconnect = (await screen.findAllByRole('menuitem')).find(i => i.textContent === 'Disconnect')!;
      // Click the same item twice, dispatching straight to it so the second click does reach the handler
      // even though the menu closes after the first one; the first call is still pending.
      fireEvent.click(disconnect);
      await flush();
      expect(callIPCMock).toHaveBeenCalledTimes(1);
      fireEvent.click(disconnect);
      await flush();

      expect(callIPCMock).toHaveBeenCalledTimes(1);
      await act(async () => finish({ ok: true }));
      expect(profiles().a?.isConnected).toBe(false);
    });

    it.each([
      ['a connected profile', true, ['Disconnect', 'Export', 'Delete']],
      ['a disconnected profile', false, ['Connect', 'Edit', 'Export', 'Delete']],
    ])('offers the matching actions for %s', async (_n, isConnected, expected) => {
      renderProfiles({ p: profile('p', { isConnected }) });

      fireEvent.contextMenu(card('p-name'));

      expect((await screen.findAllByRole('menuitem')).map(i => i.textContent)).toEqual(expected);
    });

    it('switches the actions when the profile of the open menu connects', async () => {
      renderProfiles({ p: profile('p') });
      fireEvent.contextMenu(card('p-name'));
      await screen.findAllByRole('menuitem');

      act(() => useProfileStore.getState().updateConnectionProfiles('p', profile('p', { isConnected: true })));

      await waitFor(() =>
        expect(screen.getAllByRole('menuitem', { hidden: true }).map(i => i.textContent)).toEqual([
          'Disconnect',
          'Export',
          'Delete',
        ])
      );
    });
  });

  describe('edit', () => {
    it('opens the connect modal in edit mode with a copy of the profile', async () => {
      const user = userEvent.setup();
      const off = profile('a');
      renderProfiles({ a: off });

      await clickMenuItem(user, 'a-name', 'Edit');

      expect(connectModalMock).toHaveBeenCalledWith({ mode: 'editProfile', connectionProfile: { ...off } });
    });
  });

  describe('export', () => {
    it.each([
      ['a disconnected profile', false],
      ['a connected profile', true],
    ])('opens the export modal with the stored profile for %s', async (_n, isConnected) => {
      const user = userEvent.setup();
      const stored = profile('a', { isConnected });
      renderProfiles({ a: stored });

      await clickMenuItem(user, 'a-name', 'Export');

      expect(exportModalMock).toHaveBeenCalledTimes(1);
      expect(exportModalMock).toHaveBeenCalledWith({ profile: profiles().a });
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('does nothing when the profile of the menu is no longer in the store', async () => {
      const user = userEvent.setup();
      renderProfiles({ a: profile('a') });
      fireEvent.contextMenu(card('a-name'));
      const items = await screen.findAllByRole('menuitem');
      const exportItem = items.find(i => i.textContent === 'Export')!;
      act(() => useProfileStore.setState({ connectionProfiles: {} }));

      await user.click(exportItem);

      expect(exportModalMock).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes a disconnected profile after one confirmation', async () => {
      confirmMock.mockResolvedValue(true);
      ipcResult.set(DeleteProfileById, { id: 'a' });
      const user = userEvent.setup();
      const off = profile('a');
      renderProfiles({ a: off, b: profile('b') });

      await clickMenuItem(user, 'a-name', 'Delete');

      await waitFor(() => expect(profiles().a).toBeUndefined());
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(confirmMock).toHaveBeenCalledWith({ type: 'warning', confirmCode: 'C000002' });
      expect(callIPCMock).toHaveBeenCalledWith(DeleteProfileById, [
        { id: 'a', name: 'a-name', version: off.version, authConfig: off.authConfig, authSecret: {} },
      ]);
      expect(clearProfile).toHaveBeenCalledWith('a');
      expect(profiles().b).toBeDefined();
    });

    it('keeps the profile when the deletion is declined', async () => {
      confirmMock.mockResolvedValue(false);
      const user = userEvent.setup();
      renderProfiles({ a: profile('a') });

      await clickMenuItem(user, 'a-name', 'Delete');

      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock).not.toHaveBeenCalled();
      expect(profiles().a).toBeDefined();
    });

    it('asks to confirm the disconnect first for a connected profile and stops when it is declined', async () => {
      confirmMock.mockResolvedValue(false);
      const user = userEvent.setup();
      renderProfiles({ a: profile('a', { isConnected: true }) });

      await clickMenuItem(user, 'a-name', 'Delete');

      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      expect(confirmMock).toHaveBeenCalledWith({ type: 'warning', confirmCode: 'C000003' });
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('asks both confirmations for a connected profile, then deletes it', async () => {
      confirmMock.mockResolvedValue(true);
      ipcResult.set(DeleteProfileById, { id: 'a' });
      const user = userEvent.setup();
      renderProfiles({ a: profile('a', { isConnected: true }) });

      await clickMenuItem(user, 'a-name', 'Delete');

      await waitFor(() => expect(profiles().a).toBeUndefined());
      expect(confirmMock.mock.calls.map(c => c[0].confirmCode)).toEqual(['C000003', 'C000002']);
    });

    it('reloads the list and keeps the views when a connected profile could not be deleted', async () => {
      confirmMock.mockResolvedValue(true);
      const user = userEvent.setup();
      renderProfiles({ a: profile('a', { isConnected: true }) });

      await clickMenuItem(user, 'a-name', 'Delete');

      await waitFor(() => expect(loadConnectionProfiles).toHaveBeenCalledTimes(1)); // only after the failure
      expect(profiles().a).toBeDefined();
      expect(clearProfile).not.toHaveBeenCalled();
      expect(resetViewByProfile).not.toHaveBeenCalled();
    });

    it('resets the views when the failed deletion left the profile disconnected', async () => {
      confirmMock.mockResolvedValue(true);
      // The reload after the failed deletion.
      loadConnectionProfiles.mockImplementationOnce(async () => {
        useProfileStore.getState().updateConnectionProfiles('a', profile('a', { isConnected: false }));
      });
      const user = userEvent.setup();
      renderProfiles({ a: profile('a', { isConnected: true }) });

      await clickMenuItem(user, 'a-name', 'Delete');

      await waitFor(() => expect(resetViewByProfile).toHaveBeenCalledWith('a'));
    });

    it('reloads without touching the views when a disconnected profile could not be deleted', async () => {
      confirmMock.mockResolvedValue(true);
      const user = userEvent.setup();
      renderProfiles({ a: profile('a') });

      await clickMenuItem(user, 'a-name', 'Delete');

      await waitFor(() => expect(loadConnectionProfiles).toHaveBeenCalledTimes(1));
      expect(resetViewByProfile).not.toHaveBeenCalled();
    });

    it('does nothing for a profile without an id', async () => {
      const user = userEvent.setup();
      renderProfiles({ a: profile('', { name: 'no-id' }) });

      await clickMenuItem(user, 'no-id', 'Delete');
      await flush();

      expect(confirmMock).not.toHaveBeenCalled();
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('does nothing while the profile is connecting', async () => {
      callIPCMock.mockReturnValue(new Promise(() => {}) as never);
      const user = userEvent.setup();
      renderProfiles({ a: profile('a') });
      fireEvent.doubleClick(card('a-name'));
      await flush();

      await clickMenuItem(user, 'a-name', 'Delete');
      await flush();

      expect(confirmMock).not.toHaveBeenCalled();
      expect(callIPCMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('context menus', () => {
    it('opens the menu for the right-clicked row', async () => {
      confirmMock.mockResolvedValue(false);
      renderProfiles({ a: profile('a'), b: profile('b', { isConnected: true }) });

      fireEvent.contextMenu(card('b-name'));
      const items = await screen.findAllByRole('menuitem');
      expect(items.map(i => i.textContent)).toEqual(['Disconnect', 'Export', 'Delete']);
    });

    it('does not open a menu, and suppresses the native one, on the empty area of the list', async () => {
      renderProfiles({ a: profile('a') });
      const list = card('a-name').parentElement!.parentElement!;

      const notPrevented = fireEvent.contextMenu(list);
      await flush();

      expect(notPrevented).toBe(false);
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('closes the menu when its profile is deleted from the store', async () => {
      renderProfiles({ a: profile('a'), b: profile('b') });
      fireEvent.contextMenu(card('a-name'));
      expect(await screen.findAllByRole('menuitem')).not.toHaveLength(0);

      act(() => useProfileStore.getState().deleteConnectionProfiles('a'));

      await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    });

    it('closes the open menu when the list scrolls', async () => {
      renderProfiles({ a: profile('a') });
      const scroller = card('a-name').parentElement!.parentElement!.parentElement!;
      fireEvent.contextMenu(card('a-name'));
      expect(await screen.findAllByRole('menuitem')).not.toHaveLength(0);

      fireEvent.scroll(scroller);

      await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    });

    it('listens to scroll only while the menu is open and removes the listener when it closes', async () => {
      renderProfiles({ a: profile('a') });
      const scroller = card('a-name').parentElement!.parentElement!.parentElement!;
      const add = vi.spyOn(scroller, 'addEventListener');
      const remove = vi.spyOn(scroller, 'removeEventListener');
      const scrollCalls = (spy: typeof add) => spy.mock.calls.filter(c => c[0] === 'scroll');

      fireEvent.scroll(scroller);
      expect(scrollCalls(add)).toHaveLength(0);

      fireEvent.contextMenu(card('a-name'));
      await screen.findAllByRole('menuitem');
      // Floating UI also listens for scroll while the dropdown is open, so check passive listeners in general.
      expect(scrollCalls(add).length).toBeGreaterThan(0);
      expect(scrollCalls(add).some(c => (c[2] as AddEventListenerOptions | undefined)?.passive === true)).toBe(true);
      expect(scrollCalls(remove)).toHaveLength(0);

      await userEvent.keyboard('{Escape}');

      // Every listener added while open is removed again on close.
      await waitFor(() => expect(scrollCalls(remove)).toHaveLength(scrollCalls(add).length));
      scrollCalls(add).forEach(c => expect(scrollCalls(remove).map(r => r[1])).toContain(c[1]));
    });

    it('does not mount a menu inside the rows', () => {
      renderProfiles({ a: profile('a'), b: profile('b') });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('keeps only the latest context menu open, with the actions of the latest row', async () => {
      renderProfiles({ a: profile('a'), b: profile('b', { isConnected: true }) });

      fireEvent.contextMenu(card('a-name'));
      expect((await screen.findAllByRole('menuitem')).map(i => i.textContent)).toEqual([
        'Connect',
        'Edit',
        'Export',
        'Delete',
      ]);

      fireEvent.contextMenu(card('b-name'));
      // The dropdown is re-positioned for the new row, so it is not exposed to the accessibility tree meanwhile.
      await waitFor(() =>
        expect(screen.getAllByRole('menuitem', { hidden: true }).map(i => i.textContent)).toEqual([
          'Disconnect',
          'Export',
          'Delete',
        ])
      );
      expect(document.querySelectorAll('[data-menu-dropdown]')).toHaveLength(1);
    });
  });
});
