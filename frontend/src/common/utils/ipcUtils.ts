import { type Message, Output } from '@wails/S3Browser/models/common';
import { CancelError, CancellablePromise } from '@wailsio/runtime';
import { toast } from 'sonner';
import { createUUID, formatStringJson, isNullOrEmpty } from '@/common/utils/stringUtils';
import i18n from '@/locales/i18n';

/** Các tùy chọn của {@link callIPC}. */
interface Optionals<T> {
  /** Khóa kiểm soát kết quả lỗi thời: lời gọi mới hơn cùng phạm vi sẽ khiến kết quả cũ bị loại bỏ (null). */
  scope?: string;
  /** Hiển thị thông báo từ backend dưới dạng toast. Mặc định là true. */
  showMessage?: boolean;
  /** Hủy lời gọi (và loại bỏ kết quả) khi signal bị abort. */
  signal?: AbortSignal;
  /** Chạy khi backend báo thành công. */
  resolveAction?: (output?: Output<T>) => void;
  /** Chạy khi backend báo thất bại hoặc lời gọi phát sinh lỗi (`output` khi đó là undefined). */
  rejectAction?: (output?: Output<T>) => void;
}

/* -------------------------------------------------------------------------- */
/* Kiểm soát kết quả lỗi thời                                                  */
/* -------------------------------------------------------------------------- */

const keys = new Map<string, string>();

function nextSequence(key: string): string {
  const sequence = createUUID();
  keys.set(key, sequence);
  return sequence;
}

function isStaleKey(key: string, sequence: string): boolean {
  return keys.get(key) !== sequence;
}

/** Loại bỏ các kết quả đang chờ của `scope` và phạm vi con (`scope/...`), ví dụ khi reset store. */
export function invalidateLoads(scope: string): void {
  for (const key of keys.keys()) {
    if (key === scope || key.startsWith(`${scope}/`)) {
      keys.delete(key);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Gọi                                                                        */
/* -------------------------------------------------------------------------- */
/**
 * Gọi binding của Wails: hiển thị thông báo, bỏ qua kết quả đã hủy/lỗi thời và hiện lỗi phát sinh dưới dạng toast.
 *
 * @param binding - binding được sinh tự động, trả về `Output<T>`.
 * @param args - các đối số của binding.
 * @param options - xem {@link Optionals}.
 * @returns phần body khi thành công; null nếu thất bại, bị hủy hoặc kết quả đã lỗi thời.
 */
export async function callIPC<A extends unknown[], T>(
  binding: (...args: A) => Promise<Output<T>>,
  args: A,
  options: Optionals<T> = {}
): Promise<T | null | undefined> {
  const { scope, showMessage = true, signal, resolveAction, rejectAction } = options;
  const sequence = scope ? nextSequence(scope) : '';

  try {
    const call = binding(...args);
    if (signal && call instanceof CancellablePromise) {
      call.cancelOn(signal);
    }
    const output = await call;

    if (signal?.aborted || (scope && isStaleKey(scope, sequence))) {
      return null;
    }

    if (output.result) {
      resolveAction?.(output);
    } else {
      rejectAction?.(output);
    }

    if (showMessage) {
      showOutputMessages(output);
    }

    // Body phía Go là kiểu giá trị nên lời gọi thất bại vẫn mang body có giá trị zero; ẩn body đó đi.
    return output.result ? output.body : null;
  } catch (err) {
    // Chủ động hủy: không xem đây là lỗi cần báo cho người dùng.
    if (err instanceof CancelError) {
      return null;
    }
    toast.error(i18n.t('ipcMessage:common.CME001'), {
      description: err instanceof Error ? err.message : String(err),
    });
    rejectAction?.(undefined);
    return null;
  }
}

/** Mã thông báo (của module `bucket`) có tham số `secret` là tên kỹ thuật (ví dụ `mfaCode`). */
const SECRET_PARAM_CODES = new Set(['S3E046']);

/** Thay tham số kỹ thuật `secret` của {@link SECRET_PARAM_CODES} bằng nhãn `ipcMessage:params.secret.*` tương ứng. */
function translateParams({ moduleName, messageCode, params }: Message) {
  if (moduleName !== 'bucket' || !SECRET_PARAM_CODES.has(messageCode ?? '')) return params;
  const key = `ipcMessage:params.secret.${params?.secret}`;
  return i18n.exists(key) ? { ...params, secret: i18n.t(key) } : params;
}

export function showOutputMessages<T>(output: Output<T>): void {
  [...(output.messageList ?? [])]
    .sort((a, b) => (a.order ?? '').localeCompare(b.order ?? ''))
    .forEach(item => {
      const message = formatStringJson(
        i18n.t(`ipcMessage:${item.moduleName}.${item.messageCode}`),
        translateParams(item)
      );
      const description = !isNullOrEmpty(item.errorDetail) ? item.errorDetail : '';
      switch (item.messageType) {
        case 'E':
          toast.error(message, { description });
          break;
        case 'W':
          toast.warning(message, { description });
          break;
        case 'I':
          toast.info(message, { description });
          break;
        default:
          toast.success(message, { description });
          break;
      }
    });
}
