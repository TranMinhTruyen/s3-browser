import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectS3, ListAwsProfiles } from '@wails/S3Browser/internal/handlers/buckethandler';
import { UpdateProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import type { ConnectionProfileOutput } from '@wails/S3Browser/models';
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

const ROLE_ARN = 'arn:aws:iam::123456789012:role/Admin';
const SAVED = 'Saved, leave empty to keep';

const profile = (extra: Partial<ConnectionProfileOutput> = {}) =>
  ({
    id: 'p1',
    name: 'my profile',
    provider: 'aws',
    region: 'ap-northeast-1',
    accessKey: 'AK',
    savedSecrets: ['secretKey'],
    version: 3,
    autoConnect: false,
    pathStyle: false,
    ...extra,
  }) as ConnectionProfileOutput;

type Props = Parameters<typeof ConnectModal.show>[0];
type User = ReturnType<typeof userEvent.setup>;

/** Backend results by binding; the connect call succeeds. */
function mockBackend(profiles: unknown[] = []) {
  callIPCMock.mockImplementation((async (binding: unknown) => {
    if (binding === ListAwsProfiles) return profiles;
    if (binding === ConnectS3) return { isConnected: true };
    return null;
  }) as never);
}

async function open(props?: Props) {
  renderWithProviders(<div />);
  act(() => {
    ConnectModal.show(props);
  });
  await flush();
  return userEvent.setup();
}

const field = (name: RegExp | string) => screen.getByLabelText(name, { selector: 'input:not([type=radio])' });
const queryField = (name: RegExp | string) => screen.queryByLabelText(name, { selector: 'input:not([type=radio])' });
const button = (name: string) => screen.getByRole('button', { name });
const checkbox = (name: string) => screen.getByRole('checkbox', { name });
const type = (name: RegExp | string, value: string) => fireEvent.change(field(name), { target: { value } });

async function chooseAuth(user: User, label: RegExp | string) {
  await user.click(field('Authentication method'));
  await user.click(await screen.findByRole('option', { name: label, hidden: true }));
}

async function chooseProfile(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: /AWS CLI profile/ }));
  await user.click(await screen.findByText(name));
}

async function chooseRegion(user: User) {
  await user.click(screen.getByRole('button', { name: /Region/ }));
  await user.click(await screen.findByText('Tokyo'));
}

/** Options of the authentication method Select (the region list also has hidden options). */
const authOptions = () => {
  const listbox = document.getElementById(field('Authentication method').getAttribute('aria-controls')!)!;
  return within(listbox)
    .getAllByRole('option', { hidden: true })
    .map(o => o.textContent);
};

const lastConnectInput = () => {
  const call = callIPCMock.mock.calls.find(c => c[0] === ConnectS3)!;
  return call[1] as unknown as [Record<string, unknown>, boolean, boolean];
};

