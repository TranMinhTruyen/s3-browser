import { history, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createQuery,
  DEFAULT_FIND_OPTIONS,
  type FindOptions,
  findAll,
  findNext,
  getMatchInfo,
  replaceAll,
  replaceCurrent,
  selectNext,
} from '@/pages/sql/utils/findReplace';
import { createView } from '@/test/_helpers/codemirror';

const q = (search: string, options: Partial<FindOptions> = {}) =>
  createQuery(search, { ...DEFAULT_FIND_OPTIONS, ...options });
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
    expect(findAll(state, q('foo')).map(({ from, to }) => [from, to])).toEqual([
      [0, 3],
      [8, 11],
      [12, 15],
    ]);
  });

  it.each([
    ['empty query', ''],
    ['no match', 'zzz'],
  ])('returns nothing for %s', (_n, query) => {
    expect(findAll(make('foo').state, q(query))).toEqual([]);
  });
});

describe('findNext', () => {
  it('finds the first match at or after the position', () => {
    const s = make('foo bar foo').state;
    expect(findNext(s, q('foo'), 1)).toMatchObject({ from: 8, to: 11 });
    expect(findNext(s, q('foo'), 8)).toMatchObject({ from: 8, to: 11 });
  });

  it('wraps to the start of the document', () => {
    expect(findNext(make('foo bar').state, q('foo'), 4)).toMatchObject({ from: 0, to: 3 });
  });

  it('returns null for an empty query or no match', () => {
    const s = make('foo').state;
    expect(findNext(s, q(''), 0)).toBeNull();
    expect(findNext(s, q('zzz'), 0)).toBeNull();
  });
});

describe('selectNext', () => {
  it('selects the match after the current selection and wraps around', () => {
    const view = make('a foo b foo', { anchor: 0 });
    expect(selectNext(view, q('foo'))).toBe(true);
    expect(sel(view)).toEqual([2, 5]);
    expect(selectNext(view, q('foo'))).toBe(true);
    expect(sel(view)).toEqual([8, 11]);
    expect(selectNext(view, q('foo'))).toBe(true);
    expect(sel(view)).toEqual([2, 5]);
  });

  it('returns false and keeps the selection when nothing matches', () => {
    const view = make('abc', { anchor: 1 });
    expect(selectNext(view, q('zzz'))).toBe(false);
    expect(sel(view)).toEqual([1, 1]);
  });
});

describe('replaceCurrent', () => {
  it('replaces a selected match and selects the next one in one undo-able transaction', () => {
    const view = make('foo x foo', { anchor: 0, head: 3 });
    expect(replaceCurrent(view, q('foo'), 'bar')).toBe(true);
    expect(view.state.doc.toString()).toBe('bar x foo');
    expect(sel(view)).toEqual([6, 9]);
  });

  it('matches the selection ignoring case', () => {
    const view = make('FOO', { anchor: 0, head: 3 });
    replaceCurrent(view, q('foo'), 'bar');
    expect(view.state.doc.toString()).toBe('bar');
  });

  it('puts the cursor after the replacement when there is no next match', () => {
    const view = make('foo', { anchor: 0, head: 3 });
    replaceCurrent(view, q('foo'), 'bar');
    expect(view.state.doc.toString()).toBe('bar');
    expect(sel(view)).toEqual([3, 3]);
  });

  it('skips the replacement text when it contains the query', () => {
    const view = make('foo foo', { anchor: 0, head: 3 });
    replaceCurrent(view, q('foo'), 'foofoo');
    expect(view.state.doc.toString()).toBe('foofoo foo');
    expect(sel(view)).toEqual([7, 10]);
  });

  it.each([
    ['an empty selection', { anchor: 0 }],
    ['a selection that is not a match', { anchor: 0, head: 1 }],
  ])('only moves to the next match when there is %s', (_n, selection) => {
    const view = make('a foo', selection);
    expect(replaceCurrent(view, q('foo'), 'bar')).toBe(true);
    expect(view.state.doc.toString()).toBe('a foo');
    expect(sel(view)).toEqual([2, 5]);
  });

  it('returns false for an empty query', () => {
    const view = make('foo', { anchor: 0, head: 3 });
    expect(replaceCurrent(view, q(''), 'bar')).toBe(false);
    expect(view.state.doc.toString()).toBe('foo');
  });
});

