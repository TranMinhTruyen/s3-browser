import { MouseEvent, useCallback, useState } from 'react';

const noop = () => {};

/**
 * Theo dõi trạng thái tải của phần tử dạng nút có `onClick` bất đồng bộ.
 * Nếu có prop `loading` tường minh thì ưu tiên prop đó; nếu không, state dựa trên Promise do `onClick` trả về.
 *
 * @returns `isLoading` và hàm xử lý click bao quanh `onClick`.
 */
export function useAutoLoading(
  onClick: ((event: MouseEvent<HTMLButtonElement>) => unknown) | undefined,
  loading: boolean | undefined
) {
  const [autoLoading, setAutoLoading] = useState(false);

  const onClickButton = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const result = onClick?.(event) as Promise<unknown> | undefined;

      // Handler đồng bộ: không có gì cần theo dõi.
      if (typeof result?.then !== 'function') return;

      setAutoLoading(true);
      // Cố ý bỏ qua lỗi ở đây: handler tự thông báo cho người dùng (callIPC / toast).
      result.finally(() => setAutoLoading(false)).catch(noop);
    },
    [onClick]
  );

  return { isLoading: loading ?? autoLoading, onClickButton };
}
