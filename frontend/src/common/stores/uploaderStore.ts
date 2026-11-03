import { UploadFinishedOutput, UploadStartedOutput } from '@wails/S3Browser/models';
import { UploadProgressOutput } from '@wails/S3Browser/models/bucket';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

/** Running upload and the bytes sent so far. */
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
  setUploadProgressBatch: (items: UploadProgressOutput[]) => void;
  finishUpload: (input: UploadFinishedOutput) => void;
  reset: () => void;
}

const SCOPE = 'uploader';
const MAX_FINISHED_IDS = 200;

/** Running uploads and the ids already finished. */
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

    setUploadProgressBatch: (items: UploadProgressOutput[]) => {
      set(
        state => {
          for (const input of items) {
            const item = state.uploadItems[input.uploadId];
            if (!item) continue;
            // Assign only on change so an unchanged batch keeps the same state.
            if (item.uploaded !== input.uploaded) item.uploaded = input.uploaded;
            // Progress may carry a more accurate total than the started event.
            if (input.total > 0 && item.total !== input.total) item.total = input.total;
          }
        },
        undefined,
        `${SCOPE}/setUploadProgressBatch`
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

/** Ids of running uploads. Returns a new array: use with `useShallow`. */
export const selectUploadingIds = (s: UploaderState) => Object.keys(s.uploadItems);