describe('replaceAll', () => {
  it('replaces every match and returns the count', () => {
    const view = make('foo Foo foo');
    expect(replaceAll(view, q('foo'), 'x')).toBe(3);
    expect(view.state.doc.toString()).toBe('x x x');
  });

  it('returns 0 and leaves the document untouched when nothing matches', () => {
    const view = make('abc');
    expect(replaceAll(view, q('zzz'), 'x')).toBe(0);
    expect(view.state.doc.toString()).toBe('abc');
  });
});

describe('getMatchInfo', () => {
  it('reports the 1-based index of the selected match and the total', () => {
    const view = make('foo bar foo', { anchor: 8, head: 11 });
    expect(getMatchInfo(view.state, q('foo'))).toEqual({ index: 2, total: 2 });
  });

  it('reports index 0 when the selection is not a match', () => {
    const view = make('foo bar foo', { anchor: 4 });
    expect(getMatchInfo(view.state, q('foo'))).toEqual({ index: 0, total: 2 });
  });

  it('reports no results for an empty query', () => {
    expect(getMatchInfo(make('foo').state, q(''))).toEqual({ index: 0, total: 0 });
  });
});

describe('createQuery', () => {
  it('is valid for text, invalid for empty text and for a broken regular expression', () => {
    expect(q('a').valid).toBe(true);
    expect(q('').valid).toBe(false);
    expect(q('(', { regexp: true }).valid).toBe(false);
    expect(q('(').valid).toBe(true);
  });

  it('treats backslash sequences literally when the regexp option is off', () => {
    expect(findAll(make('a\\nb\na').state, q('\\n'))).toHaveLength(1);
  });
});

describe('options', () => {
  const froms = (doc: string, search: string, options: Partial<FindOptions>) =>
    findAll(make(doc).state, q(search, options)).map(m => m.from);

  it.each([
    ['all off: ignores case', 'Foo foo FOO', 'foo', {}, [0, 4, 8]],
    ['all off: regex characters are literal', 'a.c abc', 'a.c', {}, [0]],
    ['match case', 'Foo foo FOO', 'foo', { caseSensitive: true }, [4]],
    ['whole word', 'foo foobar barfoo foo', 'foo', { wholeWord: true }, [0, 18]],
    ['whole word and match case', 'Foo foo foobar', 'foo', { wholeWord: true, caseSensitive: true }, [4]],
    ['regex', 'a1 b22 c', '[a-z]\\d+', { regexp: true }, [0, 3]],
    ['regex ignores case by default', 'Ab ab', 'ab', { regexp: true }, [0, 3]],
    ['regex with match case', 'Ab ab', 'ab', { regexp: true, caseSensitive: true }, [3]],
    ['regex with whole word', 'ab abc ab', 'ab', { regexp: true, wholeWord: true }, [0, 7]],
  ] as const)('%s', (_n, doc, search, options, expected) => {
    expect(froms(doc, search, options)).toEqual(expected);
  });

  it('returns nothing for an invalid regular expression', () => {
    const view = make('a(b', { anchor: 0 });
    const query = q('(', { regexp: true });
    expect(findAll(view.state, query)).toEqual([]);
    expect(findNext(view.state, query, 0)).toBeNull();
    expect(selectNext(view, query)).toBe(false);
    expect(replaceAll(view, query, 'x')).toBe(0);
    expect(getMatchInfo(view.state, query)).toEqual({ index: 0, total: 0 });
  });

  it('skips empty matches of a pattern like a*, without hanging', () => {
    const view = make('baaac', { anchor: 0 });
    const query = q('a*', { regexp: true });
    expect(findAll(view.state, query)).toEqual([expect.objectContaining({ from: 1, to: 4 })]);
    expect(findNext(view.state, query, 4)).toEqual(expect.objectContaining({ from: 1, to: 4 }));
    expect(replaceAll(view, query, 'X')).toBe(1);
    expect(view.state.doc.toString()).toBe('bXc');
  });

  it('finds nothing when a pattern only matches the empty string', () => {
    const view = make('bcd', { anchor: 0 });
    expect(findAll(view.state, q('a*', { regexp: true }))).toEqual([]);
    expect(selectNext(view, q('a*', { regexp: true }))).toBe(false);
  });
});

