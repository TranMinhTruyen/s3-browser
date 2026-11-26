import { GetSchemaTree } from '@wails/S3Browser/internal/handlers/dbhandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useDbTreeStore } from '@/pages/sql/stores/dbTreeStore';
import { pgProfile, sqliteProfile, toProfileMap } from '@/test/_helpers/dbProfiles';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({ GetSchemaTree: vi.fn() }));

const callIPCMock = vi.mocked(callIPC);
const tree = () => useDbTreeStore.getState();
const SEP = '\u001f';

const mainSchema = { name: 'main', tables: ['users'], views: ['v1'], indexes: [], triggers: [] };
const TOP = `s1${SEP}${SEP}main`;

/** Lời gọi GetSchemaTree chỉ hoàn tất khi kiểm thử cho phép. */
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let signal!: AbortSignal;
  const promise = new Promise(r => {
    resolve = r;
  });
  callIPCMock.mockImplementationOnce(((_b: unknown, _a: unknown, o: { signal: AbortSignal }) => {
    signal = o.signal;
    return promise;
  }) as never);
  return { resolve: (v: unknown) => resolve(v), signal: () => signal };
};

beforeEach(() => {
  vi.clearAllMocks();
  useDbTreeStore.getState().reset();
  vi.mocked(invalidateLoads).mockClear();
  useDbProfileStore.setState({
    dbProfiles: toProfileMap(
      sqliteProfile('s1', { isConnected: true }),
      sqliteProfile('s2', { isConnected: true }),
      sqliteProfile('off', { isConnected: false }),
      pgProfile('pg', {
        isConnected: true,
        config: { host: 'h', port: 1, database: 'app', username: 'u', sslMode: 'prefer' },
      })
    ),
  });
  callIPCMock.mockResolvedValue({ schemas: [mainSchema] } as never);
});

