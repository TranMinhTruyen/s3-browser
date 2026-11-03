import type { ConnectionProfileInput } from '@wails/S3Browser/models';

/** Every authentication method the backend knows. */
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
  /** False hides the method from the Select until its fields exist (set true in the phase that adds them). */
  enabled: boolean;
  /** Whether a profile of this method may connect on startup (assumeRole with MFA is locked separately). */
  autoConnect: boolean;
  /** Region may stay empty (the AWS config or the SDK supplies it). */
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

/** Methods offered by the Select for a provider. */
export const getAuthMethods = (provider: string): AuthType[] =>
  AUTH_TYPES.filter(type => AUTH_METHODS[type].enabled && AUTH_METHODS[type].providers.includes(provider as Provider));

/** Whether the method is offered for the provider. */
export const isAuthTypeValid = (provider: string, authType: string): boolean =>
  getAuthMethods(provider).includes(authType as AuthType);

/** Region may be empty for this provider and method. */
export const isRegionOptional = (provider: string, authType: AuthType): boolean =>
  provider === 'aws' && AUTH_METHODS[authType]?.optionalRegion === true;
