import { fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import type { GridEdit } from '@/components/display/dataGrid/useGridEdit';

/** Các mục Copy đã dịch của menu ngữ cảnh, giống dữ liệu component cha truyền vào `DataGrid`. */
export const COPY = { copy: 'Copy', copyWithHeaders: 'Copy with headers' };

export const EDIT_LABELS = {
  setNull: 'Set NULL',
  deleteRows: 'Delete row',
  restoreRows: 'Restore row',
  rowNew: 'New row',
  rowEdited: 'Edited row',
  rowDeleted: 'Row to delete',
};

/** `GridEdit` có spy cho từng callback. */
export const makeGridEdit = (extra: Partial<GridEdit> = {}): GridEdit => ({
  newRows: [],
  edited: new Map(),
  deleted: new Set(),
  labels: EDIT_LABELS,
  onSetCell: vi.fn(),
  onSetCells: vi.fn(),
  onToggleDeleteRows: vi.fn(),
  onSelectionChange: vi.fn(),
  ...extra,
});

/** Mô phỏng click theo cách grid xử lý: vùng chọn bắt đầu khi nhấn chuột và thao tác kéo kết thúc khi thả chuột. */
export const pick = (el: Element, init: MouseEventInit = {}) => {
  fireEvent.mouseDown(el, init);
  fireEvent.mouseUp(el, init);
};
