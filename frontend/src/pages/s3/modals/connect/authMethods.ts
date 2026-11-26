import type { ConnectionProfileInput } from '@wails/S3Browser/models';

/** Tất cả phương thức xác thực mà backend hỗ trợ. */
export const AUTH_TYPES = [
  'static',
  'sharedProfile',
  'assumeRole',
  'sso',
  'defaultChain',
  'anonymous',
  'minioAssumeRole',
  'minioLdap',
  'minioOidc',
  'minioCert',
] as const;

export type AuthType = (typeof AUTH_TYPES)[number];
export type Provider = 'aws' | 'minio';
export type AuthConfig = ConnectionProfileInput['authConfig'];

export const DEFAULT_AUTH_TYPE: AuthType = 'static';

type AuthMethod = {
  providers: Provider[];
  /** false sẽ ẩn phương thức khỏi Select cho đến khi có các trường tương ứng (đặt true ở giai đoạn bổ sung trường). */
  enabled: boolean;
  /** Profile dùng phương thức này có được phép tự kết nối khi khởi động không (assumeRole kèm MFA được khóa riêng). */
  autoConnect: boolean;
  /** Có thể để trống Region (cấu hình AWS hoặc SDK sẽ tự cung cấp). */
  optionalRegion: boolean;
};

const method = (providers: Provider[], enabled: boolean, autoConnect = true, optionalRegion = false): AuthMethod => ({
  providers,
  enabled,
  autoConnect,
  optionalRegion,
});

export const AUTH_METHODS: Record<AuthType, AuthMethod> = {
  static: method(['aws', 'minio'], true),
  sharedProfile: method(['aws'], true, true, true),
  assumeRole: method(['aws'], true),
  sso: method(['aws'], true, true, true),
  defaultChain: method(['aws'], true, true, true),
  anonymous: method(['aws', 'minio'], true),
  minioAssumeRole: method(['minio'], true),
  minioLdap: method(['minio'], true),
  minioOidc: method(['minio'], true, false),
  minioCert: method(['minio'], true),
};

/** Các phương thức Select cung cấp cho một provider. */
export const getAuthMethods = (provider: string): AuthType[] =>
  AUTH_TYPES.filter(type => AUTH_METHODS[type].enabled && AUTH_METHODS[type].providers.includes(provider as Provider));

/** Phương thức này có được cung cấp cho provider hay không. */
export const isAuthTypeValid = (provider: string, authType: string): boolean =>
  getAuthMethods(provider).includes(authType as AuthType);

/** Có thể để trống Region với provider và phương thức này hay không. */
export const isRegionOptional = (provider: string, authType: AuthType): boolean =>
  provider === 'aws' && AUTH_METHODS[authType]?.optionalRegion === true;
