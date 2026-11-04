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
const LOOPBACK_HOST_REGEX = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

export const DEFAULT_CALLBACK_PORT = 48765;
const MIN_CALLBACK_PORT = 1024;
const MAX_CALLBACK_PORT = 65535;
const PORT_ERROR = `V000003:${MIN_CALLBACK_PORT},${MAX_CALLBACK_PORT}`;

/** Mirrors backend `utils.IsSecureUrl`: https with any host, http only for a loopback host. */
export const isSecureIssuerUrl = (value: string): boolean => {
  try {
    const { protocol, hostname } = new URL(value);
    return protocol === 'https:' ? hostname !== '' : protocol === 'http:' && LOOPBACK_HOST_REGEX.test(hostname);
  } catch {
    return false;
  }
};

/** Methods with a session duration: required for `assumeRole`, optional for the MinIO ones. */
const DURATION_TYPES: AuthType[] = ['assumeRole', 'minioAssumeRole', 'minioLdap'];

const text = z.string().trim();
const required = text.nonempty('V000001');
// A NumberInput gives '' (or a partial string) while the user is typing.
const numberInput = z.union([z.number(), z.string()]);

const authConfigSchema = z.object({
  profileName: text,
  configFile: text,
  credentialsFile: text,
  sourceType: z.enum(['static', 'profile']),
  roleArn: text,
  externalId: text,
  sessionName: text,
  durationSeconds: numberInput,
  mfaSerial: text,
  policy: text,
  ldapUsername: text,
  clientId: text,
  issuerUrl: text,
  scope: text,
  callbackPort: numberInput,
  certFile: text,
  keyFile: text,
  keyEncrypted: z.boolean(),
  caFile: text,
  buckets: z.array(z.string()),
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
  // Id of the OIDC sign-in held by the backend; never saved with a profile.
  oidcSessionId: text,
  authConfig: authConfigSchema,
  // Passwords are not trimmed: leading/trailing spaces may be part of them.
  authSecret: z.object({ sessionToken: text, ldapPassword: z.string(), keyPassword: z.string() }),
});

const isJson = (value: string) => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

const formSchema = common.extend({ authType: z.enum(AUTH_TYPES) });

/** Form values of the connect modal (all fields of all methods; the hidden ones are dropped on submit). */
export type ConnectionInfo = z.infer<typeof formSchema>;

/**
 * Schema per authentication method. `requireSecret` is true to connect/test (secrets and the MFA code are
 * mandatory) and false to only save a profile.
 */
const buildConnectSchema = (requireSecret: boolean) => {
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
      common.extend({ authType: z.literal('anonymous') }),
      common.extend({ authType: z.literal('minioAssumeRole'), accessKey: required, secretKey: secret }),
      withConfig({ ldapUsername: required }).extend({ authType: z.literal('minioLdap') }),
      withConfig({
        clientId: required,
        issuerUrl: text.nonempty('V000001').refine(isSecureIssuerUrl, 'V000004'),
      }).extend({ authType: z.literal('minioOidc') }),
      withConfig({ certFile: required, keyFile: required }).extend({ authType: z.literal('minioCert') }),
    ])
    .superRefine((values, ctx) => {
      const addIssue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
      const addRequired = (path: (string | number)[]) => addIssue('V000001', path);
      const { authType, authConfig } = values;

      if (values.provider === 'minio' && !values.endpoint) addRequired(['endpoint']);
      if (!values.region && !isRegionOptional(values.provider, authType)) addRequired(['region']);

      if (authType === 'anonymous' && authConfig.buckets.length === 0) addRequired(['authConfig', 'buckets']);
      if (authType === 'minioLdap' && requireSecret && !values.authSecret.ldapPassword) {
        addRequired(['authSecret', 'ldapPassword']);
      }
      if (authType === 'minioOidc') {
        const port = authConfig.callbackPort;
        if (port !== '' && (typeof port !== 'number' || port < MIN_CALLBACK_PORT || port > MAX_CALLBACK_PORT)) {
          addIssue(PORT_ERROR, ['authConfig', 'callbackPort']);
        }
        if (requireSecret && !values.oidcSessionId) addRequired(['oidcSessionId']);
      }
      if (authType === 'minioCert' && requireSecret && authConfig.keyEncrypted && !values.authSecret.keyPassword) {
        addRequired(['authSecret', 'keyPassword']);
      }
      if (authType === 'minioAssumeRole' && authConfig.policy && !isJson(authConfig.policy)) {
        addIssue('V000004', ['authConfig', 'policy']);
      }
      if (authType === 'assumeRole') {
        if (authConfig.sourceType === 'profile') {
          if (!authConfig.profileName) addRequired(['authConfig', 'profileName']);
        } else {
          if (!values.accessKey) addRequired(['accessKey']);
          if (requireSecret && !values.secretKey) addRequired(['secretKey']);
        }
        if (requireSecret && authConfig.mfaSerial && !values.mfaCode) addRequired(['mfaCode']);
      }

      // The AWS role session needs a duration; the MinIO methods leave it empty for the server default.
      if (!DURATION_TYPES.includes(authType)) return;
      const duration = authConfig.durationSeconds;
      if (duration === '') {
        if (authType === 'assumeRole') addRequired(['authConfig', 'durationSeconds']);
      } else if (typeof duration !== 'number' || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
        addIssue(DURATION_ERROR, ['authConfig', 'durationSeconds']);
      }
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

/** Empty `authConfig` of a method; the MinIO methods leave the duration empty (server default). */
export const getDefaultAuthConfig = (authType: AuthType): ConnectionInfo['authConfig'] => ({
  profileName: '',
  configFile: '',
  credentialsFile: '',
  sourceType: 'static',
  roleArn: '',
  externalId: '',
  sessionName: '',
  durationSeconds: authType === 'assumeRole' ? DEFAULT_DURATION_SECONDS : '',
  mfaSerial: '',
  policy: '',
  ldapUsername: '',
  clientId: '',
  issuerUrl: '',
  scope: '',
  callbackPort: DEFAULT_CALLBACK_PORT,
  certFile: '',
  keyFile: '',
  keyEncrypted: false,
  caFile: '',
  buckets: [],
});

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
  oidcSessionId: '',
  authType: 'static',
  authConfig: getDefaultAuthConfig('static'),
  authSecret: { sessionToken: '', ldapPassword: '', keyPassword: '' },
});

