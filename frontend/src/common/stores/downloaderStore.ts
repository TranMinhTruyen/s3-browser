import { DownloadHistoryItem, DownloadProgressOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

/** Download history row merged with its live progress. */
export type DownloadItem = DownloadHistoryItem & DownloadProgressOutput;

interface DownloaderState {
  downloadItems: Record<string, DownloadItem>;
  windowVisible: boolean;
  /** Measured size of the visible downloader (window or button); 0 when not rendered. */
  windowSize: { width: number; height: number };
}

interface DownloaderAction {
  upsertDownloadItems: (inputs: DownloadHistoryItem[]) => void;
  setDownloadProgess: (input: DownloadProgressOutput) => void;
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
          }
        },
        undefined,
        `${SCOPE}/addDownloadItems`
      );
    },

    setDownloadProgess: (input: DownloadProgressOutput) => {
      set(
        state => {
          const item = state.downloadItems[input.downloadId];
          if (item) {
            item.downloaded = input.downloaded;
            item.total = input.total;
          }
        },
        undefined,
        `${SCOPE}/setDownloadProgess`
      );
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(
        {
          downloadItems: {},
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

/** Ids of downloads in progress. Returns a new array: use with `useShallow`. */
export const selectDownloadingIds = (s: DownloaderState) =>
  Object.values(s.downloadItems)
    .filter(item => item.status === 'DOWNLOADING')
    .map(item => item.id);
