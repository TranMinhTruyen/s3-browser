import { DownloadHistoryItem, DownloadProgressOutput } from '@wails/S3Browser/models/bucket';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

/** Một dòng lịch sử tải xuống được gộp với tiến độ trực tiếp. */
type DownloadItem = DownloadHistoryItem & DownloadProgressOutput;

interface DownloaderState {
  downloadItems: Record<string, DownloadItem>;
  /** Id các mục có trạng thái DOWNLOADING, được `upsertDownloadItems` đồng bộ. */
  downloadingIds: string[];
  windowVisible: boolean;
  /** Kích thước đã đo của downloader đang hiển thị (cửa sổ hoặc nút); bằng 0 nếu chưa render. */
  windowSize: { width: number; height: number };
}

interface DownloaderAction {
  upsertDownloadItems: (inputs: DownloadHistoryItem[]) => void;
  setDownloadProgressBatch: (items: DownloadProgressOutput[]) => void;
  openWindow: () => void;
  closeWindow: () => void;
  setWindowSize: (size: { width: number; height: number }) => void;
  reset: () => void;
}

const SCOPE = 'downloader';

/** Các mục tiến độ tải xuống và state cửa sổ downloader. */
export const useDownloaderStore = createAppStore<DownloaderState & DownloaderAction>(
  (set, get) => ({
    downloadItems: {},
    downloadingIds: [],
    windowVisible: false,
    windowSize: { width: 0, height: 0 },

    openWindow: () => {
      set({ windowVisible: true }, undefined, `${SCOPE}/openWindow`);
    },

    closeWindow: () => {
      set({ windowVisible: false }, undefined, `${SCOPE}/closeWindow`);
    },

    setWindowSize: size => {
      if (size.width === get().windowSize.width && size.height === get().windowSize.height) return;
      set({ windowSize: size }, undefined, `${SCOPE}/setWindowSize`);
    },

    upsertDownloadItems: (inputs: DownloadHistoryItem[]) => {
      set(
        state => {
          for (const input of inputs) {
            const prev = state.downloadItems[input.id];

            if (prev && (input.version ?? 0) < (prev.version ?? 0)) continue;

            state.downloadItems[input.id] = {
              ...prev,
              ...input,
              downloadId: input.id,
              downloaded: prev?.downloaded ?? 0,
              total: prev?.total ?? 0,
            };

            const index = state.downloadingIds.indexOf(input.id);
            if (input.status === 'DOWNLOADING') {
              if (index < 0) state.downloadingIds.push(input.id);
            } else if (index >= 0) {
              state.downloadingIds.splice(index, 1);
            }
          }
        },
        undefined,
        `${SCOPE}/upsertDownloadItems`
      );
    },

    setDownloadProgressBatch: (items: DownloadProgressOutput[]) => {
      set(
        state => {
          for (const input of items) {
            const item = state.downloadItems[input.downloadId];
            if (!item) continue;
            // Chỉ gán khi có thay đổi để batch không đổi giữ nguyên state.
            if (item.downloaded !== input.downloaded) item.downloaded = input.downloaded;
            if (item.total !== input.total) item.total = input.total;
          }
        },
        undefined,
        `${SCOPE}/setDownloadProgressBatch`
      );
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(
        {
          downloadItems: {},
          downloadingIds: [],
          windowVisible: false,
          windowSize: { width: 0, height: 0 },
        },
        undefined,
        `${SCOPE}/reset`
      );
    },
  }),
  SCOPE
);

/** Id các lượt tải xuống đang chạy (giữ nguyên tham chiếu cho đến khi danh sách đổi). */
export const selectDownloadingIds = (s: DownloaderState) => s.downloadingIds;
