import { type Message, Output } from '@wails/S3Browser/models/common';
import { CancelError, CancellablePromise } from '@wailsio/runtime';
import { toast } from 'sonner';
import { createUUID, formatStringJson, isNullOrEmpty } from '@/common/utils/stringUtils';
import i18n from '@/locales/i18n';

/** Options of {@link callIPC}. */
interface Optionals<T> {
  /** Stale-result guard key: a newer call with the same scope makes the older result be dropped (null). */
  scope?: string;
  /** Show the backend messages as toasts. Default true. */
  showMessage?: boolean;
  /** Cancels the call (and drops its result) when aborted. */
  signal?: AbortSignal;
  /** Runs when the backend reports success. */
  resolveAction?: (output?: Output<T>) => void;
  /** Runs when the backend reports failure or the call throws (then `output` is undefined). */
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

/** Drops the pending results of `scope` and its sub-scopes (`scope/...`), e.g. on store reset. */
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
/**
 * Calls a Wails binding: shows its messages, ignores canceled / stale results and turns thrown errors into a toast.
 *
 * @param binding - generated binding returning `Output<T>`.
 * @param args - arguments of the binding.
 * @param options - see {@link Optionals}.
 * @returns the body on success; null on failure, cancel or stale result.
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

/** Technical secret names the backend puts in the `secret` param (S3E046), with the label that shows them. */
const SECRET_LABELS: Record<string, string> = {
  mfaCode: 'connectModal:form.label.mfaCode',
  secretKey: 'connectModal:form.label.secretKey',
  ldapPassword: 'connectModal:form.label.ldapPassword',
  keyPassword: 'connectModal:form.label.keyPassword',
  oidcSession: 'connectModal:form.label.oidcSession',
};

/** Message codes (of the `bucket` module) whose `secret` param is one of {@link SECRET_LABELS}. */
const SECRET_PARAM_CODES = new Set(['S3E046']);

/** Replaces the technical `secret` param of the codes in {@link SECRET_PARAM_CODES} with its translated label. */
function translateParams({ moduleName, messageCode, params }: Message) {
  const label =
    moduleName === 'bucket' && SECRET_PARAM_CODES.has(messageCode ?? '') ? SECRET_LABELS[params?.secret] : undefined;
  return label ? { ...params, secret: i18n.t(label) } : params;
}

function showMessages<T>(output: Output<T>): void {
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