describe('ConnectModal authentication methods', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    useProfileStore.setState({ connectionProfiles: {} });
    useMasterDataStore.setState({
      regionData: { '01': [{ name: 'Tokyo', value1: 'ap-northeast-1', sortOrder: 1 } as never] },
    });
    mockBackend([
      { name: 'dev', isSso: false },
      { name: 'corp', isSso: true },
    ]);
  });

  describe('fields of each method', () => {
    it('offers the five AWS methods and describes the selected one', async () => {
      const user = await open();
      expect(screen.getByText('Access key and secret key, with an optional session token.')).toBeInTheDocument();

      await user.click(field('Authentication method'));

      await screen.findAllByRole('option', { hidden: true });
      expect(authOptions()).toEqual(['Access key', 'AWS CLI profile', 'Assume role', 'AWS SSO', 'Default chain']);
    });

    it('static shows the keys and the session token', async () => {
      await open();

      expect(field(/Access key/)).toBeInTheDocument();
      expect(field(/Secret key/)).toBeInTheDocument();
      expect(field(/Session token/)).toBeInTheDocument();
    });

    it('sharedProfile shows the profile picker and both custom files, but no keys', async () => {
      const user = await open();

      await chooseAuth(user, 'AWS CLI profile');

      expect(screen.getByRole('button', { name: /AWS CLI profile/ })).toBeInTheDocument();
      expect(field(/AWS config file/)).toBeInTheDocument();
      expect(field(/AWS credentials file/)).toBeInTheDocument();
      expect(queryField(/Secret key/)).not.toBeInTheDocument();
      expect(screen.queryByText(/aws sso login/)).not.toBeInTheDocument();
    });

    it('sso lists only SSO profiles, shows the login hint and hides the credentials file', async () => {
      const user = await open();
      await chooseAuth(user, 'AWS SSO');

      expect(screen.getByText('Sign in first with: aws sso login --profile <profile>')).toBeInTheDocument();
      expect(queryField(/AWS credentials file/)).not.toBeInTheDocument();
      expect(field(/AWS config file/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /AWS CLI profile/ }));
      expect(await screen.findByRole('option', { name: 'corp', hidden: true })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'dev', hidden: true })).not.toBeInTheDocument();

      await user.click(screen.getByText('corp'));
      expect(await screen.findByText('Sign in first with: aws sso login --profile corp')).toBeInTheDocument();
    });

    it('defaultChain shows no credential field', async () => {
      const user = await open();

      await chooseAuth(user, 'Default chain');

      expect(queryField(/Access key/)).not.toBeInTheDocument();
      expect(queryField(/Secret key/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /AWS CLI profile/ })).not.toBeInTheDocument();
    });

    it('assumeRole shows the role fields with access keys, no session token and no MFA code yet', async () => {
      const user = await open();

      await chooseAuth(user, 'Assume role');

      expect(field(/Role ARN/)).toBeInTheDocument();
      expect(field(/External ID/)).toBeInTheDocument();
      expect(field(/Session name/)).toBeInTheDocument();
      expect(field(/Duration/)).toHaveValue('3600');
      expect(field(/MFA device serial/)).toBeInTheDocument();
      expect(field(/Access key/)).toBeInTheDocument();
      expect(field(/Secret key/)).toBeInTheDocument();
      expect(queryField(/Session token/)).not.toBeInTheDocument();
      expect(queryField(/MFA code/)).not.toBeInTheDocument();
    });

    it('assumeRole swaps the keys for the profile picker, and the MFA code appears with a device', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');

      await user.click(screen.getByRole('radio', { name: 'AWS CLI profile' }));

      expect(await screen.findByRole('button', { name: /AWS CLI profile/ })).toBeInTheDocument();
      expect(queryField(/Access key/)).not.toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: 'Access key' }));
      expect(await screen.findByLabelText(/Access key/, { selector: 'input:not([type=radio])' })).toBeInTheDocument();

      type(/MFA device serial/, 'arn:aws:iam::123456789012:mfa/me');
      expect(await screen.findByLabelText(/MFA code/, { selector: 'input:not([type=radio])' })).toBeInTheDocument();
    });
  });

  describe('provider', () => {
    it('falls back to the access key method when MinIO does not support the selected one', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      expect(field(/Role ARN/)).toBeInTheDocument();

      await user.click(screen.getByText('MinIO'));

      await waitFor(() => expect(queryField(/Role ARN/)).not.toBeInTheDocument());
      expect(field(/Access key/)).toBeInTheDocument();
      expect(field('Authentication method')).toHaveValue('Access key');
      await waitFor(() => expect(checkbox('Path style')).toBeChecked());
    });

    it('keeps the selected method when MinIO supports it', async () => {
      const user = await open();

      await user.click(screen.getByText('MinIO'));
      await waitFor(() => expect(checkbox('Path style')).toBeChecked());

      expect(field('Authentication method')).toHaveValue('Access key');
      await user.click(field('Authentication method'));
      await screen.findAllByRole('option', { hidden: true });
      expect(authOptions()).toEqual(['Access key']);
    });

    it('requires the endpoint for MinIO', async () => {
      const user = await open();
      await user.click(screen.getByText('MinIO'));
      await waitFor(() => expect(checkbox('Path style')).toBeChecked());

      await user.click(button('Connect'));

      expect(await screen.findByText('Endpoint is required')).toBeInTheDocument();
      expect(callIPCMock).not.toHaveBeenCalledWith(ConnectS3, expect.anything());
    });
  });

  describe('region', () => {
    it('is cleared to an empty value, which is reported as missing', async () => {
      const user = await open();
      await chooseRegion(user);
      expect(screen.getByRole('button', { name: /Region/ })).toHaveTextContent('Tokyo');

      await user.click(screen.getByRole('button', { name: 'Clear' }));
      await user.click(button('Connect'));

      expect(await screen.findByText('Region is required')).toBeInTheDocument();
    });

    it('is optional for an AWS CLI profile', async () => {
      const user = await open();
      await chooseAuth(user, 'AWS CLI profile');
      await chooseProfile(user, 'dev');

      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything()));
      expect(screen.queryByText('Region is required')).not.toBeInTheDocument();
    });
  });

  describe('connecting with each method', () => {
    it('sharedProfile sends the profile name and files, without keys', async () => {
      const user = await open();
      await chooseAuth(user, 'AWS CLI profile');
      await chooseProfile(user, 'dev');
      type(/AWS config file/, ' /home/me/config ');

      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything()));
      expect(lastConnectInput()[0]).toMatchObject({
        authType: 'sharedProfile',
        authConfig: { profileName: 'dev', configFile: '/home/me/config' },
        accessKey: '',
        secretKey: '',
        authSecret: {},
        mfaCode: '',
      });
    });

    it('sharedProfile asks for the profile', async () => {
      const user = await open();
      await chooseAuth(user, 'AWS CLI profile');

      await user.click(button('Connect'));

      expect(await screen.findByText('AWS CLI profile is required')).toBeInTheDocument();
    });

    it('defaultChain connects with nothing but the common fields', async () => {
      const user = await open();
      await chooseAuth(user, 'Default chain');

      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything()));
      expect(lastConnectInput()[0]).toMatchObject({ authType: 'defaultChain', authConfig: {}, accessKey: '' });
    });

    it('static sends the session token', async () => {
      const user = await open();
      await chooseRegion(user);
      type(/Access key/, 'AK');
      type(/Secret key/, 'SK');
      type(/Session token/, ' tok ');

      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything()));
      expect(lastConnectInput()[0]).toMatchObject({ authType: 'static', authSecret: { sessionToken: 'tok' } });
    });

    it('assumeRole validates the role, the duration and the MFA code, then sends the MFA code once', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      await chooseRegion(user);
      type(/Access key/, 'AK');
      type(/Secret key/, 'SK');
      type(/Role ARN/, 'nope');
      await user.clear(field(/Duration/));
      type(/MFA device serial/, 'arn:aws:iam::123456789012:mfa/me');

      await user.click(button('Connect'));

      expect(await screen.findByText('Role ARN is not valid')).toBeInTheDocument();
      // One pass shows every error, so the user does not have to press Connect twice.
      expect(screen.getByText('Duration (seconds) is required')).toBeInTheDocument();
      expect(screen.getByText('MFA code is required')).toBeInTheDocument();
      expect(callIPCMock).not.toHaveBeenCalledWith(ConnectS3, expect.anything());

      type(/Role ARN/, ROLE_ARN);
      await user.clear(field(/Duration/));
      await user.type(field(/Duration/), '1800');
      type(/MFA code/, '123456');
      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything()));
      expect(lastConnectInput()[0]).toMatchObject({
        authType: 'assumeRole',
        accessKey: 'AK',
        secretKey: 'SK',
        mfaCode: '123456',
        authConfig: {
          sourceType: 'static',
          roleArn: ROLE_ARN,
          durationSeconds: 1800,
          mfaSerial: 'arn:aws:iam::123456789012:mfa/me',
        },
      });
    });

    it('assumeRole clamps a duration outside 900-43200 when the field loses focus', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');

      await user.clear(field(/Duration/));
      await user.type(field(/Duration/), '100');
      await user.tab();

      expect(field(/Duration/)).toHaveValue('900');
    });

    it('assumeRole with an AWS CLI profile needs the profile and sends no keys', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      await chooseRegion(user);
      type(/Role ARN/, ROLE_ARN);
      await user.click(screen.getByRole('radio', { name: 'AWS CLI profile' }));
      await user.click(button('Connect'));
      expect(await screen.findByText('AWS CLI profile is required')).toBeInTheDocument();

      await chooseProfile(user, 'dev');
      await user.click(button('Connect'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything()));
      expect(lastConnectInput()[0]).toMatchObject({
        accessKey: '',
        secretKey: '',
        authConfig: { sourceType: 'profile', profileName: 'dev', roleArn: ROLE_ARN },
      });
    });
  });

  describe('hint and profile saving', () => {
    const hint = /Saving does not need secrets, but Test connection does/;

    it.each(['createProfile', 'editProfile'] as const)('explains the test connection in %s mode', async mode => {
      await open({ mode, connectionProfile: profile() });

      expect(screen.getByText(hint)).toBeInTheDocument();
    });

    it.each(['connect', 'manualconnect'] as const)('does not show the hint in %s mode', async mode => {
      await open({ mode, connectionProfile: profile() });

      expect(screen.queryByText(hint)).not.toBeInTheDocument();
    });

    it('does not send the MFA code when creating a profile', async () => {
      const user = await open({ mode: 'createProfile' });
      callIPCMock.mockResolvedValue({ id: 'new-1' } as never);
      await chooseAuth(user, 'Assume role');
      await chooseRegion(user);
      type(/Access key/, 'AK');
      type(/Role ARN/, ROLE_ARN);
      type(/MFA device serial/, 'arn:aws:iam::123456789012:mfa/me');
      type(/MFA code/, '123456');

      await user.click(button('Create profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock.mock.calls[0][1]).toEqual([
        expect.objectContaining({ authType: 'assumeRole', mfaCode: '', accessKey: 'AK' }),
      ]);
    });
  });

  describe('changing the method', () => {
    it('resets the method fields and the MFA code', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      type(/Role ARN/, ROLE_ARN);
      type(/MFA device serial/, 'arn:aws:iam::123456789012:mfa/me');
      type(/MFA code/, '123456');

      await chooseAuth(user, 'AWS CLI profile');
      await chooseAuth(user, 'Assume role');

      expect(field(/Role ARN/)).toHaveValue('');
      expect(field(/MFA device serial/)).toHaveValue('');
      expect(queryField(/MFA code/)).not.toBeInTheDocument();
      expect(field(/Duration/)).toHaveValue('3600');
    });

    it('resets them too when the provider forces another method', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      type(/Role ARN/, ROLE_ARN);

      await user.click(screen.getByText('MinIO'));
      await waitFor(() => expect(queryField(/Role ARN/)).not.toBeInTheDocument());
      await user.click(screen.getByText('AWS'));
      await chooseAuth(user, 'Assume role');

      expect(field(/Role ARN/)).toHaveValue('');
    });

    it('keeps the saved config of a profile opened for editing', async () => {
      await open({
        mode: 'editProfile',
        connectionProfile: profile({ authType: 'sharedProfile', authConfig: { profileName: 'dev' } as never }),
      });

      expect(screen.getByRole('button', { name: /AWS CLI profile/ })).toHaveTextContent('dev');
    });

    it('keeps the saved config of a profile opened for a manual connect', async () => {
      await open({
        mode: 'manualconnect',
        connectionProfile: profile({ authType: 'assumeRole', authConfig: { roleArn: ROLE_ARN } as never }),
      });

      expect(field(/Role ARN/)).toHaveValue(ROLE_ARN);
    });

    it('keeps the config after a successful update of the same method', async () => {
      confirmMock.mockResolvedValue(true);
      const saved = profile({
        authType: 'assumeRole',
        authConfig: { sourceType: 'static', roleArn: ROLE_ARN, durationSeconds: 7200 } as never,
      });
      const user = await open({ mode: 'editProfile', connectionProfile: saved });
      callIPCMock.mockResolvedValue({ ...saved, name: 'renamed', version: 4 } as never);

      await user.click(button('Update profile'));

      await waitFor(() => expect(field(/Profile name/)).toHaveValue('renamed'));
      expect(field(/Role ARN/)).toHaveValue(ROLE_ARN);
      expect(field(/Duration/)).toHaveValue('7200');
    });
  });

  describe('saved secrets', () => {
    it('shows the saved placeholder only when editing a profile of the same method', async () => {
      const user = await open({ mode: 'editProfile', connectionProfile: profile({ savedSecrets: ['secretKey'] }) });

      expect(field(/Secret key/)).toHaveAttribute('placeholder', SAVED);
      expect(field(/Session token/)).toHaveAttribute('placeholder', 'Session token (optional)');

      await chooseAuth(user, 'Assume role');
      expect(field(/Secret key/)).toHaveAttribute('placeholder', 'Secret key');

      await chooseAuth(user, 'Access key');
      expect(field(/Secret key/)).toHaveAttribute('placeholder', SAVED);
    });

    it('shows the saved placeholder of the session token', async () => {
      await open({ mode: 'editProfile', connectionProfile: profile({ savedSecrets: ['secretKey', 'sessionToken'] }) });

      expect(field(/Session token/)).toHaveAttribute('placeholder', SAVED);
    });

    it('treats a profile saved without authType as static and a missing savedSecrets as none', async () => {
      await open({ mode: 'editProfile', connectionProfile: profile({ savedSecrets: undefined }) });

      expect(field('Authentication method')).toHaveValue('Access key');
      expect(field(/Secret key/)).toHaveAttribute('placeholder', 'Secret key');
    });

    it.each(['connect', 'manualconnect', 'createProfile'] as const)('never shows it in %s mode', async mode => {
      await open({ mode, connectionProfile: profile() });

      expect(field(/Secret key/)).toHaveAttribute('placeholder', 'Secret key');
    });

    it('prefills an assume role profile from its saved config', async () => {
      await open({
        mode: 'editProfile',
        connectionProfile: profile({
          authType: 'assumeRole',
          authConfig: { sourceType: 'static', roleArn: ROLE_ARN, durationSeconds: 7200 } as never,
        }),
      });

      expect(field('Authentication method')).toHaveValue('Assume role');
      expect(field(/Role ARN/)).toHaveValue(ROLE_ARN);
      expect(field(/Duration/)).toHaveValue('7200');
      expect(field(/Secret key/)).toHaveAttribute('placeholder', SAVED);
    });

    it('refreshes the saved secrets and the form after an update', async () => {
      confirmMock.mockResolvedValue(true);
      const user = await open({ mode: 'editProfile', connectionProfile: profile({ savedSecrets: [] }) });
      expect(field(/Secret key/)).toHaveAttribute('placeholder', 'Secret key');
      callIPCMock.mockResolvedValue(profile({ name: 'saved now', savedSecrets: ['secretKey'], version: 4 }) as never);

      type(/Secret key/, 'SK');
      await user.click(button('Update profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledWith(UpdateProfileById, expect.anything()));
      await waitFor(() => expect(field(/Secret key/)).toHaveAttribute('placeholder', SAVED));
      expect(field(/Profile name/)).toHaveValue('saved now');
      expect(field(/Secret key/)).toHaveValue('');
      expect(useProfileStore.getState().connectionProfiles.p1?.version).toBe(4);
    });
  });

  describe('auto connect', () => {
    const auto = () => checkbox('Auto connect');

    it('is enabled for an AWS CLI profile as soon as secrets are saved, since it needs none', async () => {
      const user = await open();
      await chooseAuth(user, 'AWS CLI profile');
      expect(auto()).toBeDisabled();

      await user.click(checkbox('Save secrets'));

      await waitFor(() => expect(auto()).toBeEnabled());
    });

    it('is turned off and locked when the method changes to one that needs a secret not provided', async () => {
      const user = await open({
        mode: 'editProfile',
        connectionProfile: profile({ autoConnect: true, savedSecrets: ['secretKey'] }),
      });
      expect(auto()).toBeChecked();
      expect(auto()).toBeEnabled();

      await chooseAuth(user, 'Assume role');

      await waitFor(() => expect(auto()).not.toBeChecked());
      expect(auto()).toBeDisabled();
    });

    it('is locked with an explanation when the role is protected by MFA', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      await user.click(checkbox('Save secrets'));
      type(/Secret key/, 'SK');
      await waitFor(() => expect(auto()).toBeEnabled());

      type(/MFA device serial/, 'arn:aws:iam::123456789012:mfa/me');

      await waitFor(() => expect(auto()).toBeDisabled());
      await user.hover(screen.getByText('Auto connect'));
      expect(
        await screen.findByText('This authentication method needs input on every connect, so it cannot auto connect.')
      ).toBeInTheDocument();
    });

    it('does not explain anything while the method can auto connect', async () => {
      const user = await open();

      await user.hover(screen.getByText('Auto connect'));

      expect(screen.queryByText(/needs input on every connect/)).not.toBeInTheDocument();
    });

    it('assume role from an AWS CLI profile needs no secret to auto connect', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      await user.click(screen.getByRole('radio', { name: 'AWS CLI profile' }));
      await user.click(checkbox('Save secrets'));

      await waitFor(() => expect(auto()).toBeEnabled());
    });
  });
});