/** Form values of a saved profile; secrets stay empty (the backend never returns them). */
export const toFormValues = (defaults: ConnectionInfo, profile: ConnectionProfileOutput): ConnectionInfo => {
  const savedConfig = Object.fromEntries(
    Object.entries(profile.authConfig ?? {}).filter(([, value]) => value !== undefined && value !== null)
  );

  const authType = getAuthType(profile);

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
    authType,
    authConfig: { ...getDefaultAuthConfig(authType), ...savedConfig },
  };
};

/** Config fields each method uses; `assumeRole` adds `profileName` when its source is an AWS CLI profile. */
const CONFIG_KEYS: Partial<Record<AuthType, (keyof ConnectionInfo['authConfig'])[]>> = {
  sharedProfile: ['profileName', 'configFile', 'credentialsFile'],
  sso: ['profileName', 'configFile'],
  assumeRole: ['sourceType', 'roleArn', 'externalId', 'sessionName', 'durationSeconds', 'mfaSerial'],
  minioAssumeRole: ['durationSeconds', 'policy'],
  minioLdap: ['ldapUsername', 'durationSeconds'],
  anonymous: ['buckets'],
  minioOidc: ['clientId', 'issuerUrl', 'scope', 'roleArn', 'callbackPort'],
  minioCert: ['certFile', 'keyFile', 'keyEncrypted'],
};

/** Trims strings; a list (buckets) is trimmed and de-duplicated without empty items. */
const cleanValue = (value: unknown) => {
  if (Array.isArray(value)) return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
  return typeof value === 'string' ? value.trim() : value;
};

/** Secrets of the method besides the secret key; an empty one means "keep the saved value" to the backend. */
const toAuthSecret = ({ authType, authSecret }: ConnectionInfo): ConnectionProfileInput['authSecret'] => {
  if (authType === 'static') return { sessionToken: authSecret.sessionToken.trim() };
  if (authType === 'minioLdap') return { ldapPassword: authSecret.ldapPassword };
  if (authType === 'minioCert') return { keyPassword: authSecret.keyPassword };
  return {};
};

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
  // The extra CA belongs to the MinIO connection whatever the method.
  if (values.provider === 'minio') keys.push('caFile');

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
    authSecret: toAuthSecret(values),
    mfaCode: withMfaCode && needsMfa({ authType, authConfig }) ? values.mfaCode : '',
    // Only a connect/test carries the sign-in (withMfaCode is false when saving a profile).
    oidcSessionId: withMfaCode && authType === 'minioOidc' ? values.oidcSessionId : '',
  };
};
