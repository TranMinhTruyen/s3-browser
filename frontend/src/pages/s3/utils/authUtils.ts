import { AUTH_METHODS, type AuthConfig, type AuthType, DEFAULT_AUTH_TYPE } from '@/pages/s3/modals/connect/authMethods';

/** Phần của profile quyết định cách xác thực. */
type AuthSubject = { authType?: string; authConfig?: Pick<AuthConfig, 'mfaSerial' | 'sourceType' | 'keyEncrypted'> };

/** Profile lưu trước sprint-11 không có authType nên được xem là `static`. */
export const getAuthType = (profile: AuthSubject): AuthType => (profile.authType || DEFAULT_AUTH_TYPE) as AuthType;

/** Kết nối ẩn danh chỉ có quyền đọc, không thể tạo hoặc thay đổi bucket. */
export const isAnonymous = (profile: AuthSubject): boolean => getAuthType(profile) === 'anonymous';

/** Thiết bị MFA khiến mỗi lần kết nối đều cần mã dùng một lần. */
export const needsMfa = (profile: AuthSubject): boolean =>
  getAuthType(profile) === 'assumeRole' && !!profile.authConfig?.mfaSerial;

/** Các thông tin bí mật bắt buộc phải có để kết nối (nhập lúc này hoặc đã được lưu). */
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

/** Profile có được phép tự động kết nối khi khởi động hay không. */
export const canAutoConnect = (profile: AuthSubject): boolean =>
  !!AUTH_METHODS[getAuthType(profile)]?.autoConnect && !needsMfa(profile);

/**
 * Trả về true nếu kết nối profile đã lưu cần thông tin backend chưa có: secret, mã MFA hoặc đăng nhập OIDC
 * (phiên OIDC không bao giờ được lưu).
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
