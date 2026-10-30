import type { UseFormReturnType } from '@mantine/form';
import type { ConnectionProfileInput, ConnectionProfileOutput } from '@wails/S3Browser/models';
import z from 'zod';
import { getAuthType, getRequiredSecrets, needsMfa } from '@/common/utils/authUtils';
import { AUTH_TYPES, type AuthType, isRegionOptional } from '@/components/modals/connect/authMethods';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';

const DEFAULT_DURATION_SECONDS = 3600;
const MIN_DURATION_SECONDS = 900;
const MAX_DURATION_SECONDS = 43200;
const DURATION_ERROR = `V000003:${MIN_DURATION_SECONDS},${MAX_DURATION_SECONDS}`;
const ROLE_ARN_REGEX = /^arn:aws[\w-]*:iam::\d{12}:role\/\S+$/;

const text = z.string().trim();
const required = text.nonempty('V000001');

const authConfigSchema = z.object({
  profileName: text,
  configFile: text,
  credentialsFile: text,
  sourceType: z.enum(['static', 'profile']),
  roleArn: text,
  externalId: text,
  sessionName: text,
  // A NumberInput gives '' (or a partial string) while the user is typing.
  durationSeconds: z.union([z.number(), z.string()]),
  mfaSerial: text,
});

/** Fields every method shares; a method adds its own rules on top. */
const common = z.object({
  name: text,
  color: text,
  provider: text,
  endpoint: text,
  region: text,
  accessKey: text,
  secretKey: text,
  pathStyle: z.boolean(),
  savePassword: z.boolean(),
  autoConnect: z.boolean(),
  mfaCode: text,
  authConfig: authConfigSchema,
  authSecret: z.object({ sessionToken: text }),
});

const formSchema = common.extend({ authType: z.enum(AUTH_TYPES) });

/** Form values of the connect modal (all fields of all methods; the hidden ones are dropped on submit). */
export type ConnectionInfo = z.infer<typeof formSchema>;

/**
 * Schema per authentication method. `requireSecret` is true to connect/test (secrets and the MFA code are
 * mandatory) and false to only save a profile.
 */
export const buildConnectSchema = (requireSecret: boolean) => {
  const secret = requireSecret ? required : text;
  const withConfig = <T extends z.ZodRawShape>(shape: T) =>
    common.extend({ authConfig: authConfigSchema.extend(shape) });

  return z
    .discriminatedUnion('authType', [
      common.extend({ authType: z.literal('static'), accessKey: required, secretKey: secret }),
      withConfig({ profileName: required }).extend({ authType: z.literal('sharedProfile') }),
      withConfig({ profileName: required }).extend({ authType: z.literal('sso') }),
      withConfig({
        roleArn: text.nonempty('V000001').regex(ROLE_ARN_REGEX, 'V000004'),
      }).extend({ authType: z.literal('assumeRole') }),
      common.extend({ authType: z.literal('defaultChain') }),
    ])
    .superRefine((values, ctx) => {
      const addRequired = (path: (string | number)[]) => ctx.addIssue({ code: 'custom', message: 'V000001', path });

      if (values.provider === 'minio' && !values.endpoint) addRequired(['endpoint']);
      if (!values.region && !isRegionOptional(values.provider, values.authType)) addRequired(['region']);
      if (values.authType !== 'assumeRole') return;

      if (values.authConfig.sourceType === 'profile') {
        if (!values.authConfig.profileName) addRequired(['authConfig', 'profileName']);
      } else {
        if (!values.accessKey) addRequired(['accessKey']);
        if (requireSecret && !values.secretKey) addRequired(['secretKey']);
      }
      const duration = values.authConfig.durationSeconds;
      if (duration === '') addRequired(['authConfig', 'durationSeconds']);
      else if (typeof duration !== 'number' || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
        ctx.addIssue({ code: 'custom', message: DURATION_ERROR, path: ['authConfig', 'durationSeconds'] });
      }
      if (requireSecret && values.authConfig.mfaSerial && !values.mfaCode) addRequired(['mfaCode']);
    });
};

/** Schema used when only saving a profile (secrets are optional). */
export const profileSchema = buildConnectSchema(false);

/** Schema used when connecting or testing a connection (secrets and the MFA code are required). */
export const connectSchema = buildConnectSchema(true);

