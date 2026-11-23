/** Ids of the TableStructure tabs that hold uncommitted row changes; closing such a tab asks for confirmation. */
const dirtyTabs = new Set<string>();

export const setTableDirty = (tabId: string, dirty: boolean) => {
  if (dirty) dirtyTabs.add(tabId);
  else dirtyTabs.delete(tabId);
};

export const isTableDirty = (tabId: string) => dirtyTabs.has(tabId);
