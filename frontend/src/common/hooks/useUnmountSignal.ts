import { useCallback, useEffect, useRef } from 'react';

/**
 * Trả về hàm lấy AbortSignal; signal sẽ bị hủy khi component unmount để hủy các lệnh IPC đang chờ.
 * Controller được tạo trong effect (không phải lúc render) để lần mount lại của StrictMode nhận controller mới.
 */
export function useUnmountSignal() {
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => controller.abort();
  }, []);

  return useCallback(() => controllerRef.current?.signal, []);
}
