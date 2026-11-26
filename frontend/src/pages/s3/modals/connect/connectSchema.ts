import type { UseFormReturnType } from '@mantine/form';
import type { ConnectionProfileInput, ConnectionProfileOutput } from '@wails/S3Browser/models';
import z from 'zod';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';
import { AUTH_TYPES, type AuthType, isRegionOptional } from '@/pages/s3/modals/connect/authMethods';
import { getAuthType, getRequiredSecrets, needsMfa } from '@/pages/s3/utils/authUtils';

const DEFAULT_DURATION_SECONDS = 3600;
const MIN_DURATION_SECONDS = 900;
const MAX_DURATION_SECONDS = 43200;
const DURATION_ERROR = `V000003:${MIN_DURATION_SECONDS},${MAX_DURATION_SECONDS}`;
const ROLE_ARN_REGEX = /^arn:aws[\w-]*:iam::\d{12}:role\/\S+$/;
const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const LOOPBACK_HOST_REGEX = new RegExp(String.raw`^(localhost|127(\.${OCTET}){3}|\[::1\])$`, 'i');
// Host của URL gốc (không gồm userinfo/port), đọc trước khi `new URL` chuẩn hóa các dạng như `127.1`.
const RAW_HOST_REGEX = /^[a-z]+:\/\/(?:[^/\\?#@]*@)?(\[[^\]/\\?#]*\]|[^/\\?#:@]*)/i;

export const DEFAULT_CALLBACK_PORT = 48765;
const MIN_CALLBACK_PORT = 1024;
const MAX_CALLBACK_PORT = 65535;
const PORT_ERROR = `V000003:${MIN_CALLBACK_PORT},${MAX_CALLBACK_PORT}`;

/** Mô phỏng backend `utils.IsSecureUrl`: chấp nhận https với mọi host, chỉ chấp nhận http với host loopback. */
export const isSecureIssuerUrl = (value: string): boolean => {
  try {
    const { protocol, hostname } = new URL(value);
    if (protocol === 'https:') return hostname !== '';
    if (protocol !== 'http:') return false;
    // url.Parse của Go từ chối dấu gạch chéo ngược trong authority; URL API lại âm thầm xem nó như dấu gạch chéo xuôi.
    if ((/^[a-z]+:\/\/([^/?#]*)/i.exec(value.trim())?.[1] ?? '').includes('\\')) return false;
    return LOOPBACK_HOST_REGEX.test(RAW_HOST_REGEX.exec(value.trim())?.[1] ?? '');
  } catch {
    return false;
  }
};

/** Các phương thức có thời lượng phiên: bắt buộc với `assumeRole`, tùy chọn với các phương thức MinIO. */
const DURATION_TYPES: AuthType[] = ['assumeRole', 'minioAssumeRole', 'minioLdap'];

const text = z.string().trim();
const required = text.nonempty('V000001');
// NumberInput trả '' (hoặc chuỗi đang nhập dở) trong khi người dùng gõ.
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

/** Các trường dùng chung cho mọi phương thức; từng phương thức bổ sung quy tắc riêng. */
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
  // Id của phiên đăng nhập OIDC được giữ ở backend; không bao giờ lưu cùng hồ sơ.
  oidcSessionId: text,
  authConfig: authConfigSchema,
  // Không trim mật khẩu: dấu cách đầu/cuối có thể là một phần của mật khẩu.
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

/** Giá trị biểu mẫu của hộp thoại kết nối (mọi trường của mọi phương thức; khi submit sẽ bỏ các trường đang ẩn). */
export type ConnectionInfo = z.infer<typeof formSchema>;

/**
 * Schema cho từng phương thức xác thực. `requireSecret` là true khi kết nối/kiểm tra (bắt buộc có secret và mã MFA),
 * false khi chỉ lưu hồ sơ.
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

      // Phiên AWS role cần thời lượng; các phương thức MinIO để trống để dùng giá trị mặc định của máy chủ.
      if (!DURATION_TYPES.includes(authType)) return;
      const duration = authConfig.durationSeconds;
      if (duration === '') {
        if (authType === 'assumeRole') addRequired(['authConfig', 'durationSeconds']);
      } else if (typeof duration !== 'number' || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
        addIssue(DURATION_ERROR, ['authConfig', 'durationSeconds']);
      }
    });
};

/** Schema dùng khi chỉ lưu hồ sơ (secret là tùy chọn). */
export const profileSchema = buildConnectSchema(false);

/** Schema dùng khi kết nối hoặc kiểm tra kết nối (bắt buộc có secret và mã MFA). */
export const connectSchema = buildConnectSchema(true);

/** Props của `ConnectModal.show()`. `connectionProfile` là hồ sơ cần kết nối hoặc chỉnh sửa; bỏ qua nếu tạo hồ sơ mới. */
export type ConnectModalProps = {
  mode?: 'connect' | 'manualconnect' | 'createProfile' | 'editProfile';
  connectionProfile?: ConnectionProfileOutput;
};

/** Props dùng chung cho các component trường theo từng phương thức. */
export type AuthFieldsProps = {
  form: UseFormReturnType<ConnectionInfo>;
  /** Secret đã lưu của hồ sơ đang chỉnh sửa (hiển thị làm placeholder thay vì giá trị). */
  savedSecrets: string[];
  /** True nếu cần nhập secret (kết nối/kiểm tra); false khi lưu hồ sơ. */
  secretRequired: boolean;
};

/** `authConfig` rỗng của một phương thức; các phương thức MinIO để trống thời lượng (dùng mặc định máy chủ). */
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

/** Tạo giá trị biểu mẫu rỗng với tên hồ sơ mặc định đã cho. */
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

/** Giá trị biểu mẫu của hồ sơ đã lưu; secret luôn rỗng (backend không bao giờ trả chúng về). */
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

/** Các trường cấu hình mỗi phương thức sử dụng; `assumeRole` thêm `profileName` nếu nguồn là hồ sơ AWS CLI. */
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

/** Trim chuỗi; danh sách (bucket) được trim và loại mục rỗng/trùng lặp. */
const cleanValue = (value: unknown) => {
  if (Array.isArray(value)) return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
  return typeof value === 'string' ? value.trim() : value;
};

/** Các secret của phương thức ngoài secret key; giá trị rỗng có nghĩa là "giữ lại giá trị đã lưu" ở backend. */
const toAuthSecret = ({ authType, authSecret }: ConnectionInfo): ConnectionProfileInput['authSecret'] => {
  if (authType === 'static') return { sessionToken: authSecret.sessionToken.trim() };
  if (authType === 'minioLdap') return { ldapPassword: authSecret.ldapPassword };
  if (authType === 'minioCert') return { keyPassword: authSecret.keyPassword };
  return {};
};

/** Chuyển giá trị biểu mẫu thành dữ liệu đầu vào backend, chỉ giữ các trường của phương thức được chọn. */
export const toConnectionInput = (
  values: ConnectionInfo,
  id: string,
  version: number,
  withMfaCode = true
): ConnectionProfileInput => {
  const { authType, authConfig } = values;
  const keys = [...(CONFIG_KEYS[authType] ?? [])];
  if (authType === 'assumeRole' && authConfig.sourceType === 'profile') keys.push('profileName');
  // CA bổ sung thuộc về kết nối MinIO bất kể phương thức nào.
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
    // Chỉ thao tác kết nối/kiểm tra mới mang dữ liệu đăng nhập (withMfaCode là false khi lưu hồ sơ).
    oidcSessionId: withMfaCode && authType === 'minioOidc' ? values.oidcSessionId : '',
  };
};
