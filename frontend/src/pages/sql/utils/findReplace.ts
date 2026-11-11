import { SearchCursor } from '@codemirror/search';
import { type EditorState, type SelectionRange, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type Range = { from: number; to: number };

const normalize = (text: string) => text.toLowerCase();

/** All case-insensitive matches of `query`, in document order. */
export const findAll = (state: EditorState, query: string): Range[] => {
  if (!query) return [];
  const matches: Range[] = [];
  const cursor = new SearchCursor(state.doc, query, 0, state.doc.length, normalize);
  while (!cursor.next().done) matches.push({ from: cursor.value.from, to: cursor.value.to });
  return matches;
};

/** First match starting at or after `from`, wrapping to the start of the document. Null when there is none. */
export const findNext = (state: EditorState, query: string, from: number): Range | null => {
  if (!query) return null;
  const length = state.doc.length;
  for (const [start, end] of [
    [from, length],
    [0, from],
  ]) {
    const cursor = new SearchCursor(state.doc, query, start, end, normalize);
    if (!cursor.next().done) return { from: cursor.value.from, to: cursor.value.to };
  }
  return null;
};

const isMatch = (state: EditorState, query: string, range: SelectionRange) =>
  !!query && range.from !== range.to && normalize(state.sliceDoc(range.from, range.to)) === normalize(query);

/** Selects the next match after the current selection. Returns false when there is no match. */
export const selectNext = (view: EditorView, query: string): boolean => {
  const match = findNext(view.state, query, view.state.selection.main.to);
  if (!match) return false;
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
  return true;
};

/**
 * Replaces the selected match (when the selection is one) and selects the next one, in a single transaction.
 * When the selection is not a match it only moves to the next match. Returns false when nothing was found.
 */
export const replaceCurrent = (view: EditorView, query: string, replacement: string): boolean => {
  const { state } = view;
  const current = state.selection.main;
  if (!isMatch(state, query, current)) return selectNext(view, query);

  const changes = { from: current.from, to: current.to, insert: replacement };
  const after = state.update({ changes }).state;
  const next = findNext(after, query, current.from + replacement.length);
  view.dispatch({
    changes,
    selection: next ? { anchor: next.from, head: next.to } : { anchor: current.from + replacement.length },
    scrollIntoView: true,
    annotations: Transaction.userEvent.of('input.replace'),
  });
  return true;
};

/** Replaces every match in one transaction (one undo step). Returns how many were replaced. */
export const replaceAll = (view: EditorView, query: string, replacement: string): number => {
  const matches = findAll(view.state, query);
  if (matches.length === 0) return 0;
  view.dispatch({
    changes: matches.map(match => ({ ...match, insert: replacement })),
    userEvent: 'input.replace.all',
  });
  return matches.length;
};

/** 1-based position of the selected match among all matches (0 when the selection is not a match) and the total. */
export const getMatchInfo = (state: EditorState, query: string) => {
  const matches = findAll(state, query);
  const { from, to } = state.selection.main;
  return { index: matches.findIndex(match => match.from === from && match.to === to) + 1, total: matches.length };
};