describe('replacement with a regular expression', () => {
  const run = (doc: string, search: string, replacement: string, options: Partial<FindOptions> = { regexp: true }) => {
    const view = make(doc);
    const count = replaceAll(view, q(search, options), replacement);
    return { count, text: view.state.doc.toString(), view };
  };

  it.each([
    ['$1 and $2 groups', 'john smith', '(\\w+) (\\w+)', '$2, $1', 'smith, john'],
    ['$& is the whole match', 'a1 b2', '[a-z]\\d', '[$&]', '[a1] [b2]'],
    ['$$ is a dollar sign', 'a b', '\\w', '$$', '$ $'],
    ['$0 is not a group and stays literal', 'ab', 'a(b)', '$0', '$0'],
    ['a group that does not exist stays literal', 'ab', 'a(b)', '$2', '$2'],
    ['$12 with one group is group 1 followed by 2', 'ab', 'a(b)', '$12', 'b2'],
    ['$10 with two groups is group 1 followed by 0', 'abc', 'a(b)(c)', '$10', 'b0'],
    ['$11 with eleven groups is group 11', 'abcdefghijk', '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', '$11', 'k'],
    ['a group that did not take part is empty', 'a', 'a(b)?', '[$1]', '[]'],
    ['text without $ is inserted as is', 'a', 'a', 'x\\1', 'x\\1'],
  ])('%s', (_n, doc, search, replacement, expected) => {
    expect(run(doc, search, replacement).text).toBe(expected);
  });

  it('keeps $1 and $& literal when the regexp option is off', () => {
    expect(run('a(b)', 'a(b)', '$1$&$$', {}).text).toBe('$1$&$$');
  });

  it('replaces all matches as a single undo step', () => {
    const view = createView('a1 a2 a3', undefined, [history()]);
    views.push(view);
    expect(replaceAll(view, q('a(\\d)', { regexp: true }), '<$1>')).toBe(3);
    expect(view.state.doc.toString()).toBe('<1> <2> <3>');
    undo(view);
    expect(view.state.doc.toString()).toBe('a1 a2 a3');
  });

  it('replaceCurrent expands groups for the selected match and selects the next one', () => {
    const view = make('k=1 k=2', { anchor: 0, head: 3 });
    const query = q('k=(\\d)', { regexp: true });
    expect(replaceCurrent(view, query, 'v$1$1')).toBe(true);
    expect(view.state.doc.toString()).toBe('v11 k=2');
    expect(sel(view)).toEqual([4, 7]);
  });

  it('replaceCurrent does not treat a selection that is only part of a match as a match', () => {
    const view = make('abc abc', { anchor: 0, head: 2 });
    const query = q('abc', { regexp: true });
    expect(replaceCurrent(view, query, 'x')).toBe(true);
    expect(view.state.doc.toString()).toBe('abc abc');
    expect(sel(view)).toEqual([4, 7]);
  });

  it('replaceCurrent honors match case for the selection', () => {
    const upper = make('FOO foo', { anchor: 0, head: 3 });
    expect(replaceCurrent(upper, q('foo', { caseSensitive: true }), 'x')).toBe(true);
    expect(upper.state.doc.toString()).toBe('FOO foo');
    expect(sel(upper)).toEqual([4, 7]);
  });

  // BUG (reported): the selection is searched alone, so the neighbours that decide "whole word" are not seen.
  it('replaceCurrent does not replace a selection that is only part of a longer word', () => {
    const inWord = make('foobar foo', { anchor: 0, head: 3 });
    replaceCurrent(inWord, q('foo', { wholeWord: true }), 'x');
    expect(inWord.state.doc.toString()).toBe('foobar foo');
    expect(sel(inWord)).toEqual([7, 10]);
  });
});
