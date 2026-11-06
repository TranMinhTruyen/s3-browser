import {
  AUTH_METHODS,
  type AuthConfig,
  type AuthType,
  DEFAULT_AUTH_TYPE,
} from '@/components/modals/connect/authMethods';

/** The part of a profile that decides how it authenticates. */
type AuthSubject = { authType?: string; authConfig?: Pick<AuthConfig, 'mfaSerial' | 'sourceType' | 'keyEncrypted'> };

/** Profiles saved before sprint-11 have no authType; they are `static`. */
export const getAuthType = (profile: AuthSubject): AuthType => (profile.authType || DEFAULT_AUTH_TYPE) as AuthType;

/** An anonymous connection can only read: it cannot create or change buckets. */
export const isAnonymous = (profile: AuthSubject): boolean => getAuthType(profile) === 'anonymous';

/** An MFA device makes the connection need a one-time code each time. */
export const needsMfa = (profile: AuthSubject): boolean =>
  getAuthType(profile) === 'assumeRole' && !!profile.authConfig?.mfaSerial;

/** Secrets that must be present to connect (typed now or already saved). */
export const getRequiredSecrets = (profile: AuthSubject): string[] => {
  switch (getAuthType(profile)) {
    case 'static':
    case 'minioAssumeRole':
      return ['secretKey'];
    case 'assumeRole':
      return profile.authConfig?.sourceType === 'profile' ? [] : ['secretKey'];
    case 'minioLdap':
      return ['ldapPassword'];
    case 'minioCert':
      return profile.authConfig?.keyEncrypted ? ['keyPassword'] : [];
    default:
      return [];
  }
};

/** Whether the profile may auto-connect on startup. */
export const canAutoConnect = (profile: AuthSubject): boolean =>
  !!AUTH_METHODS[getAuthType(profile)]?.autoConnect && !needsMfa(profile);

/**
 * True when connecting a saved profile needs input the backend does not have: a secret, an MFA code, or an OIDC
 * sign-in (its session is never saved).
 */
export const needsManualInput = (profile: AuthSubject & { accessKey?: string; savedSecrets?: string[] }): boolean => {
  const required = getRequiredSecrets(profile);
  const saved = profile.savedSecrets ?? [];
  return (
    needsMfa(profile) ||
    getAuthType(profile) === 'minioOidc' ||
    required.some(name => !saved.includes(name)) ||
    (required.includes('secretKey') && !profile.accessKey)
  );
};
