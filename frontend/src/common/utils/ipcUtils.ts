import { Output } from '@wails/S3Browser/models/common';
import { toast } from 'sonner';
import { formatStringJson } from '@/common/utils/stringUtils';
import i18n from '@/locales/i18n';

export async function callIPC<T>(callback: () => Promise<Output<T>>): Promise<T | null> {
  try {
    const output = await callback();
    [...(output.messageList ?? [])]
      .sort((a, b) => (a.order ?? '').localeCompare(b.order ?? ''))
      .forEach((item, idx) => {
        const message = formatStringJson(i18n.t(`ipcMessage:${item.moduleName}.${item.messageCode}`), item?.params);
        switch (item.messageType) {
          case 'E':
            toast.error(message, { id: idx });
            break;
          case 'W':
            toast.warning(message, { id: idx });
            break;
          case 'I':
            toast.info(message, { id: idx });
            break;
          default:
            toast.success(message, { id: idx });
            break;
        }
      });
    return output.body;
  } catch (err) {
    toast.error('Error while call IPC', {
      description: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
