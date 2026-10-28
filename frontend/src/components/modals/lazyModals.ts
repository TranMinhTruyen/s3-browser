import { toast } from 'sonner';
import type { ConnectModalProps } from '@/components/modals/connectSchema';
import i18n from '@/locales/i18n';

/** Logs the failed chunk load and tells the user, so it never becomes an unhandled rejection. */
const onLoadModalFailed = (error: unknown) => {
  // oxlint-disable-next-line no-console -- kept on purpose for debugging failed chunk loads
  console.error('Failed to load modal chunk', error);
  toast.error(i18n.t('common:modalLoadError'));
};

/**
 * Heavy modals are loaded on first use so they stay out of the main bundle.
 * Callers keep the same `show` contract; only the first call waits for the chunk.
 */
export const showConnectModal = (props: ConnectModalProps) =>
  import('@/components/modals/ConnectModal').then(m => m.default.show(props)).catch(onLoadModalFailed);

export const showHistoryModal = () =>
  import('@/components/modals/HistoryModal').then(m => m.default.show()).catch(onLoadModalFailed);
