import { UploadFinishedOutput, UploadProgressOutput, UploadStartedOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

export type UploadItem = UploadStartedOutput & {
  uploaded: number;
};

interface UploaderState {
  uploadItems: Record<string, UploadItem>;
  /** Ids already finished, so a late `started` event is ignored. Bounded by MAX_FINISHED_IDS. */
  finishedIds: string[];
}

interface UploaderAction {
  startUpload: (input: UploadStartedOutput) => void;
  setUploadProgress: (input: UploadProgressOutput) => void;
  finishUpload: (input: UploadFinishedOutput) => void;
  reset: () => void;
}

const SCOPE = 'uploader';
const MAX_FINISHED_IDS = 200;

export const useUploaderStore = createAppStore<UploaderState & UploaderAction>(
  set => ({
    uploadItems: {},
    finishedIds: [],

    startUpload: (input: UploadStartedOutput) => {
      set(
        state => {
          if (state.finishedIds.includes(input.uploadId)) return;
          state.uploadItems[input.uploadId] = { ...input, uploaded: 0 };
        },
        undefined,
        `${SCOPE}/startUpload`
      );
    },

    setUploadProgress: (input: UploadProgressOutput) => {
      set(
        state => {
          const item = state.uploadItems[input.uploadId];
          if (item) {
            item.uploaded = input.uploaded;
            // Progress may carry a more accurate total than the started event.
            if (input.total > 0) item.total = input.total;
          }
        },
        undefined,
        `${SCOPE}/setUploadProgress`
      );
    },

    finishUpload: (input: UploadFinishedOutput) => {
      set(
        state => {
          delete state.uploadItems[input.uploadId];
          state.finishedIds.push(input.uploadId);
          if (state.finishedIds.length > MAX_FINISHED_IDS) {
            state.finishedIds.splice(0, state.finishedIds.length - MAX_FINISHED_IDS);
          }
        },
        undefined,
        `${SCOPE}/finishUpload`
      );
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set({ uploadItems: {}, finishedIds: [] }, undefined, `${SCOPE}/reset`);
    },
  }),
  SCOPE
);

export const selectUploadingIds = (s: UploaderState) => Object.keys(s.uploadItems);
