import { SearchQuery } from '@codemirror/search';
import { type EditorState, type SelectionRange, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type Range = { from: number; to: number };
/** Kết quả khớp regex cũng chứa `RegExpExecArray` (không có trong khai báo kiểu của CodeMirror) để dùng `$1`, `$&`. */
type Match = Range & { match?: RegExpExecArray };

export type FindOptions = { caseSensitive: boolean; wholeWord: boolean; regexp: boolean };

export const DEFAULT_FIND_OPTIONS: FindOptions = { caseSensitive: false, wholeWord: false, regexp: false };

/** Truy vấn tìm kiếm của ô Find. `query.valid` là false nếu chuỗi rỗng hoặc biểu thức chính quy không hợp lệ. */
export const createQuery = (search: string, options: FindOptions) =>
  new SearchQuery({ search, ...options, literal: true });

/** Các kết quả khớp trong `[from, to]`, theo thứ tự. Bỏ qua kết quả rỗng (ví dụ `a*`) để không thể chọn hoặc lặp vô hạn. */
function* iterate(state: EditorState, query: SearchQuery, from: number, to: number): Generator<Match> {
  if (!query.valid) return;
  const cursor = query.getCursor(state, from, to);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (next.value.from !== next.value.to) yield next.value;
  }
}

/** Tất cả kết quả khớp với `query`, theo thứ tự trong tài liệu. */
export const findAll = (state: EditorState, query: SearchQuery): Match[] => [
  ...iterate(state, query, 0, state.doc.length),
];

/**
 * Kết quả khớp đầu tiên bắt đầu tại hoặc sau `from`, rồi quay về đầu tài liệu. Trả về null nếu không có kết quả.
 * Khi quay vòng sẽ quét toàn bộ tài liệu: cắt tại `from` sẽ bỏ sót kết quả nằm vắt qua vị trí đó.
 */
export const findNext = (state: EditorState, query: SearchQuery, from: number): Match | null =>
  iterate(state, query, from, state.doc.length).next().value ??
  iterate(state, query, 0, state.doc.length).next().value ??
  null;

/** Văn bản thay thế kết quả khớp. Với biểu thức chính quy, `$1`, `$&` và `$$` được xử lý như trong CodeMirror. */
const getReplacement = (query: SearchQuery, match: Match, replacement: string) => {
  const groups = match.match;
  if (!query.regexp || !groups) return replacement;
  return replacement.replace(/\$([$&]|\d+)/g, (whole, token: string) => {
    if (token === '&') return groups[0];
    if (token === '$') return '$';
    // Số nhóm dài nhất đang tồn tại; phần còn lại giữ nguyên ($12 với 1 nhóm được hiểu là nhóm 1 + "2").
    for (let length = token.length; length > 0; length--) {
      const group = Number(token.slice(0, length));
      if (group > 0 && group < groups.length) return (groups[group] ?? '') + token.slice(length);
    }
    return whole;
  });
};

/** Kiểm tra giống RegExpCursor của CodeMirror: mẫu này có thể khớp qua nhiều dòng. */
const MULTILINE_PATTERN = /\\[sWDnr]|\n|\r|\[\^/;

/** Kết quả khớp trùng chính xác với vùng đang chọn, hoặc null. */
const getSelectedMatch = (state: EditorState, query: SearchQuery, range: SelectionRange): Match | null => {
  if (range.from === range.to) return null;
  // Tìm trên toàn bộ các dòng quanh vùng chọn để xét được ngữ cảnh (nguyên từ, lookbehind, ^, $, \b);
  // mẫu có thể khớp qua nhiều dòng thì cần tìm trên toàn bộ tài liệu.
  const multiline = MULTILINE_PATTERN.test(query.search);
  const from = multiline ? 0 : state.doc.lineAt(range.from).from;
  const to = multiline ? state.doc.length : state.doc.lineAt(range.to).to;
  for (const match of iterate(state, query, from, to)) {
    if (match.from === range.from && match.to === range.to) return match;
    if (match.from >= range.from) break;
  }
  return null;
};

/** Thêm ký tự escape cho các ký tự đặc biệt của biểu thức chính quy để khớp văn bản nguyên dạng. */
export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Chọn kết quả khớp tiếp theo sau vùng đang chọn. Trả về false nếu không có kết quả. */
export const selectNext = (view: EditorView, query: SearchQuery): boolean => {
  const match = findNext(view.state, query, view.state.selection.main.to);
  if (!match) return false;
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
  return true;
};

/**
 * Thay thế kết quả đang chọn (nếu vùng chọn là kết quả khớp) rồi chọn kết quả kế tiếp trong cùng một transaction.
 * Nếu vùng chọn không phải kết quả khớp thì chỉ chuyển đến kết quả kế tiếp. Trả về false nếu không tìm thấy gì.
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

/** Thay thế mọi kết quả trong một transaction (một bước hoàn tác). Trả về số kết quả đã thay thế. */
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

/** Vị trí bắt đầu từ 1 của kết quả đang chọn trong tổng số kết quả (0 nếu vùng chọn không khớp) và tổng số kết quả. */
export const getMatchInfo = (state: EditorState, query: SearchQuery) => {
  const { from, to } = state.selection.main;
  let index = 0;
  let total = 0;
  for (const match of iterate(state, query, 0, state.doc.length)) {
    total++;
    if (match.from === from && match.to === to) index = total;
  }
  return { index, total };
};
