import { FetchRows, GetSchemaTree, GetTableInfo, OpenTableRows } from '@wails/S3Browser/internal/handlers/dbhandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import {
  buildTreeNodes,
  fetchTableRows,
  isNodeOf,
  listTableNames,
  loadSchemas,
  loadTableInfo,
  type NodeMeta,
  openTableRows,
} from '@/pages/sql/utils/dbObjectSource';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({
  GetSchemaTree: vi.fn(),
  GetTableInfo: vi.fn(),
  OpenTableRows: vi.fn(),
  FetchRows: vi.fn(),
}));

const callIPCMock = vi.mocked(callIPC);
const signal = new AbortController().signal;
const ref = { profileId: 'p1', schema: 'public', table: 'users' };
const SEP = '\u001f';

const schema = {
  name: 'main',
  tables: ['a', 'b'],
  views: ['v', 'a'],
  indexes: [{ name: 'idx_a', table: 'a' }],
  triggers: [{ name: 'trg_a', table: 'a' }],
};

beforeEach(() => vi.clearAllMocks());

describe('isNodeOf', () => {
  it('matches only values that start with the profile id and the separator', () => {
    expect(isNodeOf('p1', `p1${SEP}main`)).toBe(true);
    expect(isNodeOf('p1', `p10${SEP}main`)).toBe(false);
    expect(isNodeOf('p1', 'p1')).toBe(false);
  });
});

describe('buildTreeNodes', () => {
  it('puts the schemas at the top for SQLite, each with four groups', () => {
    const nodes = buildTreeNodes('p1', null, [schema as never]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].value).toBe(`p1${SEP}${SEP}main`);
    expect(nodes[0].nodeProps).toEqual({ kind: 'schema', schema: 'main', name: 'main' });
    const groups = nodes[0].children ?? [];
    expect(groups.map(g => (g.nodeProps as NodeMeta).group)).toEqual(['tables', 'views', 'indexes', 'triggers']);
    expect(groups.map(g => g.children?.map(c => c.label))).toEqual([['a', 'b'], ['v', 'a'], ['idx_a'], ['trg_a']]);
    expect(groups[0].children?.[0].nodeProps).toEqual({ kind: 'table', schema: 'main', name: 'a' });
    expect(groups[1].children?.[0].nodeProps).toMatchObject({ kind: 'view' });
    expect(groups[2].children?.[0].nodeProps).toMatchObject({ kind: 'index' });
    expect(groups[3].children?.[0].nodeProps).toMatchObject({ kind: 'trigger' });
  });

  it('gives every node a unique value that belongs to the profile', () => {
    const nodes = buildTreeNodes('p1', null, [schema as never]);
    const values: string[] = [];
    const walk = (list: typeof nodes) => {
      for (const n of list) {
        values.push(n.value);
        walk(n.children ?? []);
      }
    };
    walk(nodes);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every(v => isNodeOf('p1', v))).toBe(true);
  });

  it('wraps the schemas in a database node for PostgreSQL', () => {
    const nodes = buildTreeNodes('p1', 'app', [schema as never]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].nodeProps).toEqual({ kind: 'database', schema: '', name: 'app' });
    expect(nodes[0].children?.[0].nodeProps).toMatchObject({ kind: 'schema', name: 'main' });
    expect(nodes[0].children?.[0].value).toBe(`p1${SEP}app${SEP}main`);
  });

  it('treats missing lists as empty', () => {
    const nodes = buildTreeNodes('p1', null, [{ name: 'main' } as never]);
    expect(nodes[0].children?.map(g => g.children)).toEqual([[], [], [], []]);
  });

  it('returns no node for no schema', () => {
    expect(buildTreeNodes('p1', null, [])).toEqual([]);
    expect(buildTreeNodes('p1', 'app', [])[0].children).toEqual([]);
  });
});

describe('listTableNames', () => {
  it('lists the tables and views once each, across schemas', () => {
    expect(listTableNames([schema as never, { name: 'x', tables: ['c'], views: [] } as never])).toEqual([
      'a',
      'b',
      'v',
      'c',
    ]);
  });

  it('copes with missing lists', () => {
    expect(listTableNames([{ name: 'x' } as never])).toEqual([]);
  });
});

