import { Output } from '@wails/S3Browser/models/common';
import { toast } from 'sonner';
import { formatStringJson } from '@/common/utils/stringUtils';
import i18n from '@/locales/i18n';

const keys = new Map<string, number>();

function nextSequence(key: string): number {
  const sequence = (keys.get(key) ?? 0) + 1;
  keys.set(key, sequence);
  return sequence;
}

function isStaleKey(key: string, sequence: number): boolean {
  return keys.get(key) !== sequence;
}

export function invalidateLoads(scope: string): void {
  for (const key of keys.keys()) {
    if (key === scope || key.startsWith(`${scope}/`)) {
      keys.delete(key);
    }
  }
}

export async function callIPC<T>(callback: () => Promise<Output<T>>, scope?: string): Promise<T | null> {
  const sequence = scope ? nextSequence(scope) : 0;

  try {
    const output = await callback();

    [...(output.messageList ?? [])]
      .sort((a, b) => (a.order ?? '').localeCompare(b.order ?? ''))
      .forEach(item => {
        const message = formatStringJson(i18n.t(`ipcMessage:${item.moduleName}.${item.messageCode}`), item?.params);
        switch (item.messageType) {
          case 'E':
            toast.error(message);
            break;
          case 'W':
            toast.warning(message);
            break;
          case 'I':
            toast.info(message);
            break;
          default:
            toast.success(message);
            break;
        }
      });

    if (scope && isStaleKey(scope, sequence)) {
      return null;
    }

    return output.body;
  } catch (err) {
    toast.error('Error while call IPC', {
      description: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
