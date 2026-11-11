import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { findAll, findNext, getMatchInfo, replaceAll, replaceCurrent, selectNext } from '@/pages/sql/utils/findReplace';
import { createView } from '@/test/_helpers/codemirror';

const views: EditorView[] = [];
const make = (doc: string, selection?: { anchor: number; head?: number }) => {
  const view = createView(doc, selection);
  views.push(view);
  return view;
};
const sel = (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  return [from, to];
};

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe('findAll', () => {
  it('returns every match case-insensitively in document order', () => {
    const { state } = make('Foo bar FOO foo');
    expect(findAll(state, 'foo')).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
      { from: 12, to: 15 },
    ]);
  });

  it.each([
    ['empty query', ''],
    ['no match', 'zzz'],
  ])('returns nothing for %s', (_n, query) => {
    expect(findAll(make('foo').state, query)).toEqual([]);
  });
});

describe('findNext', () => {
  it('finds the first match at or after the position', () => {
    const s = make('foo bar foo').state;
    expect(findNext(s, 'foo', 1)).toEqual({ from: 8, to: 11 });
    expect(findNext(s, 'foo', 8)).toEqual({ from: 8, to: 11 });
  });

  it('wraps to the start of the document', () => {
    expect(findNext(make('foo bar').state, 'foo', 4)).toEqual({ from: 0, to: 3 });
  });

  it('returns null for an empty query or no match', () => {
    const s = make('foo').state;
    expect(findNext(s, '', 0)).toBeNull();
    expect(findNext(s, 'zzz', 0)).toBeNull();
  });
});

describe('selectNext', () => {
  it('selects the match after the current selection and wraps around', () => {
    const view = make('a foo b foo', { anchor: 0 });
    expect(selectNext(view, 'foo')).toBe(true);
    expect(sel(view)).toEqual([2, 5]);
    expect(selectNext(view, 'foo')).toBe(true);
    expect(sel(view)).toEqual([8, 11]);
    expect(selectNext(view, 'foo')).toBe(true);
    expect(sel(view)).toEqual([2, 5]);
  });

  it('returns false and keeps the selection when nothing matches', () => {
    const view = make('abc', { anchor: 1 });
    expect(selectNext(view, 'zzz')).toBe(false);
    expect(sel(view)).toEqual([1, 1]);
  });
});

describe('replaceCurrent', () => {
  it('replaces a selected match and selects the next one in one undo-able transaction', () => {
    const view = make('foo x foo', { anchor: 0, head: 3 });
    expect(replaceCurrent(view, 'foo', 'bar')).toBe(true);
    expect(view.state.doc.toString()).toBe('bar x foo');
    expect(sel(view)).toEqual([6, 9]);
  });

  it('matches the selection ignoring case', () => {
    const view = make('FOO', { anchor: 0, head: 3 });
    replaceCurrent(view, 'foo', 'bar');
    expect(view.state.doc.toString()).toBe('bar');
  });

  it('puts the cursor after the replacement when there is no next match', () => {
    const view = make('foo', { anchor: 0, head: 3 });
    replaceCurrent(view, 'foo', 'bar');
    expect(view.state.doc.toString()).toBe('bar');
    expect(sel(view)).toEqual([3, 3]);
  });

  it('skips the replacement text when it contains the query', () => {
    const view = make('foo foo', { anchor: 0, head: 3 });
    replaceCurrent(view, 'foo', 'foofoo');
    expect(view.state.doc.toString()).toBe('foofoo foo');
    expect(sel(view)).toEqual([7, 10]);
  });

  it.each([
    ['an empty selection', { anchor: 0 }],
    ['a selection that is not a match', { anchor: 0, head: 1 }],
  ])('only moves to the next match when there is %s', (_n, selection) => {
    const view = make('a foo', selection);
    expect(replaceCurrent(view, 'foo', 'bar')).toBe(true);
    expect(view.state.doc.toString()).toBe('a foo');
    expect(sel(view)).toEqual([2, 5]);
  });

  it('returns false for an empty query', () => {
    const view = make('foo', { anchor: 0, head: 3 });
    expect(replaceCurrent(view, '', 'bar')).toBe(false);
    expect(view.state.doc.toString()).toBe('foo');
  });
});

describe('replaceAll', () => {
  it('replaces every match and returns the count', () => {
    const view = make('foo Foo foo');
    expect(replaceAll(view, 'foo', 'x')).toBe(3);
    expect(view.state.doc.toString()).toBe('x x x');
  });

  it('returns 0 and leaves the document untouched when nothing matches', () => {
    const view = make('abc');
    expect(replaceAll(view, 'zzz', 'x')).toBe(0);
    expect(view.state.doc.toString()).toBe('abc');
  });
});

describe('getMatchInfo', () => {
  it('reports the 1-based index of the selected match and the total', () => {
    const view = make('foo bar foo', { anchor: 8, head: 11 });
    expect(getMatchInfo(view.state, 'foo')).toEqual({ index: 2, total: 2 });
  });

  it('reports index 0 when the selection is not a match', () => {
    const view = make('foo bar foo', { anchor: 4 });
    expect(getMatchInfo(view.state, 'foo')).toEqual({ index: 0, total: 2 });
  });

  it('reports no results for an empty query', () => {
    expect(getMatchInfo(make('foo').state, '')).toEqual({ index: 0, total: 0 });
  });
});