describe('loadSchemas', () => {
  it('reads the mock for PostgreSQL without calling the backend', async () => {
    const schemas = await loadSchemas('postgres', 'p1', signal, 'scope');
    expect(schemas?.map(s => s.name)).toEqual(['public', 'sales']);
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('calls GetSchemaTree for SQLite with the signal and scope', async () => {
    callIPCMock.mockResolvedValue({ schemas: [schema] } as never);
    expect(await loadSchemas('sqlite', 'p1', signal, 'scope')).toEqual([schema]);
    expect(callIPCMock).toHaveBeenCalledWith(GetSchemaTree, [{ profileId: 'p1' }], { signal, scope: 'scope' });
  });

  it('returns an empty list when the body has no schemas', async () => {
    callIPCMock.mockResolvedValue({} as never);
    expect(await loadSchemas('sqlite', 'p1', signal, 'scope')).toEqual([]);
  });

  it('returns null when the call failed', async () => {
    callIPCMock.mockResolvedValue(null);
    expect(await loadSchemas('sqlite', 'p1', signal, 'scope')).toBeNull();
  });
});

describe('loadTableInfo', () => {
  it('reads the mock for PostgreSQL', async () => {
    expect((await loadTableInfo('postgres', ref, signal))?.columns).toHaveLength(4);
    expect(await loadTableInfo('postgres', { ...ref, table: 'nope' }, signal)).toBeNull();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('calls GetTableInfo for SQLite', async () => {
    const info = { columns: [] };
    callIPCMock.mockResolvedValue(info as never);
    expect(await loadTableInfo('sqlite', ref, signal)).toBe(info);
    expect(callIPCMock).toHaveBeenCalledWith(GetTableInfo, [ref], { signal });
  });

  it('returns null when GetTableInfo gives no body', async () => {
    callIPCMock.mockResolvedValue(null);
    expect(await loadTableInfo('sqlite', ref, signal)).toBeNull();
  });
});

describe('openTableRows', () => {
  it('builds the first page from the mock: a long table keeps a cursor, a short one has none', async () => {
    const wide = await openTableRows('postgres', 't1', { ...ref, table: 'wide_events' }, signal);
    expect(wide?.rows).toHaveLength(10_000);
    expect([wide?.done, wide?.cursorId]).toEqual([false, 0]);

    const users = await openTableRows('postgres', 't1', ref, signal);
    expect([users?.done, users?.cursorId]).toEqual([true, null]);
  });

  it('returns null for an unknown mock table', async () => {
    expect(await openTableRows('postgres', 't1', { ...ref, table: 'nope' }, signal)).toBeNull();
  });

  it('calls OpenTableRows for SQLite with the tab id and maps the column names', async () => {
    callIPCMock.mockResolvedValue({
      columns: [{ name: 'id', type: 'INTEGER' }],
      rows: [['1']],
      done: false,
      cursorId: 7,
    } as never);

    expect(await openTableRows('sqlite', 't1', ref, signal)).toEqual({
      columns: ['id'],
      rows: [['1']],
      done: false,
      cursorId: 7,
    });
    expect(callIPCMock).toHaveBeenCalledWith(OpenTableRows, [{ ...ref, tabId: 't1' }], { signal });
  });

  it('returns null when OpenTableRows failed', async () => {
    callIPCMock.mockResolvedValue(null);
    expect(await openTableRows('sqlite', 't1', ref, signal)).toBeNull();
  });
});

describe('fetchTableRows', () => {
  it('reads the mock from the number of loaded rows', async () => {
    const page = await fetchTableRows('postgres', 't1', { ...ref, table: 'wide_events' }, 0, 10_000, signal);
    expect(page?.rows).toHaveLength(10_000);
    expect(page?.rows[0][0]).toBe('10001');
    expect(page?.done).toBe(false);
  });

  it('calls FetchRows for SQLite with the cursor', async () => {
    const page = { rows: [['2']], done: true };
    callIPCMock.mockResolvedValue(page as never);
    expect(await fetchTableRows('sqlite', 't1', ref, 7, 1, signal)).toBe(page);
    expect(callIPCMock).toHaveBeenCalledWith(FetchRows, [{ tabId: 't1', cursorId: 7 }], { signal });
  });

  it('returns null when FetchRows failed', async () => {
    callIPCMock.mockResolvedValue(null);
    expect(await fetchTableRows('sqlite', 't1', ref, 7, 1, signal)).toBeNull();
  });
});
