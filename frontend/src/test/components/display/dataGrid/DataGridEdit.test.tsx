import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import DataGrid from '@/components/display/dataGrid/DataGrid';
import type { GridEdit } from '@/components/display/dataGrid/useGridEdit';
import { COPY, makeGridEdit, pick } from '@/test/_helpers/dataGrid';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

type Options = {
  count: number;
  horizontal?: boolean;
  paddingStart?: number;
  estimateSize: (index?: number) => number;
  rangeExtractor?: (range: { startIndex: number; endIndex: number; overscan: number; count: number }) => number[];
};

// jsdom has no layout, so the virtualizers render every item unless a visible window is set.
const virtual = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  rowWindow: null as [number, number] | null,
  columnWindow: null as [number, number] | null,
}));

vi.mock('@tanstack/react-virtual', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-virtual')>('@tanstack/react-virtual');
  return {
    defaultRangeExtractor: actual.defaultRangeExtractor,
    useVirtualizer: (options: Options) => {
      const sizes = Array.from({ length: options.count }, (_, i) => options.estimateSize(i));
      const pad = options.paddingStart ?? 0;
      const win = options.horizontal ? virtual.columnWindow : virtual.rowWindow;
      const indexes =
        win && options.rangeExtractor
          ? options.rangeExtractor({ startIndex: win[0], endIndex: win[1], overscan: 0, count: options.count })
          : sizes.map((_, i) => i);
      const items = indexes.map(index => ({
        key: index,
        index,
        size: sizes[index],
        start: pad + sizes.slice(0, index).reduce((a, b) => a + b, 0),
      }));
      return {
        measure: vi.fn(),
        scrollToIndex: virtual.scrollToIndex,
        getVirtualItems: () => items,
        getTotalSize: () => pad + sizes.reduce((a, b) => a + b, 0),
      };
    },
  };
});

const columns = ['id', 'name', 'note'];
const rows: (string | null)[][] = [
  ['1', 'Ann', null],
  ['2', 'Bob', 'x'],
  ['3', 'Cat', 'y'],
  ['4', 'Dan', 'z'],
];

const onSetCell = vi.fn();
const onSetCells = vi.fn();
const onToggleDeleteRows = vi.fn();
const onSelectionChange = vi.fn();

const makeEdit = (extra: Partial<GridEdit> = {}): GridEdit =>
  makeGridEdit({ onSetCell, onSetCells, onToggleDeleteRows, onSelectionChange, ...extra });

type GridProps = React.ComponentProps<typeof DataGrid>;
const element = (extra: Partial<GridProps> = {}) => (
  <DataGrid columns={columns} rows={rows} nullText="NULL" copyLabels={COPY} edit={makeEdit()} {...extra} />
);
const renderGrid = (extra: Partial<GridProps> = {}) => renderWithProviders(element(extra));

const root = () => document.querySelector<HTMLElement>('[tabindex="0"]') as HTMLElement;
const cellAt = (row: number, col: number) =>
  document.querySelector<HTMLElement>(`[data-row="${row}"] [data-col="${col}"]`) as HTMLElement;
const rowEl = (row: number) => document.querySelector<HTMLElement>(`[data-row="${row}"]`) as HTMLElement;
const editor = () => document.querySelector<HTMLInputElement>('input');
const lastSelection = () => onSelectionChange.mock.calls.at(-1)?.[0];

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(root(), { key: k, ...init });

