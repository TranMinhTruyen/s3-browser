import { UploadFinishedOutput, UploadStartedOutput } from '@wails/S3Browser/models';
import { UploadProgressOutput } from '@wails/S3Browser/models/bucket';
import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

/** Lượt tải lên đang chạy và số byte đã gửi. */
type UploadItem = UploadStartedOutput & {
  uploaded: number;
};

interface UploaderState {
  uploadItems: Record<string, UploadItem>;
  /** Các id đã hoàn tất để bỏ qua event `started` đến muộn. Số lượng tối đa là MAX_FINISHED_IDS. */
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

/** Các lượt tải lên đang chạy và các id đã hoàn tất. */
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
            // Chỉ gán khi có thay đổi để batch không đổi giữ nguyên state.
            if (item.uploaded !== input.uploaded) item.uploaded = input.uploaded;
            // Event tiến độ có thể chứa tổng dung lượng chính xác hơn event bắt đầu.
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

/** Id của các lượt tải lên đang chạy. Trả về mảng mới: dùng cùng `useShallow`. */
export const selectUploadingIds = (s: UploaderState) => Object.keys(s.uploadItems);