/** Props of `ConnectModal.show()`. `connectionProfile` is the profile to connect or edit; omit it for a new one. */
export type ConnectModalProps = {
  mode?: 'connect' | 'manualconnect' | 'createProfile' | 'editProfile';
  connectionProfile?: ConnectionProfileOutput;
};

/** Props shared by the per-method field components. */
export type AuthFieldsProps = {
  form: UseFormReturnType<ConnectionInfo>;
  /** Secrets already stored for the profile being edited (shown as a placeholder instead of a value). */
  savedSecrets: string[];
  /** True when the secret must be typed (connect/test); false when saving a profile. */
  secretRequired: boolean;
};

/** Builds the empty form values, with the given default profile name. */
export const getDefaultConnectionInfo = (name: string): ConnectionInfo => ({
  name,
  color: DEFAULT_PROFILE_COLOR,
  provider: 'aws',
  endpoint: '',
  region: '',
  accessKey: '',
  secretKey: '',
  pathStyle: false,
  savePassword: false,
  autoConnect: false,
  mfaCode: '',
  authType: 'static',
  authConfig: {
    profileName: '',
    configFile: '',
    credentialsFile: '',
    sourceType: 'static',
    roleArn: '',
    externalId: '',
    sessionName: '',
    durationSeconds: DEFAULT_DURATION_SECONDS,
    mfaSerial: '',
  },
  authSecret: { sessionToken: '' },
});

/** Form values of a saved profile; secrets stay empty (the backend never returns them). */
export const toFormValues = (defaults: ConnectionInfo, profile: ConnectionProfileOutput): ConnectionInfo => {
  const savedConfig = Object.fromEntries(
    Object.entries(profile.authConfig ?? {}).filter(([, value]) => value !== undefined && value !== null)
  );

  return {
    ...defaults,
    name: profile.name ?? defaults.name,
    color: profile.color ?? defaults.color,
    provider: profile.provider ?? defaults.provider,
    endpoint: profile.endpoint ?? defaults.endpoint,
    region: profile.region ?? defaults.region,
    accessKey: profile.accessKey ?? defaults.accessKey,
    pathStyle: profile.pathStyle,
    autoConnect: profile.autoConnect,
    savePassword: !!profile.savedSecrets?.length,
    authType: getAuthType(profile),
    authConfig: { ...defaults.authConfig, ...savedConfig },
  };
};

/** Config fields each method uses; `assumeRole` adds `profileName` when its source is an AWS CLI profile. */
const CONFIG_KEYS: Partial<Record<AuthType, (keyof ConnectionInfo['authConfig'])[]>> = {
  sharedProfile: ['profileName', 'configFile', 'credentialsFile'],
  sso: ['profileName', 'configFile'],
  assumeRole: ['sourceType', 'roleArn', 'externalId', 'sessionName', 'durationSeconds', 'mfaSerial'],
};

const cleanValue = (value: unknown) => (typeof value === 'string' ? value.trim() : value);

/** Converts the form values to the backend input, keeping only the fields of the selected method. */
export const toConnectionInput = (
  values: ConnectionInfo,
  id: string,
  version: number,
  withMfaCode = true
): ConnectionProfileInput => {
  const { authType, authConfig } = values;
  const keys = [...(CONFIG_KEYS[authType] ?? [])];
  if (authType === 'assumeRole' && authConfig.sourceType === 'profile') keys.push('profileName');

  const config = Object.fromEntries(
    keys.map(key => [key, cleanValue(authConfig[key])]).filter(([, value]) => value !== '' && value !== undefined)
  );
  const usesKeys = getRequiredSecrets({ authType, authConfig }).includes('secretKey');

  return {
    id,
    version,
    name: values.name,
    color: values.color,
    provider: values.provider,
    endpoint: values.endpoint,
    region: values.region,
    accessKey: usesKeys ? values.accessKey : '',
    secretKey: usesKeys ? values.secretKey : '',
    pathStyle: values.pathStyle,
    savePassword: values.savePassword,
    autoConnect: values.autoConnect,
    authType,
    authConfig: config,
    authSecret: authType === 'static' ? { sessionToken: values.authSecret.sessionToken.trim() } : {},
    mfaCode: withMfaCode && needsMfa({ authType, authConfig }) ? values.mfaCode : '',
  };
};