describe('openProfile', () => {
  it('does nothing for an unknown or disconnected profile', async () => {
    await tree().openProfile('nope');
    await tree().openProfile('off');
    expect(tree().opened).toEqual({});
    expect(tree().trees).toEqual({});
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('opens the Accordion, shows loading, then holds the SQLite tree with its top node expanded', async () => {
    const call = deferred();
    const pending = tree().openProfile('s1');

    expect(tree().opened.s1).toBe(true);
    expect(tree().trees.s1).toEqual({ status: 'loading', nodes: [], tableNames: [] });

    call.resolve({ schemas: [mainSchema] });
    await pending;

    expect(callIPCMock).toHaveBeenCalledWith(GetSchemaTree, [{ profileId: 's1' }], {
      signal: expect.any(AbortSignal),
      scope: 'dbTree/load/s1',
    });
    expect(tree().trees.s1?.status).toBe('ready');
    expect(tree().trees.s1?.nodes[0].value).toBe(TOP);
    expect(tree().trees.s1?.tableNames).toEqual(['users', 'v1']);
    expect(tree().expanded[TOP]).toBe(true);
  });

  it('puts a database node on top for PostgreSQL (mock data, no backend call)', async () => {
    await tree().openProfile('pg');

    const nodes = tree().trees.pg?.nodes ?? [];
    expect(nodes.map(n => n.label)).toEqual(['app']);
    expect(nodes[0].children?.map(n => n.label)).toEqual(['public', 'sales']);
    expect(tree().expanded[nodes[0].value]).toBe(true);
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('uses an empty database name when the PostgreSQL profile has none', async () => {
    useDbProfileStore.setState({
      dbProfiles: toProfileMap(pgProfile('pg', { isConnected: true, config: {} as never })),
    });
    await tree().openProfile('pg');
    expect(tree().trees.pg?.nodes.map(n => n.label)).toEqual(['']);
  });

  it('does not load again when the tree is ready, even after closing and opening', async () => {
    await tree().openProfile('s1');
    tree().closeProfile('s1');
    await tree().openProfile('s1');

    expect(callIPCMock).toHaveBeenCalledTimes(1);
    expect(tree().opened.s1).toBe(true);
  });

  it('keeps a failed load as an error with no nodes, and retries it on the next open', async () => {
    callIPCMock.mockResolvedValueOnce(null);
    await tree().openProfile('s1');
    expect(tree().trees.s1).toEqual({ status: 'error', nodes: [], tableNames: [] });

    await tree().openProfile('s1');
    expect(callIPCMock).toHaveBeenCalledTimes(2);
    expect(tree().trees.s1?.status).toBe('ready');
  });

  it('ignores the result when the profile was dropped while loading', async () => {
    const call = deferred();
    const pending = tree().openProfile('s1');

    tree().dropProfile('s1');
    expect(call.signal().aborted).toBe(true);
    call.resolve({ schemas: [mainSchema] });
    await pending;

    expect(tree().trees.s1).toBeUndefined();
    expect(tree().opened.s1).toBeUndefined();
  });
});

describe('refreshProfile', () => {
  it('does nothing for a disconnected or unknown profile', async () => {
    await tree().refreshProfile('off');
    await tree().refreshProfile('nope');
    expect(tree().trees).toEqual({});
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('reloads the tree, going through loading first', async () => {
    await tree().openProfile('s1');
    const call = deferred();

    const pending = tree().refreshProfile('s1');
    expect(tree().trees.s1?.status).toBe('loading');
    call.resolve({ schemas: [{ ...mainSchema, tables: ['orders'] }] });
    await pending;

    expect(tree().trees.s1?.tableNames).toEqual(['orders', 'v1']);
  });

  it('keeps what the user collapsed and selected', async () => {
    await tree().openProfile('s1');
    tree().toggleNode(TOP);
    tree().selectNode(`${TOP}${SEP}tables`);

    await tree().refreshProfile('s1');

    expect(tree().expanded[TOP]).toBe(false);
    expect(tree().selected).toBe(`${TOP}${SEP}tables`);
  });

  it('aborts a load in flight and only the newer result lands', async () => {
    const first = deferred();
    const opening = tree().openProfile('s1');
    const second = deferred();

    const refreshing = tree().refreshProfile('s1');
    expect(first.signal().aborted).toBe(true);
    second.resolve({ schemas: [{ ...mainSchema, tables: ['new'] }] });
    await refreshing;
    first.resolve({ schemas: [{ ...mainSchema, tables: ['old'] }] });
    await opening;

    expect(tree().trees.s1?.tableNames).toEqual(['new', 'v1']);
  });

  it('shows an error when the reload fails', async () => {
    await tree().openProfile('s1');
    callIPCMock.mockResolvedValueOnce(null);
    await tree().refreshProfile('s1');
    expect(tree().trees.s1?.status).toBe('error');
  });
});

describe('toggles and selection', () => {
  it('toggleProfile opens a connected profile and closes it again', async () => {
    tree().toggleProfile('s1');
    await vi.waitFor(() => expect(tree().trees.s1?.status).toBe('ready'));
    expect(tree().opened.s1).toBe(true);

    tree().toggleProfile('s1');
    expect(tree().opened.s1).toBeUndefined();
    expect(tree().trees.s1?.status).toBe('ready');
  });

  it('toggleNode flips the expanded flag, starting from collapsed', () => {
    tree().toggleNode('x');
    expect(tree().expanded.x).toBe(true);
    tree().toggleNode('x');
    expect(tree().expanded.x).toBe(false);
  });

  it('selectNode keeps one selected node', () => {
    tree().selectNode('a');
    tree().selectNode('b');
    expect(tree().selected).toBe('b');
  });
});

describe('dropProfile', () => {
  it('removes only the Accordion, tree, expanded and selected node of that profile', async () => {
    await tree().openProfile('s1');
    await tree().openProfile('s2');
    tree().selectNode(TOP);

    tree().dropProfile('s1');

    expect(tree().opened).toEqual({ s2: true });
    expect(Object.keys(tree().trees)).toEqual(['s2']);
    expect(Object.keys(tree().expanded)).toEqual([`s2${SEP}${SEP}main`]);
    expect(tree().selected).toBeNull();
  });

  it('keeps the selection of another profile', async () => {
    await tree().openProfile('s2');
    tree().selectNode(`s2${SEP}${SEP}main`);
    tree().dropProfile('s1');
    expect(tree().selected).toBe(`s2${SEP}${SEP}main`);
  });

  it('is harmless for a profile that was never opened', () => {
    tree().dropProfile('nope');
    expect(tree().opened).toEqual({});
  });
});

describe('reset', () => {
  it('clears the state, stops the loads in flight and invalidates the scope', async () => {
    const call = deferred();
    const pending = tree().openProfile('s1');
    tree().selectNode('a');

    tree().reset();
    expect(call.signal().aborted).toBe(true);
    call.resolve({ schemas: [mainSchema] });
    await pending;

    expect(invalidateLoads).toHaveBeenCalledWith('dbTree');
    expect(tree()).toMatchObject({ opened: {}, trees: {}, expanded: {}, selected: null });
  });
});
