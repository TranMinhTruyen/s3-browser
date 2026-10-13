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
    // TODO: remove mock data after testing
    downloadItems: {
      // 'mock-1': {
      //   id: 'mock-1',
      //   downloadId: 'mock-1',
      //   fileName: 'report-2026.pdf',
      //   destPath: 'C:\\Users\\Downloads\\report-2026.pdf',
      //   status: 'DOWNLOADING',
      //   updatedAt: new Date().toISOString(),
      //   version: 1,
      //   downloaded: 35 * 1024 * 1024,
      //   total: 100 * 1024 * 1024,
      // },
      // 'mock-2': {
      //   id: 'mock-2',
      //   downloadId: 'mock-2',
      //   fileName: 'backup.zip',
      //   destPath: 'C:\\Users\\Downloads\\backup.zip',
      //   status: 'DOWNLOADING',
      //   updatedAt: new Date().toISOString(),
      //   version: 1,
      //   downloaded: 512 * 1024 * 1024,
      //   total: 512 * 1024 * 1024,
      // },
      // 'mock-3': {
      //   id: 'mock-3',
      //   downloadId: 'mock-3',
      //   fileName: 'video-with-a-very-long-file-name-for-testing-ellipsis.mp4',
      //   destPath: 'C:\\Users\\Downloads\\video-with-a-very-long-file-name-for-testing-ellipsis.mp4',
      //   status: 'DOWNLOADING',
      //   updatedAt: new Date().toISOString(),
      //   version: 1,
      //   downloaded: 120 * 1024 * 1024,
      //   total: 1024 * 1024 * 1024,
      // },
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
