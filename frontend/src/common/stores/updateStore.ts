import {
  CheckUpdate,
  DownloadUpdate,
  GetUpdateState,
  InstallUpdate,
} from '@wails/S3Browser/internal/handlers/updatehandler';
import type { UpdateStateOutput } from '@wails/S3Browser/models';
import { createAppStore } from '@/common/stores/createStore';
import { selectDownloadingIds, useDownloaderStore } from '@/common/stores/downloaderStore';
import { selectUploadingIds, useUploaderStore } from '@/common/stores/uploaderStore';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';

/** `state` is idle, checking, upToDate, available, downloading, ready or error. */
type UpdateState = UpdateStateOutput;

interface UpdateAction {
  /** Reads the backend state (the feature is hidden until `supported` is true). */
  load: () => Promise<void>;
  /** Takes the state pushed by the `update:state-changed` event. */
  setState: (next: UpdateStateOutput) => void;
  /** Looks for a new release (the backend downloads it itself when auto update is on). */
  check: () => Promise<void>;
  /** Starts the download in the background; progress arrives through the event. */
  download: () => Promise<void>;
  /** After the user confirms, runs the installer; the app quits on success. */
  install: () => Promise<void>;
  reset: () => void;
}

const SCOPE = 'Update';

const INITIAL_STATE: UpdateState = { supported: false, state: 'idle', currentVersion: '', written: 0, total: 0 };

/** Self-update state mirrored from the backend. */
export const useUpdateStore = createAppStore<UpdateState & UpdateAction>(set => {
  const setState = (next: UpdateStateOutput | null | undefined, action: string) => {
    if (!next) return;
    const { supported, state, currentVersion, version, releaseUrl, written, total, errorCode } = next;
    set(
      { supported, state, currentVersion, version, releaseUrl, written, total, errorCode },
      undefined,
      `${SCOPE}/${action}`
    );
  };

  return {
    ...INITIAL_STATE,

    load: async () => {
      setState(await callIPC(GetUpdateState, [], { scope: `${SCOPE}/load`, showMessage: false }), 'load');
    },

    setState: next => setState(next, 'setState'),

    check: async () => {
      setState(await callIPC(CheckUpdate, [], { scope: `${SCOPE}/check` }), 'check');
    },

    download: async () => {
      setState(await callIPC(DownloadUpdate, [], { scope: `${SCOPE}/download` }), 'download');
    },

    install: async () => {
      const busy =
        selectUploadingIds(useUploaderStore.getState()).length +
        selectDownloadingIds(useDownloaderStore.getState()).length;
      const confirmed = await ConfirmModal.show({
        type: busy > 0 ? 'warning' : 'info',
        confirmCode: busy > 0 ? 'C000010' : 'C000009',
        params: { count: busy },
      });
      if (!confirmed) return;
      setState(await callIPC(InstallUpdate, [], { scope: `${SCOPE}/install` }), 'install');
    },

    reset: () => {
      invalidateLoads(SCOPE);
      set(
        { ...INITIAL_STATE, version: undefined, releaseUrl: undefined, errorCode: undefined },
        undefined,
        `${SCOPE}/reset`
      );
    },
  };
}, SCOPE);
