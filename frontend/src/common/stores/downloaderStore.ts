import { DownloadProgressOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

interface DownloaderState {
  downloadFiles: Partial<Record<string, DownloadProgressOutput>>;
}

interface DownloaderAction {
  setDownloadProgess: (input: DownloadProgressOutput) => void;
  reset: () => void;
}

const SCOPE = 'downloader';

export const useProfileStore = createAppStore<DownloaderState & DownloaderAction>(
  (set, get) => ({
    downloadFiles: {},

    setDownloadProgess: (input: DownloadProgressOutput) => {
      set(
        state => {
          state.downloadFiles[input.downloadId] = input;
        },
        undefined,
        `${SCOPE}/setDownloadProgess`
      );
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(
        {
          downloadFiles: {},
        },
        undefined,
        `${SCOPE}/reset`
      );
    },
  }),
  SCOPE
);
