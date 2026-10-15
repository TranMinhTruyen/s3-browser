import { Output } from '@wails/S3Browser/models/common';
import { CancelError, CancellablePromise } from '@wailsio/runtime';
import { toast } from 'sonner';
import { createUUID, formatStringJson, isNullOrEmpty } from '@/common/utils/stringUtils';
import i18n from '@/locales/i18n';

interface Optionals<T> {
  scope?: string;
  showMessage?: boolean;
  signal?: AbortSignal;
  resolveAction?: (output?: Output<T>) => void;
  rejectAction?: (output?: Output<T>) => void;
}

/* -------------------------------------------------------------------------- */
/* Stale-result guard                                                         */
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

export function invalidateLoads(scope: string): void {
  for (const key of keys.keys()) {
    if (key === scope || key.startsWith(`${scope}/`)) {
      keys.delete(key);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Call                                                                       */
/* -------------------------------------------------------------------------- */
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
      showMessages(output);
    }

    // Body is a value type on the Go side, so a failed call still carries a zero-value body; hide it.
    return output.result ? output.body : null;
  } catch (err) {
    // Canceled on purpose: not an error for the user.
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

function showMessages<T>(output: Output<T>): void {
  [...(output.messageList ?? [])]
    .sort((a, b) => (a.order ?? '').localeCompare(b.order ?? ''))
    .forEach(item => {
      const message = formatStringJson(i18n.t(`ipcMessage:${item.moduleName}.${item.messageCode}`), item?.params);
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
