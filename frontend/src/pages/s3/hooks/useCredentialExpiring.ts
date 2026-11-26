import { LoginMinioOidc, ReauthConnection } from '@wails/S3Browser/internal/handlers/buckethandler';
import type { CredentialExpiringOutput } from '@wails/S3Browser/models';
import { Events } from '@wailsio/runtime';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { callIPC } from '@/common/utils/ipcUtils';
import { showMfaCodeModal } from '@/components/modals/lazyModals';
import i18n from '@/locales/i18n';
import { useProfileStore } from '@/pages/s3/stores/profileStore';

/** Đăng nhập lại bằng thông tin profile đã lưu (người dùng chạy `aws sso login` trước). */
export const reauthConnection = (connectionId: string) =>
  callIPC(ReauthConnection, [connectionId, { authConfig: {}, authSecret: {} }]);

const relogging = new Set<string>();

/** Đăng nhập lại trong trình duyệt rồi gia hạn thông tin xác thực bằng phiên mới (không làm gì nếu một trong hai bước thất bại). */
export const reloginOidc = async (connectionId: string) => {
  const profile = useProfileStore.getState().connectionProfiles[connectionId];
  // Toast vẫn mở nên lần click thứ hai trong lúc trình duyệt đăng nhập sẽ bị bỏ qua.
  if (!profile || relogging.has(connectionId)) return;
  relogging.add(connectionId);
  try {
    const login = await callIPC(LoginMinioOidc, [profile.authConfig]);
    if (!login?.sessionId) return;
    await callIPC(ReauthConnection, [connectionId, { oidcSessionId: login.sessionId, authConfig: {}, authSecret: {} }]);
  } finally {
    relogging.delete(connectionId);
  }
};

/**
 * `assumeRole` yêu cầu mã MFA mới; `sso` hiện lệnh đăng nhập; `minioOidc` cho phép đăng nhập lại;
 * các phương thức khác cần kết nối lại.
 */
export function onCredentialExpiring(data: CredentialExpiringOutput) {
  const { connectionId, profileName, authType, awsProfile, expiresAt } = data;
  // Mỗi kết nối chỉ có một toast; sự kiện lặp lại sẽ cập nhật toast đó thay vì xếp thêm.
  const id = `credential-expiring-${connectionId}`;

  if (authType === 'assumeRole') {
    void showMfaCodeModal({ connectionId, profileName });
  } else if (authType === 'sso') {
    const command = awsProfile ? `aws sso login --profile ${awsProfile}` : 'aws sso login';
    toast.warning(i18n.t('credentialExpiring:sso.title', { name: profileName }), {
      id,
      duration: Infinity,
      description: i18n.t('credentialExpiring:sso.description', { command }),
      action: {
        label: i18n.t('credentialExpiring:sso.reconnect'),
        onClick: () => void reauthConnection(connectionId),
      },
    });
  } else if (authType === 'minioOidc') {
    toast.warning(i18n.t('credentialExpiring:oidc.title', { name: profileName }), {
      id,
      duration: Infinity,
      description: i18n.t('credentialExpiring:oidc.description', {
        time: dayjs(expiresAt).format(FULL_DATE_TIME_FORMAT),
      }),
      action: {
        label: i18n.t('credentialExpiring:oidc.relogin'),
        onClick: () => void reloginOidc(connectionId),
      },
    });
  } else {
    toast.warning(i18n.t('credentialExpiring:other.title', { name: profileName }), {
      id,
      duration: Infinity,
      description: i18n.t('credentialExpiring:other.description', {
        time: dayjs(expiresAt).format(FULL_DATE_TIME_FORMAT),
      }),
    });
  }
}

/** Lắng nghe `bucket:credential-expiring` (chỉ một lần, mount trong `App`) và hướng dẫn người dùng gia hạn. */
export function useCredentialExpiring() {
  useEffect(() => Events.On('bucket:credential-expiring', e => onCredentialExpiring(e.data)), []);
}
