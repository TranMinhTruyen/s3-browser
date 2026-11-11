import { history } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dbTypeToDialect, formatEditorSql } from '@/pages/sql/utils/sqlFormat';
import { createView } from '@/test/_helpers/codemirror';

const views: EditorView[] = [];
const make = (doc: string, selection?: { anchor: number; head?: number }) => {
  const view = createView(doc, selection, [history()]);
  views.push(view);
  return view;
};

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  vi.doUnmock('sql-formatter');
  vi.resetModules();
});

describe('dbTypeToDialect', () => {
  it.each([
    ['postgresql', 'postgresql'],
    ['sqlite', 'sqlite'],
    [null, 'sql'],
  ] as const)('%s -> %s', (dbType, expected) => {
    expect(dbTypeToDialect(dbType)).toBe(expected);
  });
});

describe('formatEditorSql', () => {
  it('formats the whole document when nothing is selected', async () => {
    const view = make('select a,b from t where x=1');
    const result = await formatEditorSql(view, null);
    expect(result).toEqual({ ok: true, scope: 'all' });
    expect(view.state.doc.toString()).toBe('select\n  a,\n  b\nfrom\n  t\nwhere\n  x = 1');
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
  });

  it('formats only the selection and keeps the rest', async () => {
    const view = make('select 1; select a,b from t', { anchor: 10, head: 27 });
    const result = await formatEditorSql(view, 'postgresql');
    expect(result).toEqual({ ok: true, scope: 'selection' });
    expect(view.state.doc.toString().startsWith('select 1; ')).toBe(true);
    expect(view.state.doc.toString()).toContain('\n');
  });

  it.each(['postgresql', 'sqlite'] as const)('accepts the %s dialect', async dbType => {
    const view = make('select 1');
    expect(await formatEditorSql(view, dbType)).toEqual({ ok: true, scope: 'all' });
  });

  it('is undone in a single step', async () => {
    const { undo } = await import('@codemirror/commands');
    const view = make('select a,b from t');
    await formatEditorSql(view, null);
    undo(view);
    expect(view.state.doc.toString()).toBe('select a,b from t');
  });

  it.each([
    ['an empty document', ''],
    ['a blank document', '  \n '],
  ])('returns null for %s', async (_n, doc) => {
    const view = make(doc);
    expect(await formatEditorSql(view, null)).toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('returns null when the text changed while the formatter loaded', async () => {
    const view = make('select 1');
    const promise = formatEditorSql(view, null);
    view.dispatch({ changes: { from: 0, insert: 'x ' } });
    expect(await promise).toBeNull();
    expect(view.state.doc.toString()).toBe('x select 1');
  });

  it.each([
    ['an Error', new Error('boom'), 'boom'],
    ['a string', 'bad', 'bad'],
  ])('returns ok:false with the message when the formatter throws %s', async (_n, thrown, message) => {
    vi.resetModules();
    vi.doMock('sql-formatter', () => ({
      formatDialect: () => {
        throw thrown;
      },
      sql: {},
      postgresql: {},
      sqlite: {},
    }));
    const { formatEditorSql: format } = await import('@/pages/sql/utils/sqlFormat');
    const view = make('select 1');
    expect(await format(view, null)).toEqual({ ok: false, message });
    expect(view.state.doc.toString()).toBe('select 1');
  });
});
