import { ConnectS3ByProfile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { useCallback } from 'react';
import { type ConnectionProfile, useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';

/**
 * Returns a function that connects a saved profile through the backend and marks it connected in the profile store.
 * Resolves true when connected, false when the connection failed (the backend already showed the message).
 * Only the IPC part is shared: guards (already connected, missing keys) and the "connecting" state stay with the caller.
 */
export function useConnectProfile() {
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);

  return useCallback(
    async (key: string, profile: ConnectionProfile): Promise<boolean> => {
      const output = await callIPC(ConnectS3ByProfile, [key]);
      if (!output?.isConnected) return false;
      updateConnectionProfiles(key, { ...profile, isConnected: true });
      return true;
    },
    [updateConnectionProfiles]
  );
}
