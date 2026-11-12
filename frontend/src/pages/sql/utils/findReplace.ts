import { SearchQuery } from '@codemirror/search';
import { type EditorState, type SelectionRange, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type Range = { from: number; to: number };
/** A regex match also carries the `RegExpExecArray` (not in the CodeMirror typings) used for `$1`, `$&`. */
type Match = Range & { match?: RegExpExecArray };

export type FindOptions = { caseSensitive: boolean; wholeWord: boolean; regexp: boolean };

export const DEFAULT_FIND_OPTIONS: FindOptions = { caseSensitive: false, wholeWord: false, regexp: false };

/** Search query for the Find box. `query.valid` is false for empty text or an invalid regular expression. */
export const createQuery = (search: string, options: FindOptions) =>
  new SearchQuery({ search, ...options, literal: true });

/** Matches in `[from, to]`, in order. Empty matches (e.g. `a*`) are skipped so they can never be selected or looped on. */
function* iterate(state: EditorState, query: SearchQuery, from: number, to: number): Generator<Match> {
  if (!query.valid) return;
  const cursor = query.getCursor(state, from, to);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (next.value.from !== next.value.to) yield next.value;
  }
}

/** All matches of `query`, in document order. */
export const findAll = (state: EditorState, query: SearchQuery): Match[] => [
  ...iterate(state, query, 0, state.doc.length),
];

/** First match starting at or after `from`, wrapping to the start of the document. Null when there is none. */
export const findNext = (state: EditorState, query: SearchQuery, from: number): Match | null =>
  iterate(state, query, from, state.doc.length).next().value ?? iterate(state, query, 0, from).next().value ?? null;

/** Text a match is replaced with. With a regular expression, `$1`, `$&` and `$$` are expanded like CodeMirror does. */
const getReplacement = (query: SearchQuery, match: Match, replacement: string) => {
  const groups = match.match;
  if (!query.regexp || !groups) return replacement;
  return replacement.replace(/\$([$&]|\d+)/g, (whole, token: string) => {
    if (token === '&') return groups[0];
    if (token === '$') return '$';
    // Longest group number that exists, the rest stays literal ($12 with 1 group is group 1 + "2").
    for (let length = token.length; length > 0; length--) {
      const group = Number(token.slice(0, length));
      if (group > 0 && group < groups.length) return (groups[group] ?? '') + token.slice(length);
    }
    return whole;
  });
};

/** The match that is exactly the selected range, or null. */
const getSelectedMatch = (state: EditorState, query: SearchQuery, range: SelectionRange): Match | null => {
  if (range.from === range.to) return null;
  // Search the whole document so context (whole word, lookbehind, ^, $, \b) is seen.
  return findAll(state, query).find(match => match.from === range.from && match.to === range.to) ?? null;
};

/** Selects the next match after the current selection. Returns false when there is no match. */
export const selectNext = (view: EditorView, query: SearchQuery): boolean => {
  const match = findNext(view.state, query, view.state.selection.main.to);
  if (!match) return false;
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
  return true;
};

/**
 * Replaces the selected match (when the selection is one) and selects the next one, in a single transaction.
 * When the selection is not a match it only moves to the next match. Returns false when nothing was found.
 */
export const replaceCurrent = (view: EditorView, query: SearchQuery, replacement: string): boolean => {
  const { state } = view;
  const current = state.selection.main;
  const selected = getSelectedMatch(state, query, current);
  if (!selected) return selectNext(view, query);

  const insert = getReplacement(query, selected, replacement);
  const changes = { from: current.from, to: current.to, insert };
  const after = state.update({ changes }).state;
  const next = findNext(after, query, current.from + insert.length);
  view.dispatch({
    changes,
    selection: next ? { anchor: next.from, head: next.to } : { anchor: current.from + insert.length },
    scrollIntoView: true,
    annotations: Transaction.userEvent.of('input.replace'),
  });
  return true;
};

/** Replaces every match in one transaction (one undo step). Returns how many were replaced. */
export const replaceAll = (view: EditorView, query: SearchQuery, replacement: string): number => {
  const matches = findAll(view.state, query);
  if (matches.length === 0) return 0;
  view.dispatch({
    changes: matches.map(match => ({
      from: match.from,
      to: match.to,
      insert: getReplacement(query, match, replacement),
    })),
    userEvent: 'input.replace.all',
  });
  return matches.length;
};

/** 1-based position of the selected match among all matches (0 when the selection is not a match) and the total. */
export const getMatchInfo = (state: EditorState, query: SearchQuery) => {
  const matches = findAll(state, query);
  const { from, to } = state.selection.main;
  return { index: matches.findIndex(match => match.from === from && match.to === to) + 1, total: matches.length };
};
