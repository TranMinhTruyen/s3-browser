import { Output } from '@wails/S3Browser/models/common';
import { toast } from 'sonner';
import { createUUID, formatStringJson, isNullOrEmpty } from '@/common/utils/stringUtils';
import i18n from '@/locales/i18n';

interface Optionals {
  scope?: string;
  showMessage?: boolean;
}

interface InFlightCall {
  task: Promise<unknown>;
  scope?: string;
  sequence: string;
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
/* In-flight registry                                                         */
/* -------------------------------------------------------------------------- */

const inFlight = new Map<string, InFlightCall>();

// Identify a binding by reference, not by name: the production bundle may
// rename functions, and two mangled names could then collide.
const bindingIds = new WeakMap<object, number>();
let nextBindingId = 0;

function dedupeKeyOf(binding: object, args: unknown[]): string {
  let id = bindingIds.get(binding);
  if (id === undefined) {
    id = nextBindingId++;
    bindingIds.set(binding, id);
  }
  // Arguments always cross the bridge as JSON, so they are serialisable here.
  return `${id}:${JSON.stringify(args)}`;
}

/* -------------------------------------------------------------------------- */
/* Call                                                                       */
/* -------------------------------------------------------------------------- */

export function callIPC<A extends unknown[], T>(
  binding: (...args: A) => Promise<Output<T>>,
  args: A,
  options?: Optionals
): Promise<T | null> {
  const dedupeKey = dedupeKeyOf(binding, args);

  const pending = inFlight.get(dedupeKey);
  if (pending) {
    // This caller wants the very reply already on the wire, so hand its token
    // back to the scope: an `invalidateLoads` that ran in between must not
    // discard a result somebody is still waiting for.
    if (pending.scope) {
      keys.set(pending.scope, pending.sequence);
    }
    return pending.task as Promise<T | null>;
  }

  const scope = options?.scope;
  const sequence = scope ? nextSequence(scope) : '';
  const task = run(binding, args, scope, options?.showMessage, sequence);

  inFlight.set(dedupeKey, { task, scope, sequence });
  void task.finally(() => inFlight.delete(dedupeKey));

  return task;
}

async function run<A extends unknown[], T>(
  binding: (...args: A) => Promise<Output<T>>,
  args: A,
  scope: string | undefined,
  showMessage: boolean = true,
  sequence: string
): Promise<T | null> {
  try {
    const output = await binding(...args);

    if (scope && isStaleKey(scope, sequence)) {
      return null;
    }

    if (showMessage) {
      [...(output.messageList ?? [])]
        .sort((a, b) => (a.order ?? '').localeCompare(b.order ?? ''))
        .forEach(item => {
          const message = formatStringJson(i18n.t(`ipcMessage:${item.moduleName}.${item.messageCode}`), item?.params);
          const description = !isNullOrEmpty(item.errorDetail) ? item.errorDetail : '';
          switch (item.messageType) {
            case 'E':
              toast.error(message, { description: description });
              break;
            case 'W':
              toast.warning(message, { description: description });
              break;
            case 'I':
              toast.info(message, { description: description });
              break;
            default:
              toast.success(message, { description: description });
              break;
          }
        });
    }

    return output.body;
  } catch (err) {
    toast.error(i18n.t('ipcMessage:common.CME001'), {
      description: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
