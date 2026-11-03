import { MouseEvent, useCallback, useState } from 'react';

const noop = () => {};

/**
 * Tracks the loading state of a button-like element whose `onClick` may be async.
 * An explicit `loading` prop wins; otherwise the state follows the Promise returned by `onClick`.
 *
 * @returns `isLoading` and a click handler that wraps `onClick`.
 */
export function useAutoLoading(
  onClick: ((event: MouseEvent<HTMLButtonElement>) => unknown) | undefined,
  loading: boolean | undefined
) {
  const [autoLoading, setAutoLoading] = useState(false);

  const onClickButton = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const result = onClick?.(event) as Promise<unknown> | undefined;

      // Synchronous handler: nothing to track.
      if (typeof result?.then !== 'function') return;

      setAutoLoading(true);
      // Errors are swallowed here on purpose: the handler reports them to the user itself (callIPC / toast).
      result.finally(() => setAutoLoading(false)).catch(noop);
    },
    [onClick]
  );

  return { isLoading: loading ?? autoLoading, onClickButton };
}
