import { createAppStore } from '@/common/stores/createStore';
import { invalidateLoads } from '@/common/utils/ipcUtils';

interface CommonState {}

interface CommonAction {
  reset: () => void;
}

const SCOPE = 'common';
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 480;

export const useCommonStore = createAppStore<CommonState & CommonAction>(
  (set, get) => ({
    reset: () => {
      invalidateLoads(SCOPE);
      set({}, undefined, `${SCOPE}/reset`);
    },
  }),
  SCOPE
);
