import { DownloadHistoryItem, DownloadProgressOutput } from '@wails/S3Browser/models/bucket';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

/** Download history row merged with its live progress. */
export type DownloadItem = DownloadHistoryItem & DownloadProgressOutput;

interface DownloaderState {
  downloadItems: Record<string, DownloadItem>;
  /** Ids of items with status DOWNLOADING, kept in sync by `upsertDownloadItems`. */
  downloadingIds: string[];
  windowVisible: boolean;
  /** Measured size of the visible downloader (window or button); 0 when not rendered. */
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

/** Download progress items and the downloader window state. */
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
            // Assign only on change so an unchanged batch keeps the same state.
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

/** Ids of downloads in progress (same reference until the list changes). */
export const selectDownloadingIds = (s: DownloaderState) => s.downloadingIds;
