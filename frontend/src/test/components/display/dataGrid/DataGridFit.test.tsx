import { act, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import DataGrid, { type DataGridHandle } from '@/components/display/dataGrid/DataGrid';
import { COPY, makeGridEdit as makeEdit } from '@/test/_helpers/dataGrid';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

type Options = { count: number; paddingStart?: number; estimateSize: (index?: number) => number };

// jsdom không có layout: virtualizer render mọi mục và `measure` được thay bằng spy.
const virtual = vi.hoisted(() => ({ measure: vi.fn() }));

vi.mock('@tanstack/react-virtual', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-virtual')>('@tanstack/react-virtual');
  return {
    defaultRangeExtractor: actual.defaultRangeExtractor,
    useVirtualizer: (options: Options) => {
      const sizes = Array.from({ length: options.count }, (_, i) => options.estimateSize(i));
      const pad = options.paddingStart ?? 0;
      const items = sizes.map((size, index) => ({
        key: index,
        index,
        size,
        start: pad + sizes.slice(0, index).reduce((a, b) => a + b, 0),
      }));
      return {
        measure: virtual.measure,
        scrollToIndex: vi.fn(),
        getVirtualItems: () => items,
        getTotalSize: () => pad + sizes.reduce((a, b) => a + b, 0),
      };
    },
  };
});

const COLUMNS = ['id', 'name', 'description'];
const ROWS: (string | null)[][] = [
  ['1', 'Ann', null],
  ['2', 'Roberta', 'x'],
];

const resizer = (col: number) => document.querySelector<HTMLElement>(`[data-index="${col}"]`) as HTMLElement;
/** Chiều rộng cột: grid đo ô header chứa tay nắm đổi kích thước. */
const widthOf = (col: number) => resizer(col).parentElement?.style.width ?? '';

