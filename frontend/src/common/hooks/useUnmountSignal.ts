import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a getter for an AbortSignal that aborts when the component unmounts, to cancel pending IPC calls.
 * The controller is created in the effect (not during render) so a StrictMode remount gets a fresh one.
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