describe('DataGrid editable', () => {
  beforeEach(() => {
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS } });
    vi.clearAllMocks();
    virtual.rowWindow = null;
    virtual.columnWindow = null;
  });

  describe('without edit (read-only, as before)', () => {
    // Changed with the selection rework: a read-only grid is now a focus stop with row hooks so that cells, columns
    // and rows can be selected and copied; it still has no editor and no edit items in the menu.
    it('is a focus stop with row hooks for the selection, shows plain cells and has no editor', () => {
      renderWithProviders(<DataGrid columns={columns} rows={rows} nullText="NULL" copyLabels={COPY} />);
      expect(root()).toBeInTheDocument();
      expect(rowEl(0)).not.toBeNull();
      expect(screen.getByText('Ann')).toBeInTheDocument();
      expect(screen.getByText('NULL')).toBeInTheDocument();
      expect(editor()).toBeNull();
    });

    it('selects with the keyboard but does not edit on F2, typing, double click or Ctrl+0', () => {
      renderWithProviders(<DataGrid columns={columns} rows={rows} nullText="NULL" copyLabels={COPY} />);
      key('ArrowDown');
      expect(cellAt(0, 0).className).toContain('focused');
      key('F2');
      key('a');
      key('0', { ctrlKey: true });
      key('Delete');
      fireEvent.doubleClick(screen.getByText('Ann'));
      expect(editor()).toBeNull();
      expect(onSetCells).not.toHaveBeenCalled();
    });

    it('offers only the Copy items in the context menu', async () => {
      renderWithProviders(<DataGrid columns={columns} rows={rows} nullText="NULL" copyLabels={COPY} />);
      fireEvent.contextMenu(cellAt(0, 1), { clientX: 5, clientY: 5 });
      expect(await screen.findByText('Copy', undefined, { timeout: 2000 })).toBeInTheDocument();
      expect(screen.getByText('Copy with headers')).toBeInTheDocument();
      expect(screen.queryByText('Set NULL')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete row')).not.toBeInTheDocument();
    });
  });

  describe('rendering', () => {
    it('shows new rows first, numbered from 1, then the loaded rows', () => {
      renderGrid({ edit: makeEdit({ newRows: [['n1', 'n2', null]] }) });
      expect(rowEl(0).className).toContain('rowNew');
      expect(cellAt(0, -1)).toHaveTextContent('1');
      expect(cellAt(0, -1)).toHaveAttribute('title', 'New row');
      expect(cellAt(0, 0)).toHaveTextContent('n1');
      expect(cellAt(1, 0)).toHaveTextContent('1');
      expect(cellAt(1, -1)).toHaveTextContent('2');
      expect(cellAt(1, -1)).not.toHaveAttribute('title');
    });

    it('shows the edited value, marks the edited cell and row, and a NULL edit as NULL', () => {
      const edited = new Map([
        [
          1,
          new Map<number, string | null>([
            [1, 'Bobby'],
            [2, null],
          ]),
        ],
      ]);
      renderGrid({ edit: makeEdit({ edited }) });
      expect(cellAt(1, 1)).toHaveTextContent('Bobby');
      expect(cellAt(1, 1).className).toContain('cellEdited');
      expect(cellAt(1, 2)).toHaveTextContent('NULL');
      expect(cellAt(1, 2).className).toContain('null');
      expect(cellAt(1, 0).className).not.toContain('cellEdited');
      expect(rowEl(1).className).toContain('rowEdited');
      expect(cellAt(1, -1)).toHaveAttribute('title', 'Edited row');
      expect(rowEl(0).className).not.toContain('rowEdited');
    });

    it('marks a deleted row, also when it is edited', () => {
      const edited = new Map([[2, new Map<number, string | null>([[1, 'x']])]]);
      renderGrid({ edit: makeEdit({ deleted: new Set([2]), edited }) });
      expect(rowEl(2).className).toContain('rowDeleted');
      expect(rowEl(2).className).not.toContain('rowEdited');
      expect(cellAt(2, -1)).toHaveAttribute('title', 'Row to delete');
    });

    it('keeps long values short in the cell and in the tooltip', () => {
      renderGrid({ rows: [['1', 'ab'.repeat(5000), 'x']] });
      expect(cellAt(0, 1).textContent).toHaveLength(200);
      expect(cellAt(0, 1).getAttribute('title')).toHaveLength(1000);
      expect(cellAt(0, 2).getAttribute('title')).toBe('x');
    });

    it('does not ask for more rows because of the new rows', () => {
      const onEndReached = vi.fn();
      renderGrid({ rows: Array.from({ length: 40 }, (_, i) => [String(i), 'a', 'b']), hasMore: true, onEndReached });
      expect(onEndReached).toHaveBeenCalledTimes(1);
    });
  });

  describe('selecting', () => {
    // Changed: a single cell no longer tints its whole row (class `selected`), it only gets `focused`.
    it('selects a cell on mouse down (not on click) and reports its row without tinting the row', () => {
      renderGrid();
      expect(lastSelection()).toEqual([]);
      fireEvent.click(cellAt(1, 1));
      expect(lastSelection()).toEqual([]);
      pick(cellAt(1, 1));
      expect(cellAt(1, 1).className).toContain('focused');
      expect(rowEl(1).className).not.toContain('selected');
      expect(lastSelection()).toEqual([1]);
    });

    it('does nothing when the click is outside the cells (header)', () => {
      renderGrid();
      fireEvent.click(screen.getByText('name'));
      expect(lastSelection()).toEqual([]);
    });

    it('selects a row with the row number cell, and Shift selects the range from the anchor', () => {
      renderGrid();
      pick(cellAt(1, 0));
      pick(cellAt(3, -1), { shiftKey: true });
      expect(lastSelection()).toEqual([1, 2, 3]);
      expect(rowEl(2).className).toContain('selected');
      expect(cellAt(1, 0).className).not.toContain('focused');
      pick(cellAt(0, -1), { shiftKey: true });
      expect(lastSelection()).toEqual([0, 1]);
    });

    it('a plain click on a row number selects only that row', () => {
      renderGrid();
      pick(cellAt(0, -1));
      pick(cellAt(2, -1), { shiftKey: true });
      pick(cellAt(3, -1));
      expect(lastSelection()).toEqual([3]);
    });

    it('Ctrl+click on a row number adds and removes rows; the active cell row counts first', () => {
      renderGrid();
      pick(cellAt(0, 1));
      pick(cellAt(2, -1), { ctrlKey: true });
      expect(lastSelection()).toEqual([0, 2]);
      pick(cellAt(3, -1), { metaKey: true });
      expect(lastSelection()).toEqual([0, 2, 3]);
      pick(cellAt(0, -1), { ctrlKey: true });
      expect(lastSelection()).toEqual([2, 3]);
    });

    it('Ctrl+click on a row number without any selection selects that row', () => {
      renderGrid();
      pick(cellAt(1, -1), { ctrlKey: true });
      expect(lastSelection()).toEqual([1]);
    });

    it('a cell click clears the row selection', () => {
      renderGrid();
      pick(cellAt(1, -1));
      pick(cellAt(3, 2));
      expect(lastSelection()).toEqual([3]);
      expect(cellAt(3, 2).className).toContain('focused');
    });

    it('drops the selected cell when the rows are replaced by fewer rows', () => {
      const { rerender } = renderGrid();
      pick(cellAt(3, 0));
      rerender(element({ rows: rows.slice(0, 2) }));
      expect(lastSelection()).toEqual([]);
    });
  });

  describe('keyboard on the grid', () => {
    it('the first arrow selects the first cell, next arrows move and are clamped', () => {
      renderGrid();
      key('ArrowRight');
      expect(cellAt(0, 0).className).toContain('focused');
      expect(virtual.scrollToIndex).toHaveBeenCalledWith(0);
      key('ArrowDown');
      key('ArrowRight');
      expect(cellAt(1, 1).className).toContain('focused');
      key('ArrowUp');
      key('ArrowUp');
      key('ArrowLeft');
      key('ArrowLeft');
      expect(cellAt(0, 0).className).toContain('focused');
      for (let i = 0; i < 6; i++) key('ArrowDown');
      for (let i = 0; i < 6; i++) key('ArrowRight');
      expect(cellAt(3, 2).className).toContain('focused');
    });

    it('an arrow clears the row selection', () => {
      renderGrid();
      pick(cellAt(1, -1));
      key('ArrowDown');
      expect(lastSelection()).toEqual([2]);
    });

    it('prevents the default of arrows only', () => {
      renderGrid();
      expect(key('ArrowDown')).toBe(false);
      expect(key('Shift')).toBe(true);
    });

    it('ignores keys without a selected cell (except arrows)', () => {
      renderGrid();
      key('F2');
      key('a');
      key('0', { ctrlKey: true });
      expect(editor()).toBeNull();
      expect(onSetCell).not.toHaveBeenCalled();
    });

    it('ignores keys when the grid has no rows', () => {
      renderGrid({ rows: [] });
      key('ArrowDown');
      expect(onSelectionChange).toHaveBeenLastCalledWith([]);
    });

    it('ignores keys that come from a child element', () => {
      renderGrid();
      pick(cellAt(0, 0));
      fireEvent.keyDown(cellAt(0, 0), { key: 'F2' });
      expect(editor()).toBeNull();
    });

    it('F2 opens the editor with the current text, caret at the end', () => {
      renderGrid();
      pick(cellAt(1, 1));
      key('F2');
      expect(editor()).toHaveValue('Bob');
      expect(editor()).toHaveFocus();
      expect(editor()?.selectionStart).toBe(3);
    });

    it('opens the editor of a NULL cell empty', () => {
      renderGrid();
      pick(cellAt(0, 2));
      key('F2');
      expect(editor()).toHaveValue('');
    });

    it('typing a character opens the editor with that character; Ctrl, Alt, Meta and named keys do not', () => {
      renderGrid();
      pick(cellAt(1, 1));
      expect(key('Enter')).toBe(true);
      key('q', { ctrlKey: true });
      key('q', { altKey: true });
      key('q', { metaKey: true });
      expect(editor()).toBeNull();
      expect(key('z')).toBe(false);
      expect(editor()).toHaveValue('z');
    });

    it('Ctrl+0 and Cmd+0 set the cell to NULL (via onSetCells); Ctrl+other does not', () => {
      renderGrid();
      pick(cellAt(1, 1));
      key('0', { ctrlKey: true });
      expect(onSetCells).toHaveBeenLastCalledWith([1], [1], null);
      key('0', { metaKey: true });
      expect(onSetCells).toHaveBeenCalledTimes(2);
      key('1', { ctrlKey: true });
      expect(onSetCells).toHaveBeenCalledTimes(2);
      expect(onSetCell).not.toHaveBeenCalled();
    });

    it('does not open the editor on a deleted row (Ctrl+0 is passed on, onSetCells skips deleted rows)', () => {
      renderGrid({ edit: makeEdit({ deleted: new Set([1]) }) });
      pick(cellAt(1, 1));
      key('F2');
      key('x');
      key('0', { ctrlKey: true });
      expect(editor()).toBeNull();
      expect(onSetCell).not.toHaveBeenCalled();
    });

    it('a new row is never deleted', () => {
      renderGrid({ edit: makeEdit({ newRows: [['a', 'b', 'c']], deleted: new Set([0]) }) });
      pick(cellAt(0, 0));
      key('F2');
      expect(editor()).toHaveValue('a');
    });
  });

  describe('editor', () => {
    const open = (row = 1, col = 1) => {
      pick(cellAt(row, col));
      key('F2');
      return editor() as HTMLInputElement;
    };

    it('double click on a cell opens the editor; on a row number or the header it does not', () => {
      renderGrid();
      fireEvent.doubleClick(cellAt(1, -1));
      fireEvent.doubleClick(screen.getByText('name'));
      expect(editor()).toBeNull();
      fireEvent.doubleClick(cellAt(2, 1));
      expect(editor()).toHaveValue('Cat');
      expect(cellAt(2, 1).querySelector('input')).not.toBeNull();
    });

    it('Enter saves a changed text and returns the focus to the grid', () => {
      renderGrid();
      const input = open();
      fireEvent.change(input, { target: { value: 'Bobby' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledTimes(1);
      expect(onSetCell).toHaveBeenCalledWith(1, 1, 'Bobby');
      expect(editor()).toBeNull();
      expect(root()).toHaveFocus();
    });

    it('Enter with the same text saves nothing', () => {
      renderGrid();
      fireEvent.keyDown(open(), { key: 'Enter' });
      expect(onSetCell).not.toHaveBeenCalled();
      expect(editor()).toBeNull();
    });

    it('saves an emptied text as an empty string, not NULL', () => {
      renderGrid();
      const input = open();
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledWith(1, 1, '');
    });

    it('Escape discards the text', () => {
      renderGrid();
      const input = open();
      fireEvent.change(input, { target: { value: 'zzz' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onSetCell).not.toHaveBeenCalled();
      expect(editor()).toBeNull();
      expect(root()).toHaveFocus();
    });

    it('other keys stay inside the editor', () => {
      renderGrid();
      const input = open();
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(editor()).toBe(input);
      expect(cellAt(2, 1).className).not.toContain('focused');
    });

    it('typed key opens the editor with that character as the text; saving it counts as a change', () => {
      renderGrid();
      pick(cellAt(1, 1));
      key('x');
      fireEvent.keyDown(editor() as Element, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledWith(1, 1, 'x');
    });

    it('Tab saves and moves to the next cell, Shift+Tab to the previous, wrapping across rows', () => {
      renderGrid();
      let input = open(0, 2);
      fireEvent.change(input, { target: { value: 'q' } });
      expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
      expect(onSetCell).toHaveBeenCalledWith(0, 2, 'q');
      expect(cellAt(1, 0).className).toContain('focused');
      expect(root()).toHaveFocus();

      input = open(1, 0);
      fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
      expect(cellAt(0, 2).className).toContain('focused');
    });

    it('Tab does not move past the first or the last cell', () => {
      renderGrid();
      fireEvent.keyDown(open(0, 0), { key: 'Tab', shiftKey: true });
      expect(cellAt(0, 0).className).toContain('focused');
      fireEvent.keyDown(open(3, 2), { key: 'Tab' });
      expect(cellAt(3, 2).className).toContain('focused');
    });

    it('blur saves a changed text without stealing the focus back', () => {
      renderGrid();
      const input = open();
      fireEvent.change(input, { target: { value: 'Bo' } });
      fireEvent.blur(input);
      expect(onSetCell).toHaveBeenCalledWith(1, 1, 'Bo');
      expect(editor()).toBeNull();
      expect(root()).not.toHaveFocus();
    });

    it('blur with the same text saves nothing', () => {
      renderGrid();
      fireEvent.blur(open());
      expect(onSetCell).not.toHaveBeenCalled();
    });

    it('saves only once when Enter is followed by the blur of the removed input', () => {
      renderGrid();
      const input = open();
      fireEvent.change(input, { target: { value: 'Bo' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
      expect(onSetCell).toHaveBeenCalledTimes(1);
    });

    it('saves only once when Escape is followed by a blur', () => {
      renderGrid();
      const input = open();
      fireEvent.change(input, { target: { value: 'Bo' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.blur(input);
      expect(onSetCell).not.toHaveBeenCalled();
    });

    it('clicking inside the open editor keeps it; clicking another cell closes it by blur and selects it', () => {
      renderGrid();
      const input = open();
      fireEvent.click(input);
      expect(editor()).toBe(input);
      fireEvent.change(input, { target: { value: 'Bo' } });
      fireEvent.blur(input);
      pick(cellAt(2, 0));
      expect(onSetCell).toHaveBeenCalledWith(1, 1, 'Bo');
      expect(cellAt(2, 0).className).toContain('focused');
    });

    it('edits the displayed (already edited) text of a cell', () => {
      const edited = new Map([[1, new Map<number, string | null>([[1, 'Bobby']])]]);
      renderGrid({ edit: makeEdit({ edited }) });
      expect(open()).toHaveValue('Bobby');
    });

    it('edits a new row', () => {
      renderGrid({ edit: makeEdit({ newRows: [['a', 'b', null]] }) });
      const input = open(0, 1);
      expect(input).toHaveValue('b');
      fireEvent.change(input, { target: { value: 'c' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledWith(0, 1, 'c');
    });
  });

  describe('new rows', () => {
    it('opens the editor on the first cell of a new row and scrolls to the top left', () => {
      const { rerender } = renderGrid();
      root().scrollTop = 50;
      root().scrollLeft = 30;
      rerender(element({ edit: makeEdit({ newRows: [[null, null, null]] }) }));
      expect(cellAt(0, 0).querySelector('input')).toHaveFocus();
      expect(root().scrollTop).toBe(0);
      expect(root().scrollLeft).toBe(0);
      expect(rowEl(0).className).toContain('rowNew');
    });

    it('clears the selection when new rows are removed or rolled back', () => {
      const { rerender } = renderGrid();
      rerender(element({ edit: makeEdit({ newRows: [[null, null, null]] }) }));
      fireEvent.keyDown(editor() as Element, { key: 'Escape' });
      pick(cellAt(2, 0));
      expect(lastSelection()).toEqual([2]);
      rerender(element());
      expect(lastSelection()).toEqual([]);
      expect(document.querySelector('[class*="focused"]')).toBeNull();
    });

    it('does not open an editor when the number of new rows does not change', () => {
      const { rerender } = renderGrid();
      rerender(element({ edit: makeEdit() }));
      expect(editor()).toBeNull();
    });
  });

  describe('context menu', () => {
    const menu = async (target: HTMLElement) => {
      fireEvent.contextMenu(target, { clientX: 5, clientY: 5 });
      return screen.findByText('Set NULL', undefined, { timeout: 2000 });
    };

    it('right click on a cell selects it and offers Set NULL and Delete row', async () => {
      renderGrid();
      await menu(cellAt(2, 1));
      expect(cellAt(2, 1).className).toContain('focused');
      expect(screen.getByText('Delete row')).toBeInTheDocument();
      expect(screen.queryByText('Restore row')).not.toBeInTheDocument();
    });

    it('Set NULL sets the cell under the pointer (outside the selection) to NULL', async () => {
      renderGrid();
      pick(cellAt(2, 1));
      fireEvent.click(await menu(cellAt(1, 2)));
      expect(onSetCells).toHaveBeenCalledExactlyOnceWith([1], [2], null);
    });

    it('Set NULL on a deleted row is passed on: skipping deleted rows is up to onSetCells', async () => {
      renderGrid({ edit: makeEdit({ deleted: new Set([1]) }) });
      fireEvent.click(await menu(cellAt(1, 2)));
      expect(onSetCells).toHaveBeenCalledExactlyOnceWith([1], [2], null);
    });

    it('Delete row toggles the selected row', async () => {
      renderGrid();
      await menu(cellAt(2, 1));
      fireEvent.click(screen.getByText('Delete row'));
      expect(onToggleDeleteRows).toHaveBeenCalledWith([2]);
    });

    it('a right click inside the row selection keeps it and deletes all selected rows', async () => {
      renderGrid();
      pick(cellAt(0, -1));
      pick(cellAt(2, -1), { shiftKey: true });
      await menu(cellAt(1, 1));
      expect(lastSelection()).toEqual([0, 1, 2]);
      fireEvent.click(screen.getByText('Delete row'));
      expect(onToggleDeleteRows).toHaveBeenCalledWith([0, 1, 2]);
    });

    it('a right click outside the row selection selects the cell instead', async () => {
      renderGrid();
      pick(cellAt(0, -1));
      pick(cellAt(1, -1), { shiftKey: true });
      await menu(cellAt(3, 0));
      expect(lastSelection()).toEqual([3]);
    });

    it('offers Restore row when every selected row is a deleted loaded row', async () => {
      renderGrid({ edit: makeEdit({ deleted: new Set([1]) }) });
      await menu(cellAt(1, 0));
      expect(screen.getByText('Restore row')).toBeInTheDocument();
      expect(screen.queryByText('Delete row')).not.toBeInTheDocument();
    });

    it('offers Delete row when the selected row is a new row', async () => {
      const { rerender } = renderGrid();
      rerender(element({ edit: makeEdit({ newRows: [['a', 'b', 'c']] }) }));
      fireEvent.keyDown(editor() as Element, { key: 'Escape' });
      await menu(cellAt(0, 1));
      expect(screen.getByText('Delete row')).toBeInTheDocument();
    });

    it('right click on a row number or the header opens no menu and keeps the browser default off', () => {
      renderGrid();
      expect(fireEvent.contextMenu(cellAt(1, -1))).toBe(false);
      expect(fireEvent.contextMenu(screen.getByText('name'))).toBe(false);
      expect(screen.queryByText('Set NULL')).not.toBeInTheDocument();
    });

    it('closes the menu when the grid scrolls, and ignores scrolling while closed', async () => {
      renderGrid();
      fireEvent.scroll(root());
      await menu(cellAt(1, 1));
      fireEvent.scroll(root());
      await waitFor(() => expect(screen.queryByText('Set NULL')).not.toBeVisible());
    });

    it('Set NULL fills every cell of the selected rectangle in one call', async () => {
      renderGrid();
      pick(cellAt(0, 0));
      pick(cellAt(1, 1), { shiftKey: true });
      fireEvent.click(await menu(cellAt(1, 1)));
      expect(onSetCells).toHaveBeenCalledExactlyOnceWith([0, 1], [0, 1], null);
    });
  });

  describe('NULL cell and empty text', () => {
    const openNull = () => {
      pick(cellAt(0, 2));
      key('F2');
      return editor() as HTMLInputElement;
    };

    it('F2 then Enter on a NULL cell without typing keeps it NULL', () => {
      renderGrid();
      fireEvent.keyDown(openNull(), { key: 'Enter' });
      expect(onSetCell).not.toHaveBeenCalled();
      expect(editor()).toBeNull();
    });

    it('an input event with an empty text on a NULL cell saves an empty string', () => {
      renderGrid();
      const input = openNull();
      fireEvent.input(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledExactlyOnceWith(0, 2, '');
    });

    it('typing a character on a NULL cell and erasing it saves an empty string', () => {
      renderGrid();
      pick(cellAt(0, 2));
      key('a');
      const input = editor() as HTMLInputElement;
      expect(input).toHaveValue('a');
      fireEvent.input(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledExactlyOnceWith(0, 2, '');
    });

    it('typing text on a NULL cell and erasing it saves an empty string', () => {
      renderGrid();
      const input = openNull();
      fireEvent.input(input, { target: { value: 'abc' } });
      fireEvent.input(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledExactlyOnceWith(0, 2, '');
    });

    it('a NULL cell given a text saves that text', () => {
      renderGrid();
      const input = openNull();
      fireEvent.input(input, { target: { value: 'abc' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledExactlyOnceWith(0, 2, 'abc');
    });

    it('an untouched NULL cell closed by blur stays NULL', () => {
      renderGrid();
      fireEvent.blur(openNull());
      expect(onSetCell).not.toHaveBeenCalled();
    });

    it('the typed flag does not leak into the next edit of a NULL cell', () => {
      renderGrid();
      pick(cellAt(1, 1));
      key('F2');
      fireEvent.input(editor() as Element, { target: { value: 'Bo' } });
      fireEvent.keyDown(editor() as Element, { key: 'Escape' });
      fireEvent.keyDown(openNull(), { key: 'Enter' });
      expect(onSetCell).not.toHaveBeenCalled();
    });
  });

  describe('Ctrl+C copy', () => {
    const writeText = vi.fn();
    const setClipboard = (value: unknown) =>
      Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

    beforeEach(() => {
      writeText.mockReset().mockResolvedValue(undefined);
      setClipboard({ writeText });
    });

    it('copies the selected cell text, prevents the default and does not open the editor', () => {
      renderGrid();
      pick(cellAt(1, 1));
      expect(key('c', { ctrlKey: true })).toBe(false);
      expect(writeText).toHaveBeenCalledExactlyOnceWith('Bob');
      expect(editor()).toBeNull();
    });

    it('copies an empty text for a NULL cell, and Cmd+C works as well', () => {
      renderGrid();
      pick(cellAt(0, 2));
      key('C', { metaKey: true });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('');
    });

    it('copies the pending edit of the cell', () => {
      const edited = new Map([[1, new Map<number, string | null>([[1, 'Bobby']])]]);
      renderGrid({ edit: makeEdit({ edited }) });
      pick(cellAt(1, 1));
      key('c', { ctrlKey: true });
      expect(writeText).toHaveBeenCalledWith('Bobby');
    });

    it('does nothing without a selected cell', () => {
      renderGrid();
      expect(key('c', { ctrlKey: true })).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('a rejected clipboard write is ignored without a console error', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      writeText.mockRejectedValue(new Error('denied'));
      renderGrid();
      pick(cellAt(1, 1));
      key('c', { ctrlKey: true });
      await act(async () => {});
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      error.mockRestore();
      warn.mockRestore();
    });

    it('does not throw when the clipboard API is missing', () => {
      setClipboard(undefined);
      renderGrid();
      pick(cellAt(1, 1));
      expect(key('c', { ctrlKey: true })).toBe(false);
      expect(editor()).toBeNull();
    });
  });

  describe('selection and IME details', () => {
    it('Ctrl+click on the only selected row leaves no row selected', () => {
      renderGrid();
      pick(cellAt(1, -1));
      expect(lastSelection()).toEqual([1]);
      pick(cellAt(1, -1), { ctrlKey: true });
      expect(lastSelection()).toEqual([]);
      expect(rowEl(1).className).not.toContain('selected');
      expect(document.querySelector('[class*="focused"]')).toBeNull();
    });

    it('Ctrl+click on the row of the active cell (no row selection) leaves nothing selected', () => {
      renderGrid();
      pick(cellAt(2, 1));
      pick(cellAt(2, -1), { ctrlKey: true });
      expect(lastSelection()).toEqual([]);
      expect(document.querySelector('[class*="focused"]')).toBeNull();
    });

    it("the 'Process' key opens an empty editor and is not prevented", () => {
      renderGrid();
      pick(cellAt(1, 1));
      expect(key('Process')).toBe(true);
      expect(editor()).toHaveValue('');
      expect(editor()).toHaveFocus();
    });

    it("the 'Process' key on a deleted row opens nothing", () => {
      renderGrid({ edit: makeEdit({ deleted: new Set([1]) }) });
      pick(cellAt(1, 1));
      key('Process');
      expect(editor()).toBeNull();
    });

    it('double click on the cell being edited does not reopen it and keeps the typed text', () => {
      renderGrid();
      pick(cellAt(1, 1));
      key('F2');
      const input = editor() as HTMLInputElement;
      fireEvent.input(input, { target: { value: 'typed' } });
      fireEvent.doubleClick(input);
      expect(editor()).toBe(input);
      expect(input).toHaveValue('typed');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledExactlyOnceWith(1, 1, 'typed');
    });
  });

  describe('editing cell stays mounted out of the visible range', () => {
    it('keeps the input and its text when the row and column leave the window; Enter saves that cell', () => {
      virtual.rowWindow = [0, 1];
      virtual.columnWindow = [0, 0];
      const { rerender } = renderGrid();
      expect(rowEl(3)).toBeNull();
      expect(cellAt(0, 1)).toBeNull();
      pick(cellAt(1, 0));
      key('F2');
      const input = editor() as HTMLInputElement;
      fireEvent.input(input, { target: { value: 'typed' } });
      virtual.rowWindow = [2, 3];
      virtual.columnWindow = [1, 2];
      rerender(element());
      expect(editor()).toBe(input);
      expect(input).toHaveValue('typed');
      expect(rowEl(0)).toBeNull();
      expect(rowEl(1)).not.toBeNull();
      expect(rowEl(2)).not.toBeNull();
      // The edited column stays rendered in the other rows too; the others are not.
      expect(cellAt(2, 0)).not.toBeNull();
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSetCell).toHaveBeenCalledExactlyOnceWith(1, 0, 'typed');
      // The editor is closed: the row is released and drops out of the window.
      rerender(element());
      expect(rowEl(1)).toBeNull();
    });

    it('pins a cell opened by double click when the window moves away', () => {
      virtual.rowWindow = [0, 1];
      virtual.columnWindow = [0, 0];
      const { rerender } = renderGrid();
      fireEvent.doubleClick(cellAt(1, 0));
      virtual.rowWindow = [2, 3];
      virtual.columnWindow = [2, 2];
      rerender(element());
      expect(rowEl(1)).not.toBeNull();
      expect(cellAt(1, 0).querySelector('input')).not.toBeNull();
    });

    it('does not duplicate the pinned row while it is inside the window', () => {
      virtual.rowWindow = [0, 2];
      virtual.columnWindow = [0, 2];
      renderGrid();
      pick(cellAt(1, 1));
      key('F2');
      expect(document.querySelectorAll('[data-row="1"]')).toHaveLength(1);
      expect(document.querySelectorAll('[data-row="1"] input')).toHaveLength(1);
    });

    it('a read-only grid pins nothing: only the window is rendered', () => {
      virtual.rowWindow = [0, 1];
      virtual.columnWindow = [0, 1];
      renderWithProviders(<DataGrid columns={columns} rows={rows} nullText="NULL" copyLabels={COPY} />);
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.queryByText('Cat')).not.toBeInTheDocument();
      expect(screen.queryByText('note')).not.toBeInTheDocument();
    });
  });

  describe('selecting columns, rectangles and rows', () => {
    const headerEl = (name: string) => screen.getByText(name);
    const selected = (el: HTMLElement) => el.className.includes('selected');

    it('a header click selects the column: header and cells are marked, no row is selected', () => {
      renderGrid();
      fireEvent.mouseDown(headerEl('name'));
      expect(selected(headerEl('name'))).toBe(true);
      expect(selected(headerEl('id'))).toBe(false);
      for (let row = 0; row < rows.length; row++) {
        expect(selected(cellAt(row, 1))).toBe(true);
        expect(selected(cellAt(row, 0))).toBe(false);
      }
      expect(lastSelection()).toEqual([]);
    });

    it('Ctrl+click on a header adds a column, Shift+click selects the columns between', () => {
      renderGrid();
      fireEvent.mouseDown(headerEl('id'));
      fireEvent.mouseDown(headerEl('note'), { ctrlKey: true });
      expect([0, 1, 2].map(c => selected(cellAt(0, c)))).toEqual([true, false, true]);
      fireEvent.mouseDown(headerEl('id'), { shiftKey: true }); // from the anchor (the last clicked column)
      expect([0, 1, 2].map(c => selected(cellAt(0, c)))).toEqual([true, true, true]);
    });

    it('a mouse down on the column resizer neither selects the column nor starts anything', () => {
      renderGrid();
      pick(cellAt(1, 1));
      fireEvent.mouseDown(document.querySelector('[data-resizer]') as Element);
      expect(selected(headerEl('id'))).toBe(false);
      expect(cellAt(1, 1).className).toContain('focused');
    });

    it('a mouse down in the open editor keeps the editor and the selection', () => {
      renderGrid();
      pick(cellAt(1, 1));
      key('F2');
      fireEvent.mouseDown(editor() as Element);
      expect(editor()).not.toBeNull();
    });

    it('Shift+click marks the rectangle of cells, not the rows', () => {
      renderGrid();
      pick(cellAt(0, 0));
      pick(cellAt(1, 1), { shiftKey: true });
      expect(selected(cellAt(0, 0))).toBe(true);
      expect(selected(cellAt(1, 1))).toBe(true);
      expect(selected(cellAt(0, 2))).toBe(false);
      expect(selected(cellAt(2, 0))).toBe(false);
      expect(selected(rowEl(0))).toBe(false);
      expect(lastSelection()).toEqual([1]);
    });

    it('Ctrl+0 sets the whole selection to NULL and Delete to an empty text, in one call', () => {
      renderGrid();
      pick(cellAt(0, 0));
      pick(cellAt(1, 1), { shiftKey: true });
      key('0', { ctrlKey: true });
      expect(onSetCells).toHaveBeenLastCalledWith([0, 1], [0, 1], null);
      key('Delete');
      expect(onSetCells).toHaveBeenLastCalledWith([0, 1], [0, 1], '');
      expect(onSetCell).not.toHaveBeenCalled();
    });

    it('Delete and Ctrl+0 on selected columns fill every row of them', () => {
      renderGrid();
      fireEvent.mouseDown(headerEl('note'));
      key('Delete');
      expect(onSetCells).toHaveBeenLastCalledWith([0, 1, 2, 3], [2], '');
      key('0', { ctrlKey: true });
      expect(onSetCells).toHaveBeenLastCalledWith([0, 1, 2, 3], [2], null);
    });

    it('Delete and Ctrl+0 on selected rows fill every column of them', () => {
      renderGrid();
      pick(cellAt(1, -1));
      pick(cellAt(2, -1), { shiftKey: true });
      expect(selected(rowEl(1))).toBe(true);
      key('Delete');
      expect(onSetCells).toHaveBeenLastCalledWith([1, 2], [0, 1, 2], '');
    });

    it('Delete does nothing without a selection or on a read-only grid', () => {
      renderGrid();
      key('Delete');
      expect(onSetCells).not.toHaveBeenCalled();
      const { unmount } = renderWithProviders(
        <DataGrid columns={columns} rows={rows} nullText="NULL" copyLabels={COPY} />
      );
      unmount();
      pick(cellAt(0, 0));
      key('Delete');
      expect(onSetCells).toHaveBeenCalledTimes(1);
    });

    it('the Set NULL menu item fills the selected columns', async () => {
      renderGrid();
      fireEvent.mouseDown(headerEl('name'));
      fireEvent.contextMenu(cellAt(1, 1), { clientX: 5, clientY: 5 });
      fireEvent.click(await screen.findByText('Set NULL', undefined, { timeout: 2000 }));
      expect(onSetCells).toHaveBeenCalledExactlyOnceWith([0, 1, 2, 3], [1], null);
    });

    it('reports no rows for a column selection and the row of the cell for a cell selection', () => {
      renderGrid();
      pick(cellAt(2, 1));
      expect(lastSelection()).toEqual([2]);
      fireEvent.mouseDown(headerEl('id'));
      expect(lastSelection()).toEqual([]);
    });
  });

  describe('Copy items of the context menu', () => {
    const writeText = vi.fn();
    beforeEach(() => {
      writeText.mockReset().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });
    const open = async (target: HTMLElement) => {
      fireEvent.contextMenu(target, { clientX: 5, clientY: 5 });
      return screen.findByText(COPY.copy, undefined, { timeout: 2000 });
    };

    it('Copy copies the cell under the pointer and Copy with headers adds the column names', async () => {
      renderGrid();
      fireEvent.click(await open(cellAt(1, 1)));
      expect(writeText).toHaveBeenLastCalledWith('Bob');
      fireEvent.contextMenu(cellAt(1, 1), { clientX: 5, clientY: 5 });
      fireEvent.click(await screen.findByText(COPY.copyWithHeaders, undefined, { timeout: 2000 }));
      expect(writeText).toHaveBeenLastCalledWith('name\nBob');
    });

    it('copies the whole selection when the right click is inside it, with the pending edits', async () => {
      const edited = new Map([[1, new Map<number, string | null>([[1, 'Bobby']])]]);
      renderGrid({ edit: makeEdit({ edited }) });
      pick(cellAt(0, 0));
      pick(cellAt(1, 1), { shiftKey: true });
      fireEvent.click(await open(cellAt(0, 1)));
      expect(writeText).toHaveBeenLastCalledWith('1\tAnn\n2\tBobby');
    });

    it('copies new rows too (grid rows before the loaded rows)', async () => {
      renderGrid({ edit: makeEdit({ newRows: [['n1', 'n2', null]] }) });
      pick(cellAt(0, -1));
      fireEvent.click(await open(cellAt(0, 0)));
      expect(writeText).toHaveBeenLastCalledWith('n1\tn2\t');
    });
  });

  it('keeps the selection callback stable between renders with the same rows', () => {
    const { rerender } = renderGrid();
    pick(cellAt(1, 1));
    const calls = onSelectionChange.mock.calls.length;
    act(() => rerender(element()));
    expect(onSelectionChange.mock.calls.length).toBe(calls);
  });
});
