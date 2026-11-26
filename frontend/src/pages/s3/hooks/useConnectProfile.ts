import { ConnectS3ByProfile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { useCallback } from 'react';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';
import { callIPC } from '@/common/utils/ipcUtils';
import { type ConnectionProfile, useProfileStore } from '@/pages/s3/stores/profileStore';

/**
 * Trả về hàm kết nối profile đã lưu qua backend và đánh dấu đã kết nối trong profile store.
 * Trả về true khi kết nối thành công, false nếu kết nối thất bại (backend đã hiện thông báo) hoặc component gọi
 * unmount trong lúc chờ (lời gọi bị hủy im lặng).
 * Chỉ phần IPC được dùng chung: các bước kiểm tra (đã kết nối, thiếu key) và state "đang kết nối" thuộc về nơi gọi.
 */
export function useConnectProfile() {
  const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
  const getSignal = useUnmountSignal();

  return useCallback(
    async (key: string, profile: ConnectionProfile): Promise<boolean> => {
      const output = await callIPC(ConnectS3ByProfile, [key], { signal: getSignal() });
      if (!output?.isConnected) return false;
      updateConnectionProfiles(key, { ...profile, isConnected: true });
      return true;
    },
    [updateConnectionProfiles, getSignal]
  );
}
