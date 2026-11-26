import { UploadObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DroppedGroup } from '@wails/S3Browser/models/bucket';
import { toast } from 'sonner';
import { callIPC } from '@/common/utils/ipcUtils';
import i18n from '@/locales/i18n';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/** File cục bộ cần tải lên và object key của nó tính tương đối với tiền tố đích. */
type UploadFile = { path: string; relKey: string };

export type RunUploadParams = {
  tabId: string;
  connectionId: string;
  profileName?: string;
  bucket: string;
  prefix: string;
  files: UploadFile[];
};

/** Trả về true nếu không có lượt tải lên nào đang chạy; nếu không thì cảnh báo người dùng (mỗi lần chỉ chạy một lượt). */
export function ensureUploadIdle(): boolean {
  if (useTabListStore.getState().uploadingTabId === null) return true;
  toast.warning(i18n.t('ipcMessage:bucket.S3W005'));
  return false;
}

/**
 * Tải các file lên và đánh dấu tab đang tải trong lúc xử lý. `onDone` chạy sau khi tải xong (ví dụ để làm mới),
 * khi tab vẫn còn được đánh dấu. Không làm gì nếu một lượt tải khác đang chạy.
 */
export async function runUpload(params: RunUploadParams, onDone?: () => Promise<void> | void): Promise<void> {
  const { tabId, connectionId, profileName, bucket, prefix, files } = params;
  if (!ensureUploadIdle()) return;

  const { setUploadingTab } = useTabListStore.getState();
  setUploadingTab(tabId);
  try {
    // Backend gửi một thông báo thành công / đã hủy / lỗi cho mỗi file; callIPC sẽ hiển thị chúng.
    await callIPC(UploadObject, [
      { connectionId, profileName, bucket, prefix, objList: files.map(({ path, relKey }) => ({ path, relKey })) },
    ]);
    await onDone?.();
  } finally {
    setUploadingTab(null);
  }
}

/** Các giới hạn áp dụng khi tạo danh sách chọn file để tải lên. */
export type PickerLimits = { maxFilesPerFolder: number; largeFileMaxCount: number; maxTotalFiles: number };

export type PickerList = { groups: DroppedGroup[]; selected: ReadonlySet<string> };

export type MergeResult = PickerList & {
  // Một số file bị bỏ qua vì danh sách đã đạt maxTotalFiles.
  overTotal: boolean;
  // File mới được thêm nhưng không đánh dấu vì nhóm của chúng đã đủ số lượng.
  autoUnselected: boolean;
};

/**
 * Thêm các nhóm mới vào danh sách: bỏ qua file đã có (trùng đường dẫn), gộp nhóm trùng tên,
 * giới hạn danh sách ở maxTotalFiles và lần lượt đánh dấu file mới cho đến khi nhóm đạt giới hạn.
 */
export function mergePickedFiles(prev: PickerList, incoming: DroppedGroup[], limits: PickerLimits): MergeResult {
  const { maxFilesPerFolder, largeFileMaxCount, maxTotalFiles } = limits;
  const known = new Set(prev.groups.flatMap(group => group.files.map(file => file.path)));
  const filesByGroup = new Map(prev.groups.map(group => [group.name, [...group.files]]));
  const selected = new Set(prev.selected);
  const counts = new Map(
    prev.groups.map(group => {
      const ticked = group.files.filter(file => selected.has(file.path));
      return [group.name, { count: ticked.length, large: ticked.filter(file => file.isLarge).length }];
    })
  );
  let overTotal = false;
  let autoUnselected = false;

  for (const group of incoming) {
    for (const file of group.files) {
      if (known.has(file.path)) continue;
      if (known.size >= maxTotalFiles) {
        overTotal = true;
        continue;
      }
      known.add(file.path);
      // Các danh sách trong filesByGroup là bản sao nên thao tác push không sửa dữ liệu đầu vào.
      let groupFiles = filesByGroup.get(group.name);
      if (!groupFiles) {
        groupFiles = [];
        filesByGroup.set(group.name, groupFiles);
      }
      groupFiles.push(file);
      const stat = counts.get(group.name) ?? { count: 0, large: 0 };
      counts.set(group.name, stat);
      if (stat.count < maxFilesPerFolder && (!file.isLarge || stat.large < largeFileMaxCount)) {
        selected.add(file.path);
        stat.count++;
        if (file.isLarge) stat.large++;
      } else {
        autoUnselected = true;
      }
    }
  }

  const groups = [...filesByGroup].map(([name, files]) => {
    const largeCount = files.filter(file => file.isLarge).length;
    return {
      name,
      files,
      totalFiles: files.length,
      largeCount,
      overMaxFiles: files.length > maxFilesPerFolder,
      overLargeCount: largeCount > largeFileMaxCount,
    };
  });
  return { groups, selected, overTotal, autoUnselected };
}

/** Xóa các file có đường dẫn đã cho khỏi danh sách và trạng thái đánh dấu; loại bỏ nhóm không còn file. */
export function removePickedFiles(prev: PickerList, paths: readonly string[]): PickerList {
  const removed = new Set(paths);
  const selected = new Set([...prev.selected].filter(path => !removed.has(path)));
  const groups = prev.groups
    .map(group => {
      const files = group.files.filter(file => !removed.has(file.path));
      const largeCount = files.filter(file => file.isLarge).length;
      return { ...group, files, totalFiles: files.length, largeCount };
    })
    .filter(group => group.files.length > 0);
  return { groups, selected };
}
