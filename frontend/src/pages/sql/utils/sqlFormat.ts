import type { EditorView } from '@codemirror/view';
import type { SqlDialect } from '@/pages/sql/components/sqlEditor/SqlEditor';

type FormatResult = { ok: true; scope: 'all' | 'selection' } | { ok: false; message: string } | null;

/** Maps the profile DB type to the `sql-formatter` dialect; no profile means standard SQL. */
export const dbTypeToDialect = (dbType: SqlDialect): 'sql' | 'postgresql' | 'sqlite' => dbType ?? 'sql';

/**
 * Formats the selection (or the whole document when nothing is selected) in one transaction, so a single undo
 * restores it. `sql-formatter` is loaded on first use. Returns null when there is nothing to format or the text
 * changed or the editor was closed while formatting; a syntax error leaves the document untouched.
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
    // The tab was closed (view destroyed) or the user kept typing while the formatter module loaded.
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
