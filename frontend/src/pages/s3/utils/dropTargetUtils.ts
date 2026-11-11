// Class the Wails runtime puts on a drop target while files are dragged over it.
const DROP_TARGET_ACTIVE_CLASS = 'file-drop-target-active';

type WebViewWindow = Window & { chrome?: { webview?: unknown } };

/**
 * Works around a Wails runtime (3.0.0) bug: it ignores every `dragleave` whose `relatedTarget` is null,
 * because Linux/macOS send spurious ones. On Windows (WebView2) that event is the real end of a drag that
 * left the window or was cancelled with ESC, so the drop overlay stayed visible. This clears it.
 *
 * Only installed on WebView2, where file drops are handled by DOM events.
 *
 * @returns a function that removes the listener.
 */
export function installDropTargetCleanup(): () => void {
  if (!(window as WebViewWindow).chrome?.webview) return () => {};

  const onDragLeave = (event: DragEvent) => {
    if (event.relatedTarget !== null || !event.dataTransfer?.types.includes('Files')) return;
    for (const element of document.querySelectorAll(`.${DROP_TARGET_ACTIVE_CLASS}`)) {
      element.classList.remove(DROP_TARGET_ACTIVE_CLASS);
    }
  };

  document.documentElement.addEventListener('dragleave', onDragLeave);
  return () => document.documentElement.removeEventListener('dragleave', onDragLeave);
}
