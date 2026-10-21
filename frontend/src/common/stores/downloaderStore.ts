import { DownloadHistoryItem, DownloadProgressOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

export type DownloadItem = DownloadHistoryItem & DownloadProgressOutput;

interface DownloaderState {
  downloadItems: Record<string, DownloadItem>;
}

interface DownloaderAction {
  upsertDownloadItems: (inputs: DownloadHistoryItem[]) => void;
  setDownloadProgess: (input: DownloadProgressOutput) => void;
  reset: () => void;
}

const SCOPE = 'downloader';

export const useDownloaderStore = createAppStore<DownloaderState & DownloaderAction>(
  (set, get) => ({
    downloadItems: {},

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
        },
        undefined,
        `${SCOPE}/reset`
      );
    },
  }),
  SCOPE
);

export const selectDownloadingIds = (s: DownloaderState) =>
  Object.values(s.downloadItems)
    .filter(item => item.status === 'DOWNLOADING')
    .map(item => item.id);
