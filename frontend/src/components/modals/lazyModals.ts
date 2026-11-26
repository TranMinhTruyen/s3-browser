import { toast } from 'sonner';
import i18n from '@/locales/i18n';
import type { ConnectModalProps } from '@/pages/s3/modals/connect/connectSchema';

/** Chunk tải nhanh hơn khoảng thời gian này sẽ không hiện thông báo, tránh toast lóe lên khi tải nhanh. */
const SLOW_LOAD_MS = 300;

/** Báo cho người dùng biết chunk tải thất bại, kèm chi tiết lỗi để tránh unhandled rejection. */
const onLoadModalFailed = (error: unknown) => {
  toast.error(i18n.t('common:modalLoadError'), {
    description: error instanceof Error ? error.message : String(error),
  });
};

/**
 * Tải chunk của modal. Hiện toast đang tải nếu thao tác chậm và toast lỗi nếu thất bại (sau đó trả về undefined).
 * Chỉ bước tải chunk được bắt lỗi: lỗi phát sinh sau đó trong `show()` không được báo là lỗi tải.
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
 * Modal nặng chỉ được tải ở lần dùng đầu tiên để không nằm trong bundle chính.
 * Nơi gọi vẫn dùng cùng hợp đồng `show`; chỉ lần gọi đầu tiên phải chờ chunk.
 * Nếu tải chunk thất bại, `show` trả về undefined: nơi gọi chờ kết quả phải xem như người dùng đã hủy.
 */
export const showConnectModal = async (props: ConnectModalProps) =>
  (await loadModal(() => import('@/pages/s3/modals/connect/ConnectModal')))?.default.show(props);

export const showHistoryModal = async () =>
  (await loadModal(() => import('@/pages/s3/modals/history/HistoryModal')))?.default.show();

export const showSettingModal = async () =>
  (await loadModal(() => import('@/components/modals/setting/SettingModal')))?.default.show();

export const showUnsavedSettingModal = async () =>
  (await loadModal(() => import('@/components/modals/setting/UnsavedSettingModal')))?.default.show();

export const showUploadPickerModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/upload/UploadPickerModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/upload/UploadPickerModal')))?.default.show(props);

export const showUploadLimitModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/upload/UploadLimitModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/upload/UploadLimitModal')))?.default.show(props);

export const showMfaCodeModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/connect/MfaCodeModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/connect/MfaCodeModal')))?.default.show(props);

export const showDeleteConfirmModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/delete/DeleteConfirmModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/delete/DeleteConfirmModal')))?.default.show(props);

export const showDeleteResultModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/delete/DeleteResultModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/delete/DeleteResultModal')))?.default.show(props);

export const showCreateBucketModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/bucket/CreateBucketModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/bucket/CreateBucketModal')))?.default.show(props);

export const showBucketPolicyModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/bucket/BucketPolicyModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/bucket/BucketPolicyModal')))?.default.show(props);

export const showExportProfileModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/profile/ExportProfileModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/profile/ExportProfileModal')))?.default.show(props);

export const showImportPasswordModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/profile/ImportPasswordModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/profile/ImportPasswordModal')))?.default.show(props);

export const showDeleteBucketModal = async (
  props: Parameters<typeof import('@/pages/s3/modals/bucket/DeleteBucketModal')['default']['show']>[0]
) => (await loadModal(() => import('@/pages/s3/modals/bucket/DeleteBucketModal')))?.default.show(props);