describe('DataGrid fit columns', () => {
  // [text, font] của mọi lời gọi measureText. Chuỗi từ 2 ký tự trở lên được đo ngắn hơn 1px so với 10px mỗi ký tự
  // (giả lập kerning), nên đo nguyên chuỗi và cộng từng ký tự sẽ cho độ rộng khác nhau.
  let calls: [string, string][];
  let hasContext: boolean;
  const ctx = { font: '', measureText: (_text: string) => ({ width: 0 }) };

  const setup = (props: Partial<React.ComponentProps<typeof DataGrid>> = {}) => {
    const ref = createRef<DataGridHandle>();
    const view = renderWithProviders(
      <DataGrid ref={ref} columns={COLUMNS} rows={ROWS} nullText="NULL" copyLabels={COPY} {...props} />
    );
    virtual.measure.mockClear();
    return { ref, ...view };
  };
  const fit = (ref: React.RefObject<DataGridHandle | null>) => act(() => ref.current?.fitColumns());
  const measuredTexts = () => calls.map(([text]) => text);

  beforeEach(() => {
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS } });
    calls = [];
    hasContext = true;
    ctx.measureText = (text: string) => {
      calls.push([text, ctx.font]);
      return { width: text.length * 10 - (text.length > 1 ? 1 : 0) };
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => (hasContext ? ctx : null)) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets every column to its widest title or value, measures once and keeps a floor of 48px', () => {
    const { ref } = setup();
    fit(ref);
    // id: tiêu đề 19 + 17 = 36 -> 48; name: "Roberta" 7 x 10 + 17; description: tiêu đề 11 x 10 - 1 + 17
    expect(widthOf(0)).toBe('48px');
    expect(widthOf(1)).toBe('87px');
    expect(widthOf(2)).toBe('126px');
    expect(virtual.measure).toHaveBeenCalledTimes(1);
  });

  it('measures the titles in bold and the values in the regular font', () => {
    const { ref } = setup();
    fit(ref);
    const fontOf = (text: string) => calls.find(([t]) => t === text)?.[1] ?? '';
    expect(fontOf('name')).toMatch(/^600 /);
    expect(fontOf('R')).not.toMatch(/^600 /);
  });

  it('measures every row of every column and skips NULL cells', () => {
    const { ref } = setup();
    fit(ref);
    const chars = measuredTexts().filter(t => t.length === 1);
    expect(new Set(chars)).toEqual(new Set(['1', '2', 'A', 'n', 'R', 'o', 'b', 'e', 'r', 't', 'a', 'x']));
    expect(measuredTexts()).not.toContain('NULL');
  });

  it('caches the width of each character, also across columns', () => {
    const { ref } = setup({
      columns: ['a', 'b'],
      rows: [
        ['aaaa', 'aaab'],
        ['bbba', 'a'],
      ],
    });
    fit(ref);
    // 'a' và 'b' mỗi ký tự xuất hiện một lần trong giá trị, thêm một lần làm tiêu đề một ký tự (tiêu đề được đo nguyên chuỗi).
    expect(measuredTexts().filter(t => t === 'a')).toHaveLength(2);
    expect(measuredTexts().filter(t => t === 'b')).toHaveLength(2);
    expect(widthOf(0)).toBe('57px'); // aaaa = 40 + 17
  });

  it('clips a value to 200 characters and caps the width at 600px', () => {
    const { ref } = setup({ columns: ['v'], rows: [['a'.repeat(300)]] });
    fit(ref);
    expect(widthOf(0)).toBe('600px');
  });

  it('stops at the first value that reaches the cap: later rows are not measured', () => {
    const { ref } = setup({ columns: ['v'], rows: [['a'.repeat(100)], ['zzz']] });
    fit(ref);
    expect(measuredTexts()).not.toContain('z');
    expect(widthOf(0)).toBe('600px');
  });

  it('measures no row when the title alone reaches the cap', () => {
    const { ref } = setup({ columns: ['h'.repeat(60)], rows: [['qqq']] });
    fit(ref);
    expect(measuredTexts()).toEqual(['h'.repeat(60)]);
    expect(widthOf(0)).toBe('600px');
  });

  it('fits the titles of a grid without rows', () => {
    const { ref } = setup({ rows: [] });
    fit(ref);
    expect(widthOf(2)).toBe('126px');
    expect(widthOf(1)).toBe('56px'); // title "name" 39 + 17
  });

  it('divides the measured text by the interface scale and caps at 600px of the medium size', () => {
    useSettingStore.setState(s => ({ draft: { ...s.draft, size: 'large' } }));
    const { ref } = setup({ columns: ['v', 'w'], rows: [['a'.repeat(40), 'a'.repeat(70)]] });
    fit(ref);
    // 400 / 1.125 -> 356 + 17 = 373 ở cỡ trung bình, nhân 1.125 trên màn hình
    expect(widthOf(0)).toBe('419.625px');
    expect(widthOf(1)).toBe('675px'); // 700 >= (600 - 17) x 1.125: capped at 600
  });

  it('does nothing without a canvas context', () => {
    const { ref } = setup();
    hasContext = false;
    fit(ref);
    expect(widthOf(1)).toBe('160px');
    expect(virtual.measure).not.toHaveBeenCalled();
  });

  it('does nothing once the grid is unmounted', () => {
    const { ref, unmount } = setup();
    const handle = ref.current as DataGridHandle;
    unmount();
    act(() => handle.fitColumns());
    expect(virtual.measure).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('gives the same widths when fitted again', () => {
    const { ref } = setup();
    fit(ref);
    fit(ref);
    expect(widthOf(1)).toBe('87px');
  });

  describe('double click on a column edge (as before)', () => {
    it('measures the whole text of that column only, not the sum of characters', () => {
      setup();
      fireEvent.doubleClick(resizer(1));
      expect(widthOf(1)).toBe('86px'); // "Roberta" = 69 + 17
      expect(widthOf(0)).toBe('160px');
      expect(measuredTexts()).toContain('Roberta');
    });
  });

  describe('editable grid', () => {
    it('measures the value on display: a new row and an edited cell, not the loaded value', () => {
      const edit = makeEdit({
        newRows: [[null, 'N'.repeat(12), null]],
        edited: new Map([[1, new Map([[2, 'edited value']])]]),
      });
      const { ref } = setup({ edit });
      fit(ref);
      expect(widthOf(1)).toBe('137px'); // 12 x 10 + 17
      expect(widthOf(2)).toBe('137px'); // "edited value" 12 x 10 + 17 (the title is 109 + 17)
      expect(measuredTexts()).not.toContain('x');
    });

    it('does not measure a cell edited to NULL', () => {
      const edit = makeEdit({ edited: new Map([[1, new Map<number, string | null>([[1, null]])]]) });
      const { ref } = setup({ edit });
      fit(ref);
      expect(widthOf(1)).toBe('56px'); // "Roberta" is NULL now: the title (39) is the widest
      expect(measuredTexts()).not.toContain('R');
    });

    it('double click also measures the value on display', () => {
      const edit = makeEdit({
        newRows: [[null, 'N'.repeat(12), null]],
        edited: new Map([[0, new Map([[1, 'E'.repeat(14)]])]]),
      });
      setup({ edit });
      fireEvent.doubleClick(resizer(1));
      expect(widthOf(1)).toBe('156px'); // 14 x 10 - 1 + 17
      expect(measuredTexts()).toContain('E'.repeat(14));
    });
  });
});
