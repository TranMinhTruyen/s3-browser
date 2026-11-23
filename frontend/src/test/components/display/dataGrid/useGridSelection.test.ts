import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cellOf, useGridSelection } from '@/components/display/dataGrid/useGridSelection';

const DATA: (string | null)[][] = [
  ['1', 'Ann', null],
  ['2', 'Bob', 'x'],
  ['3', 'Cat', 'say "hi"\nok'],
];
const COLUMNS = ['id', 'name', 'note'];

/** A cell inside its own row element; `col` -1 is the row number cell. */
const cell = (row: number, col: number) => {
  const rowEl = document.createElement('div');
  rowEl.dataset.row = String(row);
  const el = document.createElement('div');
  el.dataset.col = String(col);
  rowEl.append(el);
  document.body.append(rowEl);
  return el;
};
const header = (col: number) => {
  const el = document.createElement('div');
  el.dataset.hcol = String(col);
  document.body.append(el);
  return el;
};

type Mods = Partial<{
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  clientX: number;
  clientY: number;
}>;
const mouse = (target: EventTarget | null, mods: Mods = {}) =>
  ({
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    clientX: 0,
    clientY: 0,
    target,
    preventDefault: vi.fn(),
    ...mods,
  }) as unknown as MouseEvent<HTMLDivElement> & { preventDefault: ReturnType<typeof vi.fn> };

type KeyMods = Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }>;
/** A key pressed on the grid itself (target = currentTarget), or on a child when `onChild` is set. */
const keyEvent = (key: string, mods: KeyMods = {}, onChild = false) => {
  const root = document.createElement('div');
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    target: onChild ? document.createElement('span') : root,
    currentTarget: root,
    preventDefault: vi.fn(),
    ...mods,
  } as unknown as KeyboardEvent<HTMLDivElement> & { preventDefault: ReturnType<typeof vi.fn> };
};

let frames: FrameRequestCallback[];
const cancelFrame = vi.fn();
const writeText = vi.fn();

function setup(over: Partial<Parameters<typeof useGridSelection>[0]> = {}) {
  const scrollEl = document.createElement('div');
  vi.spyOn(scrollEl, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect);
  Object.defineProperty(scrollEl, 'clientWidth', { value: 500 });
  Object.defineProperty(scrollEl, 'clientHeight', { value: 300 });
  Object.defineProperty(scrollEl, 'scrollLeft', { value: 0, writable: true });
  Object.defineProperty(scrollEl, 'scrollTop', { value: 0, writable: true });
  const scrollToCell = vi.fn();
  const props = {
    count: 3,
    columnCount: 3,
    columns: COLUMNS,
    getValue: (row: number, col: number) => DATA[row][col],
    scrollRef: { current: scrollEl },
    scrollToCell,
    insetX: 50,
    insetY: 30,
    ...over,
  };
  const view = renderHook(p => useGridSelection(p), { initialProps: props });
  return { ...view, props, scrollEl, scrollToCell };
}

type Setup = ReturnType<typeof setup>;
const down = (s: Setup, target: EventTarget | null, mods: Mods = {}) =>
  act(() => s.result.current.onMouseDownGrid(mouse(target, mods)));
const up = () => act(() => void window.dispatchEvent(new MouseEvent('mouseup')));
/** A click as the user makes it: the selection starts on mouse down, a drag ends on mouse up. */
const pick = (s: Setup, target: EventTarget | null, mods: Mods = {}) => {
  down(s, target, mods);
  up();
};
const press = (s: Setup, key: string, mods: KeyMods = {}) => {
  const e = keyEvent(key, mods);
  let handled = false;
  act(() => {
    handled = s.result.current.onKeyDownGrid(e);
  });
  return { handled, e };
};
const runFrame = () => act(() => void frames.shift()?.(0));
const cols = (s: Setup) => [...s.result.current.sel.cols].sort();

