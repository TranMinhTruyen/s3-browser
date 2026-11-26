// Class mà runtime Wails gắn vào vùng thả khi file đang được kéo qua.
const DROP_TARGET_ACTIVE_CLASS = 'file-drop-target-active';

type WebViewWindow = Window & { chrome?: { webview?: unknown } };

/**
 * Khắc phục lỗi của runtime Wails (3.0.0): bỏ qua mọi `dragleave` có `relatedTarget` null,
 * vì Linux/macOS gửi các event này không chính xác. Trên Windows (WebView2), event đó báo thao tác kéo đã kết thúc
 * do rời cửa sổ hoặc bị hủy bằng ESC; nếu không xử lý thì lớp phủ vùng thả vẫn còn hiển thị. Hàm này sẽ xóa lớp phủ.
 *
 * Chỉ cài trên WebView2, nơi thao tác thả file được xử lý bằng DOM event.
 *
 * @returns hàm gỡ listener.
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
