import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { CreateProfile, UpdateProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import ConnectModal from '@/components/modals/connect/ConnectModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ ConnectS3: vi.fn(), ListAwsProfiles: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({
  CreateProfile: vi.fn(),
  UpdateProfileById: vi.fn(),
  GetAllConnectionProfile: vi.fn(),
}));
vi.mock('@wails/S3Browser/internal/handlers/masterhandler', () => ({ GetMasterData: vi.fn(), GetRegionData: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));

const callIPCMock = vi.mocked(callIPC);
const confirmMock = vi.mocked(ConfirmModal.show);
const flush = () => act(async () => {});

const profile = (extra: Partial<ConnectionProfileOutput> = {}) =>
  new ConnectionProfileOutput({
    id: 'p1',
    name: 'my profile',
    color: '#ff0000',
    provider: 'aws',
    endpoint: 'https://s3.example.com',
    region: 'ap-northeast-1',
    accessKey: 'AK',
    savedSecrets: ['secretKey'],
    version: 3,
    ...extra,
  });

type Props = Parameters<typeof ConnectModal.show>[0];

async function open(props?: Props) {
  renderWithProviders(<div />);
  act(() => {
    ConnectModal.show(props);
  });
  await flush();
  return userEvent.setup({ pointerEventsCheck: 0 });
}

const field = (name: RegExp) => screen.getByLabelText(name, { selector: 'input' });
const button = (name: string) => screen.getByRole('button', { name });
const isClosed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

describe('ConnectModal', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    useProfileStore.setState({ connectionProfiles: {} });
    useMasterDataStore.setState({
      regionData: { '01': [{ name: 'Tokyo', value1: 'ap-northeast-1', sortOrder: 1 } as never] },
    });
    callIPCMock.mockResolvedValue(null);
  });

  describe('footer', () => {
    it.each([['connect'], ['manualconnect'], ['createProfile'], ['editProfile']] as const)(
      'keeps its buttons on one line in %s mode, so the layout does not jump when the language changes',
      async mode => {
        await open({ mode, connectionProfile: profile() });

        const footer = button('Test connection').parentElement!;
        expect(footer).toHaveStyle({ '--group-wrap': 'nowrap', '--group-justify': 'space-between' });
        expect(footer.querySelectorAll('button')).toHaveLength(2);
      }
    );
  });

  describe('connect mode', () => {
    it('shows the required-field errors and does not call the backend when the form is empty', async () => {
      const user = await open();

      await user.click(button('Connect'));

      expect(await screen.findByText('Access key is required')).toBeInTheDocument();
      expect(screen.getByText('Secret key is required')).toBeInTheDocument();
      expect(screen.getByText('Region is required')).toBeInTheDocument();
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('connects with the entered values and closes when the backend reports a connection', async () => {
      callIPCMock.mockResolvedValue({ isConnected: true } as never);
      const user = await open();

      // One change event per field instead of one per keystroke: typing ~30 keys through the form was
      // what made this test time out when the whole suite runs in parallel.
      fireEvent.change(field(/Endpoint/), { target: { value: 'https://play.min.io' } });
      await user.click(screen.getByRole('button', { name: /Region/ }));
      await user.click(await screen.findByText('Tokyo'));
      fireEvent.change(field(/Access key/), { target: { value: 'AK' } });
      fireEvent.change(field(/Secret key/), { target: { value: 'SK' } });
      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      const [binding, args] = callIPCMock.mock.calls[0];
      expect(binding).toBe(ConnectS3);
      expect(args).toEqual([
        {
          name: expect.stringMatching(/^Connection No\./),
          color: '#d0ebff',
          provider: 'aws',
          endpoint: 'https://play.min.io',
          region: 'ap-northeast-1',
          accessKey: 'AK',
          secretKey: 'SK',
          pathStyle: false,
          savePassword: false,
          autoConnect: false,
          authType: 'static',
          authConfig: {},
          authSecret: { sessionToken: '' },
          mfaCode: '',
          oidcSessionId: '',
          id: '',
          version: 1,
        },
        false,
        false,
      ]);
      await isClosed();
    });

    it('tests the connection without closing the modal', async () => {
      callIPCMock.mockResolvedValue({ isConnected: true } as never);
      const user = await open();

      await user.type(field(/Endpoint/), 'https://play.min.io');
      await user.click(screen.getByRole('button', { name: /Region/ }));
      await user.click(await screen.findByText('Tokyo'));
      await user.type(field(/Access key/), 'AK');
      await user.type(field(/Secret key/), 'SK');
      await user.click(button('Test connection'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock.mock.calls[0][1]).toEqual([expect.objectContaining({ id: '', version: 1 }), true, false]);
      await flush();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('ignores the profile passed to the connect mode', async () => {
      const user = await open({ mode: 'connect', connectionProfile: profile() });

      expect(field(/Endpoint/)).toHaveValue('');
      await user.click(button('Connect'));
      expect(await screen.findByText('Access key is required')).toBeInTheDocument();
    });

    it('keeps the modal open when the connection fails', async () => {
      callIPCMock.mockResolvedValue({ isConnected: false } as never);
      const user = await open({ mode: 'manualconnect', connectionProfile: profile() });

      fireEvent.change(field(/Secret key/), { target: { value: 'SK' } });
      await user.click(button('Connect'));
      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      await flush();

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(useProfileStore.getState().connectionProfiles).toEqual({});
    });
  });

  describe('manualconnect mode', () => {
    it('prefills the form, marks the secrets as saved and connects as an existing profile', async () => {
      callIPCMock.mockResolvedValue({ isConnected: true } as never);
      const connectionProfile = profile();
      const user = await open({ mode: 'manualconnect', connectionProfile });

      expect(field(/Profile name/)).toHaveValue('my profile');
      expect(field(/Endpoint/)).toHaveValue('https://s3.example.com');
      expect(field(/Access key/)).toHaveValue('AK');
      expect(screen.getByRole('checkbox', { name: 'Save secrets' })).toBeChecked();

      // The backend never returns the secret, so it has to be typed again.
      fireEvent.change(field(/Secret key/), { target: { value: 'SK' } });
      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      const [binding, args] = callIPCMock.mock.calls[0];
      expect(binding).toBe(ConnectS3);
      expect(args).toEqual([
        expect.objectContaining({ id: 'p1', version: 3, endpoint: 'https://s3.example.com', secretKey: 'SK' }),
        false,
        true,
      ]);
      expect(useProfileStore.getState().connectionProfiles.p1).toEqual({ ...connectionProfile, isConnected: true });
      await isClosed();
    });

    it('leaves the saved-secret checkbox off when the profile has no secret key', async () => {
      const user = await open({ mode: 'manualconnect', connectionProfile: profile({ savedSecrets: [] }) });

      expect(screen.getByRole('checkbox', { name: 'Save secrets' })).not.toBeChecked();
      // The secret key is required to connect.
      await user.click(button('Connect'));
      expect(await screen.findByText('Secret key is required')).toBeInTheDocument();
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('closes without touching the profile store when the profile has no id', async () => {
      callIPCMock.mockResolvedValue({ isConnected: true } as never);
      const user = await open({ mode: 'manualconnect', connectionProfile: profile({ id: '', version: undefined }) });

      fireEvent.change(field(/Secret key/), { target: { value: 'SK' } });
      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock.mock.calls[0][1]).toEqual([expect.objectContaining({ id: '', version: 1 }), false, true]);
      expect(useProfileStore.getState().connectionProfiles).toEqual({});
      await isClosed();
    });

    it('tests the connection as an existing profile and keeps the modal open', async () => {
      callIPCMock.mockResolvedValue({ isConnected: true } as never);
      const user = await open({ mode: 'manualconnect', connectionProfile: profile() });

      fireEvent.change(field(/Secret key/), { target: { value: 'SK' } });
      await user.click(button('Test connection'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock.mock.calls[0][1]).toEqual([expect.objectContaining({ id: 'p1' }), true, true]);
      await flush();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(useProfileStore.getState().connectionProfiles).toEqual({});
    });
  });

  describe('createProfile mode', () => {
    it('creates a profile without a secret key, stores the result and closes', async () => {
      callIPCMock.mockResolvedValue({ id: 'new-1', name: 'created' } as never);
      const user = await open({ mode: 'createProfile' });

      await user.type(field(/Endpoint/), 'https://s3.example.com');
      await user.click(screen.getByRole('button', { name: /Region/ }));
      await user.click(await screen.findByText('Tokyo'));
      await user.type(field(/Access key/), 'AK');
      await user.click(button('Create profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      const [binding, args, options] = callIPCMock.mock.calls[0];
      expect(binding).toBe(CreateProfile);
      expect(args).toEqual([
        expect.objectContaining({ id: expect.any(String), version: 1, secretKey: '', accessKey: 'AK' }),
      ]);
      expect((args as [{ id: string }])[0].id).not.toBe('');
      expect(options).toEqual({ showMessage: true });
      expect(useProfileStore.getState().connectionProfiles['new-1']).toEqual({ id: 'new-1', name: 'created' });
      await isClosed();
    });

    it('stays open and stores nothing when the backend rejects the profile', async () => {
      const user = await open({ mode: 'createProfile' });

      await user.type(field(/Endpoint/), 'https://s3.example.com');
      await user.click(screen.getByRole('button', { name: /Region/ }));
      await user.click(await screen.findByText('Tokyo'));
      await user.type(field(/Access key/), 'AK');
      await user.click(button('Create profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      await flush();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(useProfileStore.getState().connectionProfiles).toEqual({});
    });

    it('validates the profile fields but not the secret key', async () => {
      const user = await open({ mode: 'createProfile' });

      await user.click(button('Create profile'));

      expect(await screen.findByText('Access key is required')).toBeInTheDocument();
      expect(screen.getByText('Region is required')).toBeInTheDocument();
      expect(screen.queryByText('Secret key is required')).not.toBeInTheDocument();
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('tests the connection from the profile form, which does require the secret key', async () => {
      const user = await open({ mode: 'createProfile' });

      await user.click(button('Test connection'));

      expect(await screen.findByText('Secret key is required')).toBeInTheDocument();
      expect(callIPCMock).not.toHaveBeenCalled();
    });
  });

  describe('editProfile mode', () => {
    it('asks for confirmation, then updates the profile and refreshes the form and store', async () => {
      confirmMock.mockResolvedValue(true);
      callIPCMock.mockResolvedValue({ ...profile({ name: 'renamed' }), version: 4 } as never);
      const user = await open({ mode: 'editProfile', connectionProfile: profile() });

      await user.clear(field(/Profile name/));
      await user.type(field(/Profile name/), 'renamed');
      await user.click(button('Update profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(confirmMock).toHaveBeenCalledWith({ type: 'info', confirmCode: 'C000001' });
      const [binding, args] = callIPCMock.mock.calls[0];
      expect(binding).toBe(UpdateProfileById);
      expect(args).toEqual([expect.objectContaining({ id: 'p1', version: 3, name: 'renamed' })]);
      expect(useProfileStore.getState().connectionProfiles.p1?.version).toBe(4);
      expect(field(/Profile name/)).toHaveValue('renamed');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does nothing when the confirmation is declined', async () => {
      confirmMock.mockResolvedValue(false);
      const user = await open({ mode: 'editProfile', connectionProfile: profile() });

      await user.click(button('Update profile'));

      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('does nothing when there is no profile to update', async () => {
      confirmMock.mockResolvedValue(true);
      const user = await open({ mode: 'editProfile' });

      await user.type(field(/Endpoint/), 'https://s3.example.com');
      await user.click(screen.getByRole('button', { name: /Region/ }));
      await user.click(await screen.findByText('Tokyo'));
      await user.type(field(/Access key/), 'AK');
      await user.click(button('Update profile'));

      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      await flush();
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('sends defaults for a profile without id or version and ignores a failed update', async () => {
      confirmMock.mockResolvedValue(true);
      const user = await open({
        mode: 'editProfile',
        connectionProfile: profile({ id: undefined as never, version: undefined }),
      });

      await user.click(button('Update profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock.mock.calls[0][1]).toEqual([expect.objectContaining({ id: '', version: 1 })]);
      await flush();
      expect(useProfileStore.getState().connectionProfiles).toEqual({});
    });

    it('ignores an update result without an id', async () => {
      confirmMock.mockResolvedValue(true);
      callIPCMock.mockResolvedValue({ name: 'no id' } as never);
      const user = await open({ mode: 'editProfile', connectionProfile: profile() });

      await user.click(button('Update profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      await flush();
      expect(useProfileStore.getState().connectionProfiles).toEqual({});
      expect(field(/Profile name/)).toHaveValue('my profile');
    });

    it('does not require the secret key to save the profile', async () => {
      confirmMock.mockResolvedValue(true);
      const user = await open({ mode: 'editProfile', connectionProfile: profile({ savedSecrets: [] }) });

      await user.click(button('Update profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Secret key is required')).not.toBeInTheDocument();
    });
  });

  describe('form behaviour', () => {
    it('switches path style on for MinIO and off again for AWS, locking it while MinIO is selected', async () => {
      const user = await open();
      // The form remounts an input when its value is set from code, so query it again every time.
      const pathStyle = () => screen.getByRole('checkbox', { name: 'Path style' });
      expect(pathStyle()).not.toBeChecked();
      expect(pathStyle()).toBeEnabled();

      await user.click(screen.getByText('MinIO'));
      await waitFor(() => expect(pathStyle()).toBeChecked());
      expect(pathStyle()).toBeDisabled();

      await user.click(screen.getByText('AWS'));
      await waitFor(() => expect(pathStyle()).not.toBeChecked());
      expect(pathStyle()).toBeEnabled();
    });

    it('enables auto connect only with a saved secret key, and clears it when saving is turned off', async () => {
      const user = await open();
      const save = () => screen.getByRole('checkbox', { name: 'Save secrets' });
      const auto = () => screen.getByRole('checkbox', { name: 'Auto connect' });
      expect(auto()).toBeDisabled();

      await user.click(save());
      // Saving is on but there is no secret key yet.
      expect(auto()).toBeDisabled();

      await user.type(field(/Secret key/), 'SK');
      await waitFor(() => expect(auto()).toBeEnabled());
      await user.click(auto());
      expect(auto()).toBeChecked();

      await user.click(save());
      await waitFor(() => expect(auto()).not.toBeChecked());
      expect(auto()).toBeDisabled();
    });

    it('resets the form fields from a refreshed profile with an empty provider', async () => {
      confirmMock.mockResolvedValue(true);
      callIPCMock.mockResolvedValue({ ...profile(), provider: '', pathStyle: true } as never);
      const user = await open({ mode: 'editProfile', connectionProfile: profile() });

      await user.click(button('Update profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      await flush();
      // An empty provider does not toggle the path style on its own.
      expect(screen.getByRole('checkbox', { name: 'Path style' })).toBeChecked();
    });

    it('closes from the close button', async () => {
      const user = await open();

      await user.click(screen.getByRole('button', { name: 'Close' }));

      await isClosed();
    });
  });
});
