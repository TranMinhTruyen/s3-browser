import { toast } from 'sonner';
import type { ConnectModalProps } from '@/components/modals/connect/connectSchema';
import i18n from '@/locales/i18n';

/** A chunk that loads faster than this shows no feedback, so fast loads do not flash a toast. */
const SLOW_LOAD_MS = 300;

/** Tells the user a chunk failed to load, with the error as detail, so it never becomes an unhandled rejection. */
const onLoadModalFailed = (error: unknown) => {
  toast.error(i18n.t('common:modalLoadError'), {
    description: error instanceof Error ? error.message : String(error),
  });
};

/**
 * Loads a modal chunk. Shows a loading toast if it is slow and an error toast if it fails (then resolves undefined).
 * Only the chunk load is guarded: an error thrown later by `show()` is not reported as a load error.
 */
async function loadModal<M>(load: () => Promise<M>): Promise<M | undefined> {
  let loadingId: string | number | undefined;
  const timer = setTimeout(() => {
    loadingId = toast.loading(i18n.t('common:modalLoading'));
  }, SLOW_LOAD_MS);
  try {
    return await load();
  } catch (error) {
    onLoadModalFailed(error);
    return undefined;
  } finally {
    clearTimeout(timer);
    if (loadingId !== undefined) toast.dismiss(loadingId);
  }
}

/**
 * Heavy modals are loaded on first use so they stay out of the main bundle.
 * Callers keep the same `show` contract; only the first call waits for the chunk.
 * When the chunk fails to load, `show` resolves undefined: callers that await a result must treat it as a cancel.
 */
export const showConnectModal = async (props: ConnectModalProps) =>
  (await loadModal(() => import('@/components/modals/connect/ConnectModal')))?.default.show(props);

export const showHistoryModal = async () =>
  (await loadModal(() => import('@/components/modals/history/HistoryModal')))?.default.show();

export const showSettingModal = async () =>
  (await loadModal(() => import('@/components/modals/setting/SettingModal')))?.default.show();

export const showUnsavedSettingModal = async () =>
  (await loadModal(() => import('@/components/modals/setting/UnsavedSettingModal')))?.default.show();

export const showUploadPickerModal = async (
  props: Parameters<typeof import('@/components/modals/upload/UploadPickerModal')['default']['show']>[0]
) => (await loadModal(() => import('@/components/modals/upload/UploadPickerModal')))?.default.show(props);

export const showUploadLimitModal = async (
  props: Parameters<typeof import('@/components/modals/upload/UploadLimitModal')['default']['show']>[0]
) => (await loadModal(() => import('@/components/modals/upload/UploadLimitModal')))?.default.show(props);

export const showMfaCodeModal = async (
  props: Parameters<typeof import('@/components/modals/connect/MfaCodeModal')['default']['show']>[0]
) => (await loadModal(() => import('@/components/modals/connect/MfaCodeModal')))?.default.show(props);

export const showDeleteConfirmModal = async (
  props: Parameters<typeof import('@/components/modals/delete/DeleteConfirmModal')['default']['show']>[0]
) => (await loadModal(() => import('@/components/modals/delete/DeleteConfirmModal')))?.default.show(props);

export const showDeleteResultModal = async (
  props: Parameters<typeof import('@/components/modals/delete/DeleteResultModal')['default']['show']>[0]
) => (await loadModal(() => import('@/components/modals/delete/DeleteResultModal')))?.default.show(props);

export const showCreateBucketModal = async (
  props: Parameters<typeof import('@/components/modals/bucket/CreateBucketModal')['default']['show']>[0]
) => (await loadModal(() => import('@/components/modals/bucket/CreateBucketModal')))?.default.show(props);

export const showBucketPolicyModal = async (
  props: Parameters<typeof import('@/components/modals/bucket/BucketPolicyModal')['default']['show']>[0]
) => (await loadModal(() => import('@/components/modals/bucket/BucketPolicyModal')))?.default.show(props);

export const showDeleteBucketModal = async (
  props: Parameters<typeof import('@/components/modals/bucket/DeleteBucketModal')['default']['show']>[0]
) => (await loadModal(() => import('@/components/modals/bucket/DeleteBucketModal')))?.default.show(props);