describe('useGridSelection', () => {
  beforeEach(() => {
    frames = [];
    cancelFrame.mockReset();
    writeText.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  describe('cellOf', () => {
    it('reads the row and column of the cell an event came from, including a child of the cell', () => {
      const el = cell(4, 2);
      const child = document.createElement('span');
      el.append(child);
      expect(cellOf(el)).toEqual({ row: 4, col: 2 });
      expect(cellOf(child)).toEqual({ row: 4, col: 2 });
      expect(cellOf(cell(1, -1))).toEqual({ row: 1, col: -1 });
    });

    it.each([
      ['null', null],
      ['a target that is not an element', window],
      ['an element outside any cell', document.createElement('div')],
    ])('is null for %s', (_name, target) => {
      expect(cellOf(target)).toBeNull();
    });

    it('is null for a cell that is not inside a row', () => {
      const orphan = document.createElement('div');
      orphan.dataset.col = '1';
      expect(cellOf(orphan)).toBeNull();
    });
  });

  describe('selecting cells', () => {
    it('starts empty', () => {
      const s = setup();
      expect(s.result.current.sel.cursor).toBeNull();
      expect(s.result.current.range).toBeNull();
      expect(s.result.current.selectedRows).toEqual([]);
      expect(s.result.current.getTarget()).toBeNull();
    });

    it('selects a cell on mouse down: a rectangle of one, its row is the selected row', () => {
      const s = setup();
      down(s, cell(1, 2));
      const { sel, range, selectedRows } = s.result.current;
      expect(sel).toMatchObject({ kind: 'cell', cursor: { row: 1, col: 2 }, anchor: { row: 1, col: 2 } });
      expect(range).toBeNull();
      expect(selectedRows).toEqual([1]);
      expect(s.result.current.getTarget()).toEqual({ rows: [1], cols: [2] });
      up();
    });

    it('Shift+mouse down extends the rectangle from the anchor and keeps the anchor when extended again', () => {
      const s = setup();
      pick(s, cell(2, 2));
      pick(s, cell(0, 1), { shiftKey: true });
      expect(s.result.current.range).toEqual({ r1: 0, r2: 2, c1: 1, c2: 2 });
      expect(s.result.current.sel.cursor).toEqual({ row: 0, col: 1 });
      expect(s.result.current.getTarget()).toEqual({ rows: [0, 1, 2], cols: [1, 2] });
      pick(s, cell(1, 0), { shiftKey: true });
      expect(s.result.current.range).toEqual({ r1: 1, r2: 2, c1: 0, c2: 2 });
    });

    it('Shift+mouse down without any selection selects that cell', () => {
      const s = setup();
      pick(s, cell(1, 1), { shiftKey: true });
      expect(s.result.current.range).toBeNull();
      expect(s.result.current.sel.cursor).toEqual({ row: 1, col: 1 });
    });

    it('a plain mouse down after a rectangle collapses it to the cell', () => {
      const s = setup();
      pick(s, cell(0, 0));
      pick(s, cell(2, 2), { shiftKey: true });
      pick(s, cell(1, 1));
      expect(s.result.current.range).toBeNull();
      expect(s.result.current.sel.anchor).toEqual({ row: 1, col: 1 });
    });

    it.each([
      ['a button other than the main one', cell(1, 1), { button: 2 }],
      ['a place outside the grid cells', document.createElement('div'), {}],
      ['no element', null, {}],
    ])('ignores a mouse down on %s', (_name, target, mods) => {
      const s = setup();
      down(s, target, mods);
      expect(s.result.current.sel.cursor).toBeNull();
      expect(frames).toHaveLength(0);
    });

    it.each(['editing', 'resizer'])('ignores a mouse down inside an element marked data-%s', name => {
      const s = setup();
      pick(s, cell(1, 1));
      const started = frames.length;
      const marked = cell(2, 2);
      marked.dataset[name] = '';
      const inner = document.createElement('span');
      marked.append(inner);
      down(s, inner);
      expect(s.result.current.sel.cursor).toEqual({ row: 1, col: 1 });
      expect(frames).toHaveLength(started); // no new drag
    });
  });

  describe('selecting columns (header)', () => {
    it('selects a column; the cursor keeps its row, or takes the first row when nothing was selected', () => {
      const s = setup();
      down(s, header(1));
      expect(s.result.current.sel).toMatchObject({ kind: 'col', cursor: { row: 0, col: 1 } });
      expect(cols(s)).toEqual([1]);
      expect(s.result.current.getTarget()).toEqual({ rows: [0, 1, 2], cols: [1] });
      expect(s.result.current.selectedRows).toEqual([]);
      expect(frames).toHaveLength(0); // a header press does not start a drag
      pick(s, cell(2, 0));
      down(s, header(2));
      expect(s.result.current.sel.cursor).toEqual({ row: 2, col: 2 });
    });

    it('a plain click replaces the columns; Ctrl or Cmd adds and removes columns', () => {
      const s = setup();
      down(s, header(0));
      down(s, header(2), { ctrlKey: true });
      expect(cols(s)).toEqual([0, 2]);
      down(s, header(1), { metaKey: true });
      expect(cols(s)).toEqual([0, 1, 2]);
      down(s, header(0), { ctrlKey: true });
      expect(cols(s)).toEqual([1, 2]);
      down(s, header(2));
      expect(cols(s)).toEqual([2]);
    });

    it('Ctrl+click on the only selected column clears the selection', () => {
      const s = setup();
      down(s, header(1));
      down(s, header(1), { ctrlKey: true });
      expect(s.result.current.sel.cursor).toBeNull();
      expect(s.result.current.sel.cols.size).toBe(0);
    });

    it('Ctrl+click from a cell selection starts a new column selection', () => {
      const s = setup();
      pick(s, cell(1, 0));
      down(s, header(2), { ctrlKey: true });
      expect(cols(s)).toEqual([2]);
    });

    it('Shift+click selects the columns between the anchor column and the clicked one', () => {
      const s = setup();
      down(s, header(2));
      down(s, header(0), { shiftKey: true });
      expect(cols(s)).toEqual([0, 1, 2]);
      down(s, header(1), { shiftKey: true });
      expect(cols(s)).toEqual([1, 2]);
    });

    it('Shift+click starts from the column of the active cell, or from the clicked column with no selection', () => {
      const s = setup();
      pick(s, cell(0, 2));
      down(s, header(1), { shiftKey: true });
      expect(cols(s)).toEqual([1, 2]);
      const t = setup();
      down(t, header(1), { shiftKey: true });
      expect(cols(t)).toEqual([1]);
    });
  });

  describe('selecting rows (row number)', () => {
    it('selects a row; the cursor keeps its column (the first one when nothing was selected)', () => {
      const s = setup();
      down(s, cell(1, -1));
      expect(s.result.current.sel).toMatchObject({ kind: 'row', cursor: { row: 1, col: 0 } });
      expect(s.result.current.selectedRows).toEqual([1]);
      expect(s.result.current.getTarget()).toEqual({ rows: [1], cols: [0, 1, 2] });
      expect(frames).toHaveLength(0);
      pick(s, cell(0, 2));
      down(s, cell(2, -1));
      expect(s.result.current.sel.cursor).toEqual({ row: 2, col: 2 });
    });

    it('a plain click replaces the rows; Ctrl or Cmd toggles rows, counting the row of the active cell first', () => {
      const s = setup();
      pick(s, cell(0, 1));
      down(s, cell(2, -1), { ctrlKey: true });
      expect(s.result.current.selectedRows).toEqual([0, 2]);
      down(s, cell(1, -1), { metaKey: true });
      expect(s.result.current.selectedRows).toEqual([0, 1, 2]);
      down(s, cell(0, -1), { ctrlKey: true });
      expect(s.result.current.selectedRows).toEqual([1, 2]);
      down(s, cell(2, -1));
      expect(s.result.current.selectedRows).toEqual([2]);
    });

    it('Ctrl+click without a selection selects that row; on the only selected row it clears', () => {
      const s = setup();
      down(s, cell(1, -1), { ctrlKey: true });
      expect(s.result.current.selectedRows).toEqual([1]);
      down(s, cell(1, -1), { ctrlKey: true });
      expect(s.result.current.selectedRows).toEqual([]);
      expect(s.result.current.sel.cursor).toBeNull();
    });

    it('Shift+click selects the rows from the anchor, whichever side the click is on', () => {
      const s = setup();
      pick(s, cell(1, 1));
      down(s, cell(2, -1), { shiftKey: true });
      expect(s.result.current.selectedRows).toEqual([1, 2]);
      down(s, cell(0, -1), { shiftKey: true });
      expect(s.result.current.selectedRows).toEqual([0, 1]);
    });

    it('Shift+click after a column selection or with no selection starts from the clicked row', () => {
      const s = setup();
      down(s, header(1));
      down(s, cell(2, -1), { shiftKey: true });
      expect(s.result.current.selectedRows).toEqual([2]);
      const t = setup();
      down(t, cell(1, -1), { shiftKey: true });
      expect(t.result.current.selectedRows).toEqual([1]);
    });
  });

  describe('dragging', () => {
    let pointAt: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      pointAt = vi.fn();
      Object.defineProperty(document, 'elementFromPoint', { value: pointAt, configurable: true });
    });

    it('extends the rectangle to the cell under the pointer each frame, until the mouse is released', () => {
      const s = setup();
      down(s, cell(0, 0), { clientX: 100, clientY: 100 });
      expect(frames).toHaveLength(1);
      pointAt.mockReturnValue(cell(2, 1));
      runFrame();
      expect(s.result.current.range).toEqual({ r1: 0, r2: 2, c1: 0, c2: 1 });
      expect(s.result.current.sel.anchor).toEqual({ row: 0, col: 0 });
      expect(frames).toHaveLength(1); // the next frame is scheduled
      runFrame(); // the same cell again changes nothing
      expect(s.result.current.range).toEqual({ r1: 0, r2: 2, c1: 0, c2: 1 });
      up();
      expect(cancelFrame).toHaveBeenCalled();
    });

    it('follows the pointer on mouse move and stops following after mouse up', () => {
      const s = setup();
      down(s, cell(0, 0), { clientX: 100, clientY: 100 });
      act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 150 })));
      pointAt.mockReturnValue(cell(1, 1));
      runFrame();
      expect(pointAt).toHaveBeenLastCalledWith(200, 150);
      up();
      pointAt.mockClear();
      act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 150 })));
      expect(pointAt).not.toHaveBeenCalled();
    });

    it.each([
      { name: 'right', x: 600, y: 100, left: 25, top: 0, hit: [499, 100] },
      { name: 'far right (at most 40 px per frame)', x: 5000, y: 100, left: 40, top: 0, hit: [499, 100] },
      { name: 'left (over the row number column)', x: 10, y: 100, left: -10, top: 0, hit: [51, 100] },
      { name: 'bottom', x: 100, y: 400, left: 0, top: 25, hit: [100, 299] },
      { name: 'top (over the header)', x: 100, y: 6, left: 0, top: -6, hit: [100, 31] },
    ])('scrolls to the $name while dragging and hit-tests inside the cells', ({ x, y, left, top, hit }) => {
      const s = setup();
      down(s, cell(0, 0), { clientX: x, clientY: y });
      pointAt.mockReturnValue(null);
      runFrame();
      expect(s.scrollEl.scrollLeft).toBe(left);
      expect(s.scrollEl.scrollTop).toBe(top);
      expect(pointAt).toHaveBeenLastCalledWith(hit[0], hit[1]);
    });

    it('does not scroll while the pointer is inside the cells', () => {
      const s = setup();
      down(s, cell(0, 0), { clientX: 100, clientY: 100 });
      runFrame();
      expect(s.scrollEl.scrollLeft).toBe(0);
      expect(s.scrollEl.scrollTop).toBe(0);
    });

    it('ignores the row number cell and a point outside any cell', () => {
      const s = setup();
      down(s, cell(0, 0), { clientX: 100, clientY: 100 });
      pointAt.mockReturnValue(cell(2, -1));
      runFrame();
      pointAt.mockReturnValue(null);
      runFrame();
      expect(s.result.current.range).toBeNull();
    });

    it('works where document.elementFromPoint does not exist (jsdom)', () => {
      Reflect.deleteProperty(document, 'elementFromPoint');
      const s = setup();
      down(s, cell(0, 0));
      expect(() => runFrame()).not.toThrow();
      expect(s.result.current.range).toBeNull();
    });

    it('does not change a column selection made while the mouse button is still down', () => {
      const s = setup();
      down(s, cell(0, 0));
      down(s, header(1));
      pointAt.mockReturnValue(cell(2, 2));
      runFrame();
      expect(s.result.current.sel.kind).toBe('col');
    });

    it('keeps running without a scroll element', () => {
      const s = setup({ scrollRef: { current: null } });
      down(s, cell(0, 0));
      runFrame();
      expect(pointAt).not.toHaveBeenCalled();
      expect(frames).toHaveLength(1);
    });

    it('a new mouse down ends the previous drag', () => {
      const s = setup();
      const remove = vi.spyOn(window, 'removeEventListener');
      down(s, cell(0, 0));
      down(s, cell(1, 1));
      expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(remove).toHaveBeenCalledWith('mousemove', expect.any(Function));
      up();
    });

    it('removes its window listeners and cancels the frame when unmounted during a drag', () => {
      const s = setup();
      const remove = vi.spyOn(window, 'removeEventListener');
      down(s, cell(0, 0));
      s.unmount();
      expect(remove).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(cancelFrame).toHaveBeenCalled();
    });

    it('unmounting without a drag has nothing to clean up', () => {
      const s = setup();
      const remove = vi.spyOn(window, 'removeEventListener');
      s.unmount();
      expect(remove).not.toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(cancelFrame).not.toHaveBeenCalled();
    });
  });

  describe('keyboard', () => {
    it('ignores keys that come from a child element, and every key when there are no rows', () => {
      const s = setup();
      const child = keyEvent('ArrowDown', {}, true);
      expect(s.result.current.onKeyDownGrid(child)).toBe(false);
      expect(child.preventDefault).not.toHaveBeenCalled();
      const empty = setup({ count: 0 });
      expect(press(empty, 'ArrowDown').handled).toBe(false);
    });

    it('the first arrow only selects the first cell and scrolls to it', () => {
      const s = setup();
      const { handled, e } = press(s, 'ArrowRight');
      expect(handled).toBe(true);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(s.result.current.sel.cursor).toEqual({ row: 0, col: 0 });
      expect(s.scrollToCell).toHaveBeenCalledWith(0, 0);
    });

    it.each([
      ['ArrowDown', { row: 2, col: 1 }],
      ['ArrowUp', { row: 0, col: 1 }],
      ['ArrowLeft', { row: 1, col: 0 }],
      ['ArrowRight', { row: 1, col: 2 }],
    ])('%s moves the cell and scrolls to it', (key, expected) => {
      const s = setup();
      pick(s, cell(1, 1));
      press(s, key);
      expect(s.result.current.sel.cursor).toEqual(expected);
      expect(s.result.current.range).toBeNull();
      expect(s.scrollToCell).toHaveBeenLastCalledWith(expected.row, expected.col);
    });

    it('clamps at the edges', () => {
      const s = setup();
      pick(s, cell(0, 0));
      press(s, 'ArrowUp');
      press(s, 'ArrowLeft');
      expect(s.result.current.sel.cursor).toEqual({ row: 0, col: 0 });
      pick(s, cell(2, 2));
      press(s, 'ArrowDown');
      press(s, 'ArrowRight');
      expect(s.result.current.sel.cursor).toEqual({ row: 2, col: 2 });
    });

    it('an arrow leaves a row selection for a single cell', () => {
      const s = setup();
      down(s, cell(1, -1));
      press(s, 'ArrowDown');
      expect(s.result.current.sel).toMatchObject({ kind: 'cell', cursor: { row: 2, col: 0 } });
    });

    it('Shift+arrows grow and shrink the rectangle around the anchor', () => {
      const s = setup();
      pick(s, cell(1, 1));
      press(s, 'ArrowDown', { shiftKey: true });
      press(s, 'ArrowRight', { shiftKey: true });
      expect(s.result.current.range).toEqual({ r1: 1, r2: 2, c1: 1, c2: 2 });
      expect(s.result.current.sel.anchor).toEqual({ row: 1, col: 1 });
      press(s, 'ArrowUp', { shiftKey: true });
      press(s, 'ArrowLeft', { shiftKey: true });
      expect(s.result.current.range).toBeNull();
      expect(s.scrollToCell).toHaveBeenLastCalledWith(1, 1);
    });

    it('Shift+arrow is clamped, and after a row selection it starts from the active cell', () => {
      const s = setup();
      pick(s, cell(2, 1));
      press(s, 'ArrowDown', { shiftKey: true });
      expect(s.result.current.sel.cursor).toEqual({ row: 2, col: 1 });
      down(s, cell(0, -1));
      press(s, 'ArrowRight', { shiftKey: true });
      expect(s.result.current.sel).toMatchObject({
        kind: 'cell',
        cursor: { row: 0, col: 2 },
        anchor: { row: 0, col: 1 },
      });
    });

    it('Shift+arrow without a selection selects the first cell only', () => {
      const s = setup();
      press(s, 'ArrowDown', { shiftKey: true });
      expect(s.result.current.sel.cursor).toEqual({ row: 0, col: 0 });
      expect(s.result.current.range).toBeNull();
    });

    it('does not handle other keys, nor Ctrl+C without a selection', () => {
      const s = setup();
      expect(press(s, 'a').handled).toBe(false);
      const { handled, e } = press(s, 'c', { ctrlKey: true });
      expect(handled).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    });

    it('does not treat a plain C as copy', () => {
      const s = setup();
      pick(s, cell(1, 1));
      expect(press(s, 'c').handled).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('copy', () => {
    it('Ctrl+C copies the value of the selected cell as text and prevents the default', () => {
      const s = setup();
      pick(s, cell(1, 1));
      const { handled, e } = press(s, 'c', { ctrlKey: true });
      expect(handled).toBe(true);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledExactlyOnceWith('Bob');
    });

    it('Cmd+C works too, also with a capital letter', () => {
      const s = setup();
      pick(s, cell(1, 0));
      press(s, 'C', { metaKey: true });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('2');
    });

    it('a NULL cell is copied as an empty text', () => {
      const s = setup();
      pick(s, cell(0, 2));
      press(s, 'c', { ctrlKey: true });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('');
    });

    it('a rectangle is copied as TSV: tabs between columns, newlines between rows, no trailing newline', () => {
      const s = setup();
      pick(s, cell(0, 0));
      pick(s, cell(1, 2), { shiftKey: true });
      press(s, 'c', { ctrlKey: true });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('1\tAnn\t\n2\tBob\tx');
    });

    it('quotes a value with a tab, a newline, a carriage return or a quote, doubling the quotes', () => {
      const data = [['a\tb', 'a\nb', 'a\rb', 'say "hi"', 'plain']];
      const s = setup({
        count: 1,
        columnCount: 5,
        columns: ['c1', 'c2', 'c3', 'c4', 'c5'],
        getValue: (row, col) => data[row][col],
      });
      pick(s, cell(0, 0));
      pick(s, cell(0, 4), { shiftKey: true });
      press(s, 'c', { ctrlKey: true });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('"a\tb"\t"a\nb"\t"a\rb"\t"say ""hi"""\tplain');
    });

    it('copies the value on display (what getValue returns)', () => {
      const s = setup({ getValue: (row, col) => (row === 1 && col === 1 ? 'Bobby' : DATA[row][col]) });
      pick(s, cell(1, 1));
      press(s, 'c', { ctrlKey: true });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('Bobby');
    });

    it('selected rows are copied with every column, in ascending order', () => {
      const s = setup();
      down(s, cell(2, -1));
      down(s, cell(0, -1), { ctrlKey: true });
      press(s, 'c', { ctrlKey: true });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('1\tAnn\t\n3\tCat\t"say ""hi""\nok"');
    });

    it('selected columns are copied with every row', () => {
      const s = setup();
      down(s, header(2));
      down(s, header(0), { ctrlKey: true });
      press(s, 'c', { ctrlKey: true });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('1\t\n2\tx\n3\t"say ""hi""\nok"');
    });

    it('the menu item Copy copies without the column names, Copy with headers puts them first', () => {
      const s = setup();
      pick(s, cell(0, 0));
      pick(s, cell(1, 1), { shiftKey: true });
      act(() => s.result.current.onClickMenuCopy());
      expect(writeText).toHaveBeenLastCalledWith('1\tAnn\n2\tBob');
      act(() => s.result.current.onClickMenuCopyWithHeaders());
      expect(writeText).toHaveBeenLastCalledWith('id\tname\n1\tAnn\n2\tBob');
    });

    it('quotes a column name that has a tab or a quote', () => {
      const s = setup({ columns: ['i\td', 'na"me', 'note'] });
      pick(s, cell(0, 0));
      pick(s, cell(0, 1), { shiftKey: true });
      act(() => s.result.current.onClickMenuCopyWithHeaders());
      expect(writeText).toHaveBeenCalledExactlyOnceWith('"i\td"\t"na""me"\n1\tAnn');
    });

    it('the menu items do nothing without a selection', () => {
      const s = setup();
      act(() => s.result.current.onClickMenuCopy());
      act(() => s.result.current.onClickMenuCopyWithHeaders());
      expect(writeText).not.toHaveBeenCalled();
    });

    it('a rejected clipboard write is ignored', async () => {
      writeText.mockRejectedValue(new Error('denied'));
      const s = setup();
      pick(s, cell(1, 1));
      press(s, 'c', { ctrlKey: true });
      await act(async () => {});
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the clipboard API is missing', () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      const s = setup();
      pick(s, cell(1, 1));
      expect(press(s, 'c', { ctrlKey: true }).handled).toBe(true);
    });
  });

  describe('context menu', () => {
    const menu = (s: Setup, target: EventTarget | null) => {
      const e = mouse(target);
      act(() => s.result.current.onContextMenuGrid(e));
      return e;
    };

    it.each([
      ['a row number cell', () => cell(1, -1)],
      ['the header', () => header(1)],
      ['nothing', () => null],
    ])('opens no menu on %s and prevents the browser menu', (_name, target) => {
      const s = setup();
      const e = menu(s, target());
      expect(e.preventDefault).toHaveBeenCalled();
      expect(s.result.current.menuOpen).toBe(false);
    });

    it('right click on an unselected cell selects it and opens the menu', () => {
      const s = setup();
      const e = menu(s, cell(2, 1));
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(s.result.current.menuOpen).toBe(true);
      expect(s.result.current.sel.cursor).toEqual({ row: 2, col: 1 });
    });

    it('right click on the selected single cell keeps it; on another cell it selects that one', () => {
      const s = setup();
      pick(s, cell(1, 1));
      const before = s.result.current.sel;
      menu(s, cell(1, 1));
      expect(s.result.current.sel).toBe(before);
      menu(s, cell(1, 2));
      expect(s.result.current.sel.cursor).toEqual({ row: 1, col: 2 });
    });

    it('right click inside a rectangle keeps it; outside it selects the cell', () => {
      const s = setup();
      pick(s, cell(0, 0));
      pick(s, cell(1, 1), { shiftKey: true });
      menu(s, cell(1, 0));
      expect(s.result.current.range).toEqual({ r1: 0, r2: 1, c1: 0, c2: 1 });
      menu(s, cell(2, 0));
      expect(s.result.current.range).toBeNull();
      expect(s.result.current.sel.cursor).toEqual({ row: 2, col: 0 });
    });

    it('right click on a cell next to the rectangle in the same row or column is outside it', () => {
      const s = setup();
      pick(s, cell(0, 0));
      pick(s, cell(1, 1), { shiftKey: true });
      menu(s, cell(0, 2));
      expect(s.result.current.range).toBeNull();
      pick(s, cell(0, 0));
      pick(s, cell(1, 1), { shiftKey: true });
      menu(s, cell(2, 1));
      expect(s.result.current.range).toBeNull();
    });

    it('right click inside a column selection keeps it; on another column selects the cell', () => {
      const s = setup();
      down(s, header(1));
      menu(s, cell(2, 1));
      expect(s.result.current.sel.kind).toBe('col');
      menu(s, cell(2, 0));
      expect(s.result.current.sel.kind).toBe('cell');
    });

    it('right click inside a row selection keeps it; on another row selects the cell', () => {
      const s = setup();
      down(s, cell(1, -1));
      menu(s, cell(1, 2));
      expect(s.result.current.sel.kind).toBe('row');
      menu(s, cell(0, 2));
      expect(s.result.current.sel).toMatchObject({ kind: 'cell', cursor: { row: 0, col: 2 } });
    });

    it('onChangeMenu opens and closes the menu', () => {
      const s = setup();
      act(() => s.result.current.onChangeMenu(true));
      expect(s.result.current.menuOpen).toBe(true);
      act(() => s.result.current.onChangeMenu(false));
      expect(s.result.current.menuOpen).toBe(false);
    });
  });

  describe('state helpers', () => {
    it('setCursor selects a cell without scrolling, moveTo clamps and scrolls, clear empties', () => {
      const s = setup();
      act(() => s.result.current.setCursor(1, 2));
      expect(s.result.current.sel.cursor).toEqual({ row: 1, col: 2 });
      expect(s.scrollToCell).not.toHaveBeenCalled();
      act(() => s.result.current.moveTo(9, -4));
      expect(s.result.current.sel.cursor).toEqual({ row: 2, col: 0 });
      expect(s.scrollToCell).toHaveBeenCalledExactlyOnceWith(2, 0);
      act(() => s.result.current.clear());
      expect(s.result.current.sel.cursor).toBeNull();
      expect(s.result.current.selectedRows).toEqual([]);
    });

    it('selectedRows keeps its identity while the same row stays selected', () => {
      const s = setup();
      pick(s, cell(1, 0));
      const rows = s.result.current.selectedRows;
      pick(s, cell(1, 2));
      expect(s.result.current.selectedRows).toBe(rows);
    });

    it('drops the selection when the rows are replaced by fewer rows or columns', () => {
      const s = setup();
      pick(s, cell(2, 2));
      s.rerender({ ...s.props, count: 2 });
      expect(s.result.current.sel.cursor).toBeNull();
      pick(s, cell(1, 2));
      s.rerender({ ...s.props, count: 2, columnCount: 2 });
      expect(s.result.current.sel.cursor).toBeNull();
    });

    it('keeps the selection while the cell still exists', () => {
      const s = setup();
      pick(s, cell(1, 1));
      s.rerender({ ...s.props, count: 2 });
      expect(s.result.current.sel.cursor).toEqual({ row: 1, col: 1 });
    });
  });
});
