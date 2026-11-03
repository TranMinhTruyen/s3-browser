import { LoginMinioOidc, ReauthConnection } from '@wails/S3Browser/internal/handlers/buckethandler';
import type { CredentialExpiringOutput } from '@wails/S3Browser/models';
import { Events } from '@wailsio/runtime';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { showMfaCodeModal } from '@/components/modals/lazyModals';
import i18n from '@/locales/i18n';

/** Signs in again with what the profile has saved (the user ran `aws sso login` first). */
export const reauthConnection = (connectionId: string) =>
  callIPC(ReauthConnection, [connectionId, { authConfig: {}, authSecret: {} }]);

const relogging = new Set<string>();

/** Signs in again in the browser, then renews the credentials with the new sign-in (nothing happens if either fails). */
export const reloginOidc = async (connectionId: string) => {
  const profile = useProfileStore.getState().connectionProfiles[connectionId];
  // The toast stays open, so a second click while the browser sign-in runs is ignored.
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
 * `assumeRole` asks for a new MFA code; `sso` shows the login command; `minioOidc` offers to sign in again;
 * any other method must connect again.
 */
export function onCredentialExpiring(data: CredentialExpiringOutput) {
  const { connectionId, profileName, authType, awsProfile, expiresAt } = data;
  // One toast per connection, so a repeated event updates it instead of stacking.
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

/** Listens (once, mount it in `App`) to `bucket:credential-expiring` and tells the user how to renew. */
export function useCredentialExpiring() {
  useEffect(() => Events.On('bucket:credential-expiring', e => onCredentialExpiring(e.data)), []);
}
