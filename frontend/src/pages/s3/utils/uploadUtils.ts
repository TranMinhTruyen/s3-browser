import { UploadObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DroppedGroup } from '@wails/S3Browser/models/bucket';
import { toast } from 'sonner';
import { callIPC } from '@/common/utils/ipcUtils';
import i18n from '@/locales/i18n';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/** A local file to upload and its object key relative to the target prefix. */
type UploadFile = { path: string; relKey: string };

export type RunUploadParams = {
  tabId: string;
  connectionId: string;
  profileName?: string;
  bucket: string;
  prefix: string;
  files: UploadFile[];
};

/** True when no upload is running; otherwise warns the user (only one upload runs at a time). */
export function ensureUploadIdle(): boolean {
  if (useTabListStore.getState().uploadingTabId === null) return true;
  toast.warning(i18n.t('ipcMessage:bucket.S3W005'));
  return false;
}

/**
 * Uploads the files and marks the tab as uploading meanwhile. `onDone` runs after the upload (e.g. a refresh),
 * while the tab is still marked. Does nothing when another upload is running.
 */
export async function runUpload(params: RunUploadParams, onDone?: () => Promise<void> | void): Promise<void> {
  const { tabId, connectionId, profileName, bucket, prefix, files } = params;
  if (!ensureUploadIdle()) return;

  const { setUploadingTab } = useTabListStore.getState();
  setUploadingTab(tabId);
  try {
    // The backend sends one success / canceled / error message per file, shown by callIPC.
    await callIPC(UploadObject, [
      { connectionId, profileName, bucket, prefix, objList: files.map(({ path, relKey }) => ({ path, relKey })) },
    ]);
    await onDone?.();
  } finally {
    setUploadingTab(null);
  }
}

/** Limits applied while building the upload picker list. */
export type PickerLimits = { maxFilesPerFolder: number; largeFileMaxCount: number; maxTotalFiles: number };

export type PickerList = { groups: DroppedGroup[]; selected: ReadonlySet<string> };

export type MergeResult = PickerList & {
  // Files were left out because the list reached maxTotalFiles.
  overTotal: boolean;
  // New files were added unticked because their group is full.
  autoUnselected: boolean;
};

/**
 * Adds the incoming groups to the list: files already listed (same path) are skipped, groups with the same name
 * are merged, the list is capped at maxTotalFiles, and new files are ticked in order until their group is full.
 */
export function mergePickedFiles(prev: PickerList, incoming: DroppedGroup[], limits: PickerLimits): MergeResult {
  const { maxFilesPerFolder, largeFileMaxCount, maxTotalFiles } = limits;
  const known = new Set(prev.groups.flatMap(group => group.files.map(file => file.path)));
  const filesByGroup = new Map(prev.groups.map(group => [group.name, [...group.files]]));
  const selected = new Set(prev.selected);
  const counts = new Map(
    prev.groups.map(group => {
      const ticked = group.files.filter(file => selected.has(file.path));
      return [group.name, { count: ticked.length, large: ticked.filter(file => file.isLarge).length }];
    })
  );
  let overTotal = false;
  let autoUnselected = false;

  for (const group of incoming) {
    for (const file of group.files) {
      if (known.has(file.path)) continue;
      if (known.size >= maxTotalFiles) {
        overTotal = true;
        continue;
      }
      known.add(file.path);
      // Lists in filesByGroup are copies, so pushing does not mutate the input.
      let groupFiles = filesByGroup.get(group.name);
      if (!groupFiles) {
        groupFiles = [];
        filesByGroup.set(group.name, groupFiles);
      }
      groupFiles.push(file);
      const stat = counts.get(group.name) ?? { count: 0, large: 0 };
      counts.set(group.name, stat);
      if (stat.count < maxFilesPerFolder && (!file.isLarge || stat.large < largeFileMaxCount)) {
        selected.add(file.path);
        stat.count++;
        if (file.isLarge) stat.large++;
      } else {
        autoUnselected = true;
      }
    }
  }

  const groups = [...filesByGroup].map(([name, files]) => {
    const largeCount = files.filter(file => file.isLarge).length;
    return {
      name,
      files,
      totalFiles: files.length,
      largeCount,
      overMaxFiles: files.length > maxFilesPerFolder,
      overLargeCount: largeCount > largeFileMaxCount,
    };
  });
  return { groups, selected, overTotal, autoUnselected };
}

/** Removes the files with the given paths from the list and the ticks; groups left empty are dropped. */
export function removePickedFiles(prev: PickerList, paths: readonly string[]): PickerList {
  const removed = new Set(paths);
  const selected = new Set([...prev.selected].filter(path => !removed.has(path)));
  const groups = prev.groups
    .map(group => {
      const files = group.files.filter(file => !removed.has(file.path));
      const largeCount = files.filter(file => file.isLarge).length;
      return { ...group, files, totalFiles: files.length, largeCount };
    })
    .filter(group => group.files.length > 0);
  return { groups, selected };
}
