import {
  AUTH_METHODS,
  type AuthConfig,
  type AuthType,
  DEFAULT_AUTH_TYPE,
} from '@/components/modals/connect/authMethods';

/** The part of a profile that decides how it authenticates. */
type AuthSubject = { authType?: string; authConfig?: Pick<AuthConfig, 'mfaSerial' | 'sourceType'> };

/** Profiles saved before sprint-11 have no authType; they are `static`. */
export const getAuthType = (profile: AuthSubject): AuthType => (profile.authType || DEFAULT_AUTH_TYPE) as AuthType;

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
    default:
      return [];
  }
};

/** Whether the profile may auto-connect on startup. */
export const canAutoConnect = (profile: AuthSubject): boolean =>
  !!AUTH_METHODS[getAuthType(profile)]?.autoConnect && !needsMfa(profile);

/** True when connecting a saved profile needs input the backend does not have (a secret or an MFA code). */
export const needsManualInput = (profile: AuthSubject & { accessKey?: string; savedSecrets?: string[] }): boolean => {
  const required = getRequiredSecrets(profile);
  const saved = profile.savedSecrets ?? [];
  return (
    needsMfa(profile) ||
    required.some(name => !saved.includes(name)) ||
    (required.includes('secretKey') && !profile.accessKey)
  );
};
