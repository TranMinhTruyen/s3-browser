/** ID của các tab TableStructure đang có thay đổi hàng chưa lưu; đóng những tab này sẽ yêu cầu xác nhận. */
const dirtyTabs = new Set<string>();

export const setTableDirty = (tabId: string, dirty: boolean) => {
  if (dirty) dirtyTabs.add(tabId);
  else dirtyTabs.delete(tabId);
};

export const isTableDirty = (tabId: string) => dirtyTabs.has(tabId);
