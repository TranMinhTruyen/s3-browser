import { fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import type { GridEdit } from '@/components/display/dataGrid/useGridEdit';

/** Translated Copy items of the context menu, as the parents pass them to `DataGrid`. */
export const COPY = { copy: 'Copy', copyWithHeaders: 'Copy with headers' };

export const EDIT_LABELS = {
  setNull: 'Set NULL',
  deleteRows: 'Delete row',
  restoreRows: 'Restore row',
  rowNew: 'New row',
  rowEdited: 'Edited row',
  rowDeleted: 'Row to delete',
};

/** A `GridEdit` with spies for every callback. */
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

/** A click as the grid sees it: the selection starts on mouse down and a drag ends on mouse up. */
export const pick = (el: Element, init: MouseEventInit = {}) => {
  fireEvent.mouseDown(el, init);
  fireEvent.mouseUp(el, init);
};
