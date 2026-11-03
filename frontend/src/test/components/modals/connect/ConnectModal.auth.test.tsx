import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ChooseAuthFile,
  ConnectS3,
  ListAwsProfiles,
  LoginMinioOidc,
} from '@wails/S3Browser/internal/handlers/buckethandler';
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

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  ChooseAuthFile: vi.fn(),
  ConnectS3: vi.fn(),
  ListAwsProfiles: vi.fn(),
  LoginMinioOidc: vi.fn(),
}));
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
  callIPCMock.mockImplementation((async (binding: unknown, args: unknown) => {
    if (binding === ListAwsProfiles) return profiles;
    if (binding === ConnectS3) return { isConnected: true };
    if (binding === ChooseAuthFile) return `/${(args as string[])[0]}.pem`;
    if (binding === LoginMinioOidc) {
      return { sessionId: 'sess-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    }
    return null;
  }) as never);
}

async function open(props?: Props) {
  renderWithProviders(<div />);
  act(() => {
    ConnectModal.show(props);
  });
  await flush();
  return userEvent.setup({ pointerEventsCheck: 0 });
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

const connectCalls = () => callIPCMock.mock.calls.filter(c => c[0] === ConnectS3);

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
    it('offers the six AWS methods and describes the selected one', async () => {
      const user = await open();
      expect(screen.getByText('Access key and secret key, with an optional session token.')).toBeInTheDocument();

      await user.click(field('Authentication method'));

      await screen.findAllByRole('option', { hidden: true });
      expect(authOptions()).toEqual([
        'Access key',
        'AWS CLI profile',
        'Assume role',
        'AWS SSO',
        'Default chain',
        'Anonymous',
      ]);
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
      expect(authOptions()).toEqual(['Access key', 'Anonymous', 'MinIO STS', 'LDAP', 'OIDC', 'Client certificate']);
    });

    it('requires the endpoint for MinIO', async () => {
      const user = await open();
      await user.click(screen.getByText('MinIO'));
      await waitFor(() => expect(checkbox('Path style')).toBeChecked());

      await user.click(button('Connect'));

      expect(await screen.findByText('Endpoint is required')).toBeInTheDocument();
      expect(connectCalls()).toHaveLength(0);
    });

    it('clears the errors of the previous provider when the provider changes', async () => {
      const user = await open();
      await user.click(screen.getByText('MinIO'));
      await waitFor(() => expect(checkbox('Path style')).toBeChecked());
      await user.click(button('Connect'));
      expect(await screen.findByText('Endpoint is required')).toBeInTheDocument();

      await user.click(screen.getByText('AWS'));

      await waitFor(() => expect(screen.queryByText('Endpoint is required')).not.toBeInTheDocument());
    });
  });

  describe('layout', () => {
    it('keeps the header and footer outside the scrolling body', async () => {
      await open();

      const body = field('Authentication method').closest<HTMLElement>('[style*="overflow"]');
      expect(body).toHaveStyle({ overflow: 'auto' });
      expect(body?.style.height).toContain('100dvh');
      expect(body).not.toContainElement(screen.getByRole('button', { name: 'Close' }));
      expect(body).not.toContainElement(button('Connect'));
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

      await waitFor(() =>
        expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything(), { signal: expect.any(AbortSignal) })
      );
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

      await waitFor(() =>
        expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything(), { signal: expect.any(AbortSignal) })
      );
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

      await waitFor(() =>
        expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything(), { signal: expect.any(AbortSignal) })
      );
      expect(lastConnectInput()[0]).toMatchObject({ authType: 'defaultChain', authConfig: {}, accessKey: '' });
    });

    it('static sends the session token', async () => {
      const user = await open();
      await chooseRegion(user);
      type(/Access key/, 'AK');
      type(/Secret key/, 'SK');
      type(/Session token/, ' tok ');

      await user.click(button('Connect'));

      await waitFor(() =>
        expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything(), { signal: expect.any(AbortSignal) })
      );
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
      expect(connectCalls()).toHaveLength(0);

      type(/Role ARN/, ROLE_ARN);
      await user.clear(field(/Duration/));
      await user.type(field(/Duration/), '1800');
      type(/MFA code/, '123456');
      await user.click(button('Connect'));

      await waitFor(() =>
        expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything(), { signal: expect.any(AbortSignal) })
      );
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

      await waitFor(() =>
        expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything(), { signal: expect.any(AbortSignal) })
      );
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
    it('clears the errors of the previous method', async () => {
      const user = await open();
      await chooseAuth(user, 'AWS CLI profile');
      await user.click(button('Connect'));
      expect(await screen.findByText('AWS CLI profile is required')).toBeInTheDocument();

      await chooseAuth(user, 'Default chain');

      await waitFor(() => expect(screen.queryByText('AWS CLI profile is required')).not.toBeInTheDocument());
    });

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

    it.each(['AWS CLI profile', 'AWS SSO', 'Default chain', 'Anonymous'])(
      'is enabled for %s without ticking Save secrets, since it stores no secret',
      async method => {
        const user = await open();
        await chooseAuth(user, method);

        expect(checkbox('Save secrets')).not.toBeChecked();
        await waitFor(() => expect(auto()).toBeEnabled());
      }
    );

    it('is enabled for an assume role from an AWS CLI profile without MFA, without ticking Save secrets', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      await user.click(screen.getByRole('radio', { name: 'AWS CLI profile' }));

      await waitFor(() => expect(auto()).toBeEnabled());
    });

    it('stays locked for an assume role from an AWS CLI profile with MFA, even with Save secrets', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      await user.click(screen.getByRole('radio', { name: 'AWS CLI profile' }));
      await user.click(checkbox('Save secrets'));
      type(/MFA device serial/, 'arn:aws:iam::123456789012:mfa/me');

      await waitFor(() => expect(auto()).toBeDisabled());
    });

    it('needs Save secrets for the access key method, then also the secret key', async () => {
      const user = await open();
      type(/Secret key/, 'SK');
      expect(auto()).toBeDisabled();

      await user.click(checkbox('Save secrets'));

      await waitFor(() => expect(auto()).toBeEnabled());
    });

    it('needs Save secrets for an assume role with access keys', async () => {
      const user = await open();
      await chooseAuth(user, 'Assume role');
      type(/Secret key/, 'SK');
      expect(auto()).toBeDisabled();

      await user.click(checkbox('Save secrets'));

      await waitFor(() => expect(auto()).toBeEnabled());
    });

    it.each(['MinIO STS', 'LDAP'])('needs Save secrets for MinIO %s', async method => {
      const user = await open();
      await user.click(screen.getByText('MinIO'));
      await waitFor(() => expect(checkbox('Path style')).toBeChecked());
      await chooseAuth(user, method);
      type(method === 'LDAP' ? /LDAP password/ : /Secret key/, 'secret');
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

describe('ConnectModal anonymous, MinIO STS and LDAP', () => {
  const POLICY = '{"Version":"2012-10-17"}';

  beforeEach(() => {
    useModalStackStore.getState().reset();
    useProfileStore.setState({ connectionProfiles: {} });
    useMasterDataStore.setState({
      regionData: { '01': [{ name: 'Tokyo', value1: 'ap-northeast-1', sortOrder: 1 } as never] },
    });
    mockBackend();
  });

  /** Switches to MinIO with an endpoint and region, then to the given method. */
  async function setupMinio(user: User, method: string) {
    await user.click(screen.getByText('MinIO'));
    await waitFor(() => expect(checkbox('Path style')).toBeChecked());
    type(/Endpoint/, 'http://minio:9000');
    await chooseRegion(user);
    await chooseAuth(user, method);
  }

  const connected = () =>
    waitFor(() =>
      expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything(), { signal: expect.any(AbortSignal) })
    );

  describe('anonymous', () => {
    it('shows only the bucket list, without any credential field', async () => {
      const user = await open();

      await chooseAuth(user, 'Anonymous');

      expect(screen.getByText('Access public buckets without credentials.')).toBeInTheDocument();
      expect(field(/Buckets/)).toBeInTheDocument();
      expect(queryField(/Access key/)).not.toBeInTheDocument();
      expect(queryField(/Secret key/)).not.toBeInTheDocument();
    });

    it('requires at least one bucket', async () => {
      const user = await open();
      await chooseAuth(user, 'Anonymous');
      await chooseRegion(user);

      await user.click(button('Connect'));

      expect(await screen.findByText('Buckets is required')).toBeInTheDocument();
      expect(connectCalls()).toHaveLength(0);
    });

    it('sends the typed buckets once each, with no keys', async () => {
      const user = await open();
      await chooseAuth(user, 'Anonymous');
      await chooseRegion(user);
      await user.type(field(/Buckets/), 'one,two three{Enter}one{Enter}');

      await user.click(button('Connect'));

      await connected();
      expect(lastConnectInput()[0]).toMatchObject({
        authType: 'anonymous',
        authConfig: { buckets: ['one', 'two', 'three'] },
        accessKey: '',
        secretKey: '',
        authSecret: {},
      });
    });

    it('forgets the buckets when the method changes', async () => {
      const user = await open();
      await chooseAuth(user, 'Anonymous');
      await user.type(field(/Buckets/), 'one{Enter}');
      expect(screen.getByText('one')).toBeInTheDocument();

      await chooseAuth(user, 'Access key');
      await chooseAuth(user, 'Anonymous');

      expect(screen.queryByText('one')).not.toBeInTheDocument();
    });
  });

  describe('minioAssumeRole', () => {
    it('shows the keys, an optional duration and the policy, but no session token', async () => {
      const user = await open();
      await setupMinio(user, 'MinIO STS');

      expect(field(/Access key/)).toBeInTheDocument();
      expect(field(/Secret key/)).toBeInTheDocument();
      expect(queryField(/Session token/)).not.toBeInTheDocument();
      expect(field(/Duration/)).toHaveValue('');
      expect(screen.getByLabelText(/Inline policy/)).toBeInTheDocument();
    });

    it('rejects a policy that is not JSON', async () => {
      const user = await open();
      await setupMinio(user, 'MinIO STS');
      type(/Access key/, 'AK');
      type(/Secret key/, 'SK');
      fireEvent.change(screen.getByLabelText(/Inline policy/), { target: { value: '{nope' } });

      await user.click(button('Connect'));

      expect(await screen.findByText('Inline policy (JSON, optional) is not valid')).toBeInTheDocument();
      expect(connectCalls()).toHaveLength(0);
    });

    it('sends the policy and omits the empty duration', async () => {
      const user = await open();
      await setupMinio(user, 'MinIO STS');
      type(/Access key/, 'AK');
      type(/Secret key/, 'SK');
      fireEvent.change(screen.getByLabelText(/Inline policy/), { target: { value: POLICY } });

      await user.click(button('Connect'));

      await connected();
      const [input, isTest, isExisting] = lastConnectInput();
      expect(input).toMatchObject({
        authType: 'minioAssumeRole',
        accessKey: 'AK',
        secretKey: 'SK',
        authConfig: { policy: POLICY },
        authSecret: {},
      });
      expect(input.authConfig).not.toHaveProperty('durationSeconds');
      expect([isTest, isExisting]).toEqual([false, false]);
    });
  });

  describe('minioLdap', () => {
    it('shows the user, the password and an optional duration, without keys', async () => {
      const user = await open();
      await setupMinio(user, 'LDAP');

      expect(field(/LDAP username/)).toBeInTheDocument();
      expect(field(/LDAP password/)).toHaveAttribute('type', 'password');
      expect(field(/Duration/)).toHaveValue('');
      expect(queryField(/Access key/)).not.toBeInTheDocument();
    });

    it('requires the user and the password to connect', async () => {
      const user = await open();
      await setupMinio(user, 'LDAP');

      await user.click(button('Connect'));

      expect(await screen.findByText('LDAP username is required')).toBeInTheDocument();
      expect(screen.getByText('LDAP password is required')).toBeInTheDocument();
      expect(connectCalls()).toHaveLength(0);
    });

    it('sends the user, the password and a typed duration', async () => {
      const user = await open();
      await setupMinio(user, 'LDAP');
      type(/LDAP username/, ' bob ');
      type(/LDAP password/, 'pw');
      await user.type(field(/Duration/), '1800');

      await user.click(button('Connect'));

      await connected();
      expect(lastConnectInput()[0]).toMatchObject({
        authType: 'minioLdap',
        accessKey: '',
        secretKey: '',
        authConfig: { ldapUsername: 'bob', durationSeconds: 1800 },
        authSecret: { ldapPassword: 'pw' },
      });
    });

    it('does not need the password to save a profile', async () => {
      const user = await open({ mode: 'createProfile' });
      callIPCMock.mockResolvedValue({ id: 'new-1' } as never);
      await setupMinio(user, 'LDAP');
      type(/LDAP username/, 'bob');

      await user.click(button('Create profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock.mock.calls[0][1]).toEqual([
        expect.objectContaining({ authType: 'minioLdap', authSecret: { ldapPassword: '' } }),
      ]);
    });

    it('marks the saved password when editing and keeps it on an empty field', async () => {
      await open({
        mode: 'editProfile',
        connectionProfile: profile({
          provider: 'minio',
          endpoint: 'http://minio:9000',
          accessKey: '',
          authType: 'minioLdap',
          authConfig: { ldapUsername: 'bob' } as never,
          savedSecrets: ['ldapPassword'],
        }),
      });

      expect(field(/LDAP username/)).toHaveValue('bob');
      expect(field(/LDAP password/)).toHaveAttribute('placeholder', SAVED);
      expect(field(/LDAP password/)).toHaveValue('');
    });

    it('can auto connect only once the password is typed or saved', async () => {
      const user = await open();
      await setupMinio(user, 'LDAP');
      await user.click(checkbox('Save secrets'));
      expect(checkbox('Auto connect')).toBeDisabled();

      type(/LDAP password/, 'pw');

      await waitFor(() => expect(checkbox('Auto connect')).toBeEnabled());
    });

    it('keeps auto connect when the password is already saved', async () => {
      await open({
        mode: 'editProfile',
        connectionProfile: profile({
          provider: 'minio',
          accessKey: '',
          authType: 'minioLdap',
          autoConnect: true,
          savedSecrets: ['ldapPassword'],
        }),
      });

      expect(checkbox('Auto connect')).toBeChecked();
      expect(checkbox('Auto connect')).toBeEnabled();
    });
  });

  describe('lifetime', () => {
    it('cancels a connect that is still running when the modal is unmounted', async () => {
      let signal: AbortSignal | undefined;
      callIPCMock.mockImplementation((async (_binding: unknown, _args: unknown, options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        return new Promise(() => {});
      }) as never);
      const { unmount } = renderWithProviders(<div />);
      act(() => {
        ConnectModal.show();
      });
      await flush();
      const user = userEvent.setup();
      await chooseAuth(user, 'Default chain');
      await chooseRegion(user);

      await user.click(button('Connect'));
      await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
      expect(signal?.aborted).toBe(false);

      unmount();

      expect(signal?.aborted).toBe(true);
    });
  });
});

describe('ConnectModal OIDC, client certificate and CA file', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    useProfileStore.setState({ connectionProfiles: {} });
    useMasterDataStore.setState({
      regionData: { '01': [{ name: 'Tokyo', value1: 'ap-northeast-1', sortOrder: 1 } as never] },
    });
    mockBackend();
  });

  /** Switches to MinIO with an endpoint and region, then to the given method. */
  async function setupMinio(user: User, method: string) {
    await user.click(screen.getByText('MinIO'));
    await waitFor(() => expect(checkbox('Path style')).toBeChecked());
    type(/Endpoint/, 'http://minio:9000');
    await chooseRegion(user);
    await chooseAuth(user, method);
  }

  const connected = () =>
    waitFor(() =>
      expect(callIPCMock).toHaveBeenCalledWith(ConnectS3, expect.anything(), { signal: expect.any(AbortSignal) })
    );

  const fillOidc = () => {
    type(/Client ID/, 'cid');
    type(/Issuer URL/, 'https://idp.example.com');
  };

  describe('minioOidc', () => {
    it('shows the provider settings and the sign-in, without keys', async () => {
      const user = await open();
      await setupMinio(user, 'OIDC');

      expect(field(/Client ID/)).toBeInTheDocument();
      expect(field(/Issuer URL/)).toBeInTheDocument();
      expect(field(/Callback port/)).toHaveValue('48765');
      expect(screen.getByText('Not signed in')).toBeInTheDocument();
      expect(queryField(/Access key/)).not.toBeInTheDocument();
    });

    it('requires the settings and the sign-in to connect', async () => {
      const user = await open();
      await setupMinio(user, 'OIDC');

      await user.click(button('Connect'));

      expect(await screen.findByText('Client ID is required')).toBeInTheDocument();
      expect(screen.getByText('Issuer URL is required')).toBeInTheDocument();
      expect(screen.getByText('Sign-in is required')).toBeInTheDocument();
      expect(connectCalls()).toHaveLength(0);
    });

    it('rejects an issuer that is not an http(s) URL', async () => {
      const user = await open();
      await setupMinio(user, 'OIDC');
      fillOidc();
      type(/Issuer URL/, 'idp.example.com');

      await user.click(button('Connect'));

      expect(await screen.findByText('Issuer URL is not valid')).toBeInTheDocument();
    });

    it('signs in, then connects with the session id', async () => {
      const user = await open();
      await setupMinio(user, 'OIDC');
      fillOidc();

      await user.click(button('Sign in'));
      expect(await screen.findByText(/Signed in, valid until/)).toBeInTheDocument();
      await user.click(button('Connect'));

      await connected();
      expect(lastConnectInput()[0]).toMatchObject({
        authType: 'minioOidc',
        accessKey: '',
        secretKey: '',
        oidcSessionId: 'sess-1',
        authConfig: { clientId: 'cid', issuerUrl: 'https://idp.example.com', callbackPort: 48765 },
      });
    });

    it('asks to sign in again after the method was left and chosen again', async () => {
      const user = await open();
      await setupMinio(user, 'OIDC');
      fillOidc();
      await user.click(button('Sign in'));
      await screen.findByText(/Signed in, valid until/);

      await chooseAuth(user, 'Client certificate');
      await chooseAuth(user, 'OIDC');
      fillOidc();
      await user.click(button('Connect'));

      expect(await screen.findByText('Sign-in is required')).toBeInTheDocument();
      expect(screen.getByText('Not signed in')).toBeInTheDocument();
      expect(connectCalls()).toHaveLength(0);
    });

    it('saves a profile without the sign-in and without sending a session id', async () => {
      const user = await open({ mode: 'createProfile' });
      callIPCMock.mockResolvedValue({ id: 'new-1' } as never);
      await setupMinio(user, 'OIDC');
      fillOidc();

      await user.click(button('Create profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock.mock.calls[0][1]).toEqual([
        expect.objectContaining({ authType: 'minioOidc', oidcSessionId: '' }),
      ]);
    });

    it('cannot auto connect, with an explanation', async () => {
      const user = await open();
      await setupMinio(user, 'OIDC');
      await user.click(checkbox('Save secrets'));

      expect(checkbox('Auto connect')).toBeDisabled();
      await user.hover(checkbox('Auto connect').closest('div')!);
      expect(
        await screen.findByText('This authentication method needs input on every connect, so it cannot auto connect.')
      ).toBeInTheDocument();
    });
  });

  describe('minioCert', () => {
    const chooseFiles = async (user: User) => {
      const [cert, key] = screen.getAllByRole('button', { name: 'Choose file...' });
      await user.click(cert);
      await waitFor(() => expect(field(/Client certificate file/)).toHaveValue('/cert.pem'));
      await user.click(key);
      await waitFor(() => expect(field(/Private key file/)).toHaveValue('/key.pem'));
    };

    it('requires the certificate and the key files', async () => {
      const user = await open();
      await setupMinio(user, 'Client certificate');

      await user.click(button('Connect'));

      expect(await screen.findByText('Client certificate file is required')).toBeInTheDocument();
      expect(screen.getByText('Private key file is required')).toBeInTheDocument();
      expect(connectCalls()).toHaveLength(0);
    });

    it('connects with the chosen files and no key password', async () => {
      const user = await open();
      await setupMinio(user, 'Client certificate');
      await chooseFiles(user);

      await user.click(button('Connect'));

      await connected();
      expect(lastConnectInput()[0]).toMatchObject({
        authType: 'minioCert',
        accessKey: '',
        secretKey: '',
        authConfig: { certFile: '/cert.pem', keyFile: '/key.pem' },
        authSecret: { keyPassword: '' },
      });
    });

    it('asks for the key password when the key has one, and sends it', async () => {
      const user = await open();
      await setupMinio(user, 'Client certificate');
      await chooseFiles(user);
      await user.click(screen.getByRole('checkbox', { name: 'The private key has a password' }));

      await user.click(button('Connect'));
      expect(await screen.findByText('Private key password is required')).toBeInTheDocument();
      expect(connectCalls()).toHaveLength(0);

      type(/Private key password/, ' kp ');
      await user.click(button('Connect'));

      await connected();
      expect(lastConnectInput()[0]).toMatchObject({
        authConfig: { keyEncrypted: true },
        authSecret: { keyPassword: ' kp ' },
      });
    });

    it('does not need the key password to save a profile', async () => {
      const user = await open({ mode: 'createProfile' });
      await setupMinio(user, 'Client certificate');
      await chooseFiles(user);
      callIPCMock.mockResolvedValue({ id: 'new-1' } as never);
      await user.click(screen.getByRole('checkbox', { name: 'The private key has a password' }));

      await user.click(button('Create profile'));

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(3));
      expect(callIPCMock.mock.calls[2][1]).toEqual([
        expect.objectContaining({ authType: 'minioCert', authSecret: { keyPassword: '' } }),
      ]);
    });

    it('forgets the typed key password when the method changes', async () => {
      const user = await open();
      await setupMinio(user, 'Client certificate');
      await user.click(screen.getByRole('checkbox', { name: 'The private key has a password' }));
      type(/Private key password/, 'kp');

      await chooseAuth(user, 'LDAP');
      await chooseAuth(user, 'Client certificate');
      await user.click(screen.getByRole('checkbox', { name: 'The private key has a password' }));

      expect(field(/Private key password/)).toHaveValue('');
    });

    it('marks the saved key password when editing', async () => {
      await open({
        mode: 'editProfile',
        connectionProfile: profile({
          provider: 'minio',
          accessKey: '',
          authType: 'minioCert',
          authConfig: { certFile: '/c.pem', keyFile: '/k.pem', keyEncrypted: true } as never,
          savedSecrets: ['keyPassword'],
        }),
      });

      expect(field(/Client certificate file/)).toHaveValue('/c.pem');
      expect(field(/Private key password/)).toHaveAttribute('placeholder', SAVED);
    });

    it('can auto connect with an unencrypted key, and needs the saved password otherwise', async () => {
      const user = await open();
      await setupMinio(user, 'Client certificate');
      await user.click(checkbox('Save secrets'));
      await waitFor(() => expect(checkbox('Auto connect')).toBeEnabled());

      await user.click(screen.getByRole('checkbox', { name: 'The private key has a password' }));
      await waitFor(() => expect(checkbox('Auto connect')).toBeDisabled());

      type(/Private key password/, 'kp');
      await waitFor(() => expect(checkbox('Auto connect')).toBeEnabled());
    });
  });

  describe('CA file', () => {
    it.each(['Access key', 'Anonymous', 'MinIO STS', 'LDAP', 'OIDC', 'Client certificate'])(
      'is offered on MinIO with %s',
      async method => {
        const user = await open();
        await setupMinio(user, method);

        expect(field(/CA certificate file/)).toBeInTheDocument();
      }
    );

    it('is hidden on AWS', async () => {
      await open();

      expect(queryField(/CA certificate file/)).not.toBeInTheDocument();
    });

    it('is sent with the connection and kept when the method changes', async () => {
      const user = await open();
      await setupMinio(user, 'Client certificate');
      await user.click(screen.getAllByRole('button', { name: 'Choose file...' }).at(-1)!);
      await waitFor(() => expect(field(/CA certificate file/)).toHaveValue('/ca.pem'));

      await chooseAuth(user, 'Anonymous');
      expect(field(/CA certificate file/)).toHaveValue('/ca.pem');
      await user.type(field(/Buckets/), 'b1{enter}');
      await user.click(button('Connect'));

      await connected();
      expect(lastConnectInput()[0]).toMatchObject({ authConfig: { caFile: '/ca.pem', buckets: ['b1'] } });
    });

    it('is emptied by the clear button', async () => {
      const user = await open();
      await setupMinio(user, 'LDAP');
      await user.click(screen.getByRole('button', { name: 'Choose file...' }));
      await waitFor(() => expect(field(/CA certificate file/)).toHaveValue('/ca.pem'));

      await user.click(screen.getByRole('button', { name: 'Clear file' }));

      await waitFor(() => expect(field(/CA certificate file/)).toHaveValue(''));
    });

    it('is not sent to AWS', async () => {
      const user = await open();
      await chooseAuth(user, 'Default chain');
      await chooseRegion(user);

      await user.click(button('Connect'));

      await connected();
      expect(lastConnectInput()[0].authConfig).not.toHaveProperty('caFile');
    });
  });
});
