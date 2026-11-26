import type { EditorView } from '@codemirror/view';
import type { SqlDialect } from '@/pages/sql/components/sqlEditor/SqlEditor';

type FormatResult = { ok: true; scope: 'all' | 'selection' } | { ok: false; message: string } | null;

/** Ánh xạ loại DB của profile sang phương ngữ `sql-formatter`; không có profile thì dùng SQL chuẩn. */
export const dbTypeToDialect = (dbType: SqlDialect): 'sql' | 'postgresql' | 'sqlite' => dbType ?? 'sql';

/**
 * Định dạng vùng chọn (hoặc toàn bộ tài liệu nếu không có vùng chọn) trong một transaction để có thể hoàn tác bằng một lần.
 * `sql-formatter` được tải ở lần sử dụng đầu tiên. Trả về null nếu không có gì để định dạng, văn bản đã đổi
 * hoặc editor bị đóng trong lúc định dạng; lỗi cú pháp sẽ giữ nguyên tài liệu.
 */
export const formatEditorSql = async (view: EditorView, dbType: SqlDialect): Promise<FormatResult> => {
  const { from, to } = view.state.selection.main;
  const scope = from === to ? 'all' : 'selection';
  const range = scope === 'all' ? { from: 0, to: view.state.doc.length } : { from, to };
  const source = view.state.sliceDoc(range.from, range.to);
  if (!source.trim()) return null;

  try {
    const { formatDialect, postgresql, sqlite, sql } = await import('sql-formatter');
    const dialects = { sql, postgresql, sqlite };
    const formatted = formatDialect(source, { dialect: dialects[dbTypeToDialect(dbType)] });
    // Tab đã đóng (view bị hủy) hoặc người dùng tiếp tục nhập trong lúc tải module định dạng.
    if (!view.dom.isConnected || view.state.sliceDoc(range.from, range.to) !== source) return null;
    view.dispatch({
      changes: { ...range, insert: formatted },
      selection: { anchor: range.from, head: range.from + formatted.length },
      userEvent: 'input.format',
    });
    return { ok: true, scope };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
