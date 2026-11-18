import { act, renderHook } from '@testing-library/react';
import { ExecuteSql, FetchRows } from '@wails/S3Browser/internal/handlers/dbhandler';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import i18n from '@/locales/i18n';
import { canLoadMore, useSqlRunner } from '@/pages/sql/hooks/useSqlRunner';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { runSql } from '@/pages/sql/utils/sqlToast';
import { pgProfile, sqliteProfile } from '@/test/_helpers/dbProfiles';
import { statement } from '@/test/_helpers/sqlStatement';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({
  ExecuteSql: vi.fn(),
  FetchRows: vi.fn(),
  ConnectDb: vi.fn(),
  CloseDbTab: vi.fn(),
  DisconnectDb: vi.fn(),
  GetAllDbProfile: vi.fn(),
}));
vi.mock('@/pages/sql/utils/sqlToast', () => ({ runSql: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
const mountRunner = () => renderHook(() => useSqlRunner(TAB), { wrapper });

const callIPCMock = vi.mocked(callIPC);
const TAB = 'tab-1';

const addSqlite = (isConnected: boolean) =>
  useDbProfileStore.setState(state => ({
    dbProfiles: { ...state.dbProfiles, 'sqlite-1': sqliteProfile('sqlite-1', { name: 'Local SQLite', isConnected }) },
  }));

type Call = [unknown, unknown, { signal: AbortSignal }];
/** Replies of ConnectDb / ExecuteSql / FetchRows by binding. */
const reply = (map: { connect?: unknown; execute?: unknown; fetch?: unknown }) =>
  callIPCMock.mockImplementation((async (binding: unknown) => {
    if (binding === ExecuteSql) return map.execute;
    if (binding === FetchRows) return map.fetch;
    return map.connect;
  }) as never);

const callsOf = (binding: unknown) => callIPCMock.mock.calls.filter(c => c[0] === binding) as unknown as Call[];

describe('canLoadMore', () => {
  it.each([
    ['an open SELECT', { cursorId: 1, done: false }, true],
    ['a finished SELECT', { cursorId: 1, done: true }, false],
    ['a SELECT without cursor', { cursorId: null, done: false }, false],
    ['a failed statement', { cursorId: 1, done: false, error: { code: 'DBE006', message: 'x' } }, false],
    ['a statement that is not a SELECT', { kind: 'exec', cursorId: 1, done: false }, false],
  ])('is decided for %s', (_name, extra, expected) => {
    expect(canLoadMore(statement(extra))).toBe(expected);
  });
});

describe('useSqlRunner', () => {
  beforeEach(() => {
    useDbProfileStore.getState().reset();
    useDbProfileStore.setState({ dbProfiles: { 'mock-pg-local': pgProfile('mock-pg-local') } });
  });

  it('starts idle with no statements', () => {
    const { result } = mountRunner();
    expect(result.current).toMatchObject({
      runId: 0,
      statements: [],
      cancelled: false,
      running: false,
      loadingMore: false,
    });
  });

  describe('profiles that do not go to the backend', () => {
    it('hands a PostgreSQL profile to the fake runSql', async () => {
      const { result } = mountRunner();
      await act(() => result.current.run('mock-pg-local', 'select 1'));
      expect(runSql).toHaveBeenCalledWith('mock-pg-local', 'select 1');
      expect(callIPCMock).not.toHaveBeenCalled();
      expect(result.current.running).toBe(false);
    });

    it('hands an unknown profile to runSql so it can warn', async () => {
      const { result } = mountRunner();
      await act(() => result.current.run(null, 'select 1'));
      expect(runSql).toHaveBeenCalledWith(null, 'select 1');
    });
  });

  describe('run on SQLite', () => {
    it.each(['', '   \n'])('warns instead of running blank SQL (%j)', async sql => {
      addSqlite(true);
      const { result } = mountRunner();
      await act(() => result.current.run('sqlite-1', sql));
      expect(toast.warning).toHaveBeenCalledWith('There is no SQL to run.');
      expect(callIPCMock).not.toHaveBeenCalled();
    });

    it('sends the SQL of this tab and keeps the statements with a new run id', async () => {
      addSqlite(true);
      const one = statement();
      reply({ execute: { statements: [one] } });
      const { result } = mountRunner();

      await act(() => result.current.run('sqlite-1', 'select 1'));

      expect(callIPCMock).toHaveBeenCalledWith(
        ExecuteSql,
        [{ profileId: 'sqlite-1', tabId: TAB, sql: 'select 1' }],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result.current).toMatchObject({ runId: 1, statements: [one], cancelled: false, running: false });
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('keeps every statement of a script, a failed one included', async () => {
      addSqlite(true);
      const list = [
        statement({ kind: 'exec', rows: [], rowsAffected: 2 }),
        statement({ index: 1, error: { code: 'DBE006', message: 'boom' } }),
      ];
      reply({ execute: { statements: list } });
      const { result } = mountRunner();

      await act(() => result.current.run('sqlite-1', 'a; b'));

      expect(result.current.statements).toEqual(list);
    });

    it('shows no statements when the call returns nothing (timeout)', async () => {
      addSqlite(true);
      reply({ execute: null });
      const { result } = mountRunner();
      await act(() => result.current.run('sqlite-1', 'select 1'));
      expect(result.current).toMatchObject({ runId: 1, statements: [], running: false });
    });

    it('connects first when the profile is not connected, and toasts it', async () => {
      addSqlite(false);
      reply({ connect: true, execute: { statements: [statement()] } });
      const { result } = mountRunner();

      await act(() => result.current.run('sqlite-1', 'select 1'));

      expect(toast.success).toHaveBeenCalledWith('Connected to Local SQLite');
      expect(useDbProfileStore.getState().dbProfiles['sqlite-1']?.isConnected).toBe(true);
      expect(callsOf(ExecuteSql)).toHaveLength(1);
      expect(result.current.statements).toHaveLength(1);
    });

    it('stops without running when the connect fails', async () => {
      addSqlite(false);
      reply({ connect: null });
      const { result } = mountRunner();

      await act(() => result.current.run('sqlite-1', 'select 1'));

      expect(callsOf(ExecuteSql)).toHaveLength(0);
      expect(toast.success).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({ runId: 0, statements: [], running: false });
    });

    it('is running until the call settles', async () => {
      addSqlite(true);
      let finish: (v: unknown) => void = () => {};
      callIPCMock.mockImplementation((() => new Promise(r => (finish = r))) as never);
      const { result } = mountRunner();

      let pending!: Promise<void>;
      act(() => {
        pending = result.current.run('sqlite-1', 'select 1');
      });
      expect(result.current.running).toBe(true);

      await act(async () => {
        finish({ statements: [] });
        await pending;
      });
      expect(result.current.running).toBe(false);
    });
  });

  describe('cancel and re-run', () => {
    it('Cancel aborts the call and marks the result as canceled without a toast', async () => {
      addSqlite(true);
      let signal!: AbortSignal;
      callIPCMock.mockImplementation(((_b: unknown, _a: unknown, o: { signal: AbortSignal }) => {
        signal = o.signal;
        return new Promise(resolve => o.signal.addEventListener('abort', () => resolve(null)));
      }) as never);
      const { result } = mountRunner();

      let pending!: Promise<void>;
      act(() => {
        pending = result.current.run('sqlite-1', 'select 1');
      });
      await act(async () => {
        result.current.cancel();
        await pending;
      });

      expect(signal.aborted).toBe(true);
      expect(result.current).toMatchObject({ cancelled: true, statements: [], running: false });
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('cancel does nothing when nothing is running', () => {
      const { result } = mountRunner();
      expect(() => act(() => result.current.cancel())).not.toThrow();
    });

    it('a new run cancels the old one and drops its late result', async () => {
      addSqlite(true);
      const resolvers: ((v: unknown) => void)[] = [];
      const signals: AbortSignal[] = [];
      callIPCMock.mockImplementation(((_b: unknown, _a: unknown, o: { signal: AbortSignal }) => {
        signals.push(o.signal);
        return new Promise(r => resolvers.push(r));
      }) as never);
      const { result } = mountRunner();

      let first!: Promise<void>;
      let second!: Promise<void>;
      act(() => {
        first = result.current.run('sqlite-1', 'select 1');
      });
      act(() => {
        second = result.current.run('sqlite-1', 'select 2');
      });
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);

      await act(async () => {
        resolvers[1]({ statements: [statement({ sql: 'select 2' })] });
        await second;
      });
      await act(async () => {
        resolvers[0]({ statements: [statement({ sql: 'select 1' }), statement()] });
        await first;
      });

      expect(result.current.statements.map(s => s.sql)).toEqual(['select 2']);
      expect(result.current).toMatchObject({ runId: 1, running: false });
    });

    it('leaving the tab aborts the run in flight and ignores its result', async () => {
      addSqlite(true);
      let signal!: AbortSignal;
      let finish: (v: unknown) => void = () => {};
      callIPCMock.mockImplementation(((_b: unknown, _a: unknown, o: { signal: AbortSignal }) => {
        signal = o.signal;
        return new Promise(r => (finish = r));
      }) as never);
      const { result, unmount } = mountRunner();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.run('sqlite-1', 'select 1');
      });

      unmount();
      expect(signal.aborted).toBe(true);
      finish({ statements: [statement()] });
      await expect(pending).resolves.toBeUndefined();
    });

    it('detach aborts the run in flight, stops running and ignores the late result', async () => {
      addSqlite(true);
      let signal!: AbortSignal;
      let finish: (v: unknown) => void = () => {};
      callIPCMock.mockImplementation(((_b: unknown, _a: unknown, o: { signal: AbortSignal }) => {
        signal = o.signal;
        return new Promise(r => (finish = r));
      }) as never);
      const { result } = mountRunner();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.run('sqlite-1', 'select 1');
      });
      expect(result.current.running).toBe(true);

      act(() => result.current.detach());
      expect(signal.aborted).toBe(true);
      expect(result.current.running).toBe(false);

      await act(async () => {
        finish({ statements: [statement()] });
        await pending;
      });
      expect(result.current).toMatchObject({ runId: 0, statements: [], running: false });
    });

    it('detach when idle does not throw', () => {
      const { result } = mountRunner();
      expect(() => act(() => result.current.detach())).not.toThrow();
      expect(result.current.running).toBe(false);
    });

    it('unmount without a run does not throw', () => {
      const { unmount } = mountRunner();
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('loadMore', () => {
    const open = (extra = {}) => statement({ rows: [['1'], ['2']], cursorId: 7, done: false, ...extra });

    const runOpen = async (statements = [open()]) => {
      addSqlite(true);
      const hook = mountRunner();
      reply({ execute: { statements }, fetch: undefined });
      await act(() => hook.result.current.run('sqlite-1', 'select * from t'));
      return hook;
    };

    it('appends the next page to the last statement and keeps asking while not done', async () => {
      const { result } = await runOpen();
      reply({ fetch: { rows: [['3']], done: false } });

      await act(() => result.current.loadMore());

      expect(callIPCMock).toHaveBeenLastCalledWith(
        FetchRows,
        [{ tabId: TAB, cursorId: 7 }],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result.current.statements[0]).toMatchObject({ rows: [['1'], ['2'], ['3']], done: false });
      expect(result.current.loadingMore).toBe(false);

      reply({ fetch: { rows: [], done: true } });
      await act(() => result.current.loadMore());
      expect(result.current.statements[0]).toMatchObject({ rows: [['1'], ['2'], ['3']], done: true });
    });

    it('stops asking once the last page arrived, even if it is shorter than a full page', async () => {
      const { result } = await runOpen();
      reply({ fetch: { rows: [['3']], done: true } });
      await act(() => result.current.loadMore());
      const before = callsOf(FetchRows).length;

      await act(() => result.current.loadMore());

      expect(callsOf(FetchRows)).toHaveLength(before);
      expect(canLoadMore(result.current.statements[0])).toBe(false);
    });

    it('treats a failed fetch as done and keeps the rows it has', async () => {
      const { result } = await runOpen();
      reply({ fetch: null });

      await act(() => result.current.loadMore());

      expect(result.current.statements[0]).toMatchObject({ rows: [['1'], ['2']], done: true });
      expect(result.current.loadingMore).toBe(false);
    });

    it('does nothing when the last statement has no cursor', async () => {
      const { result } = await runOpen([statement()]);
      await act(() => result.current.loadMore());
      expect(callsOf(FetchRows)).toHaveLength(0);
    });

    it('does not start a second fetch while one is running', async () => {
      const { result } = await runOpen();
      let finish: (v: unknown) => void = () => {};
      callIPCMock.mockImplementation((() => new Promise(r => (finish = r))) as never);

      let first!: Promise<void>;
      act(() => {
        first = result.current.loadMore();
      });
      expect(result.current.loadingMore).toBe(true);
      await act(() => result.current.loadMore());
      expect(callsOf(FetchRows)).toHaveLength(1);

      await act(async () => {
        finish({ rows: [], done: true });
        await first;
      });
      expect(result.current.loadingMore).toBe(false);
    });

    it('drops a page that arrives after a new run started', async () => {
      const { result } = await runOpen();
      let finish: (v: unknown) => void = () => {};
      let signal!: AbortSignal;
      callIPCMock.mockImplementation(((binding: unknown, _a: unknown, o: { signal: AbortSignal }) => {
        if (binding === FetchRows) {
          signal = o.signal;
          return new Promise(r => (finish = r));
        }
        return Promise.resolve({ statements: [statement({ sql: 'select 9' })] });
      }) as never);

      let fetching!: Promise<void>;
      act(() => {
        fetching = result.current.loadMore();
      });
      await act(() => result.current.run('sqlite-1', 'select 9'));
      expect(signal.aborted).toBe(true);
      expect(result.current.loadingMore).toBe(false);

      await act(async () => {
        finish({ rows: [['late']], done: true });
        await fetching;
      });
      expect(result.current.statements.map(s => s.sql)).toEqual(['select 9']);
      expect(result.current.statements[0].rows).toEqual([['1']]);
    });

    it('detach while loading more aborts the fetch and clears loadingMore', async () => {
      const { result } = await runOpen();
      let signal!: AbortSignal;
      callIPCMock.mockImplementation(((_b: unknown, _a: unknown, o: { signal: AbortSignal }) => {
        signal = o.signal;
        return new Promise(() => {});
      }) as never);
      act(() => {
        void result.current.loadMore();
      });
      expect(result.current.loadingMore).toBe(true);

      act(() => result.current.detach());

      expect(signal.aborted).toBe(true);
      expect(result.current.loadingMore).toBe(false);
    });

    it('after detach loadMore does not call FetchRows and the statements stay', async () => {
      const { result } = await runOpen();
      const before = result.current.statements;

      act(() => result.current.detach());
      await act(() => result.current.loadMore());

      expect(callsOf(FetchRows)).toHaveLength(0);
      expect(result.current.statements).toBe(before);
      expect(result.current.statements[0].rows).toEqual([['1'], ['2']]);
    });

    it('does not ask for more when the failing last statement has an error', async () => {
      const { result } = await runOpen([open({ error: { code: 'DBE006', message: 'x' } })]);
      await act(() => result.current.loadMore());
      expect(callsOf(FetchRows)).toHaveLength(0);
    });

    describe('with full pages of 10,000 rows', () => {
      const PAGE = 10_000;
      const page = (from: number, count = PAGE) => Array.from({ length: count }, (_, i) => [String(from + i)]);

      it('appends a 10,000-row page after a 10,000-row first page in order, and stops on done', async () => {
        const { result } = await runOpen([open({ rows: page(0) })]);
        expect(result.current.statements[0].rows).toHaveLength(PAGE);

        reply({ fetch: { rows: page(PAGE), done: false } });
        await act(() => result.current.loadMore());
        let rows = result.current.statements[0].rows;
        expect(rows).toHaveLength(2 * PAGE);
        expect(rows[0]).toEqual(['0']);
        expect(rows[PAGE - 1]).toEqual(['9999']);
        expect(rows[PAGE]).toEqual(['10000']);
        expect(rows[2 * PAGE - 1]).toEqual(['19999']);
        expect(result.current.statements[0].done).toBe(false);

        reply({ fetch: { rows: page(2 * PAGE, 1234), done: true } });
        await act(() => result.current.loadMore());
        rows = result.current.statements[0].rows;
        expect(rows).toHaveLength(2 * PAGE + 1234);
        expect(rows[2 * PAGE]).toEqual(['20000']);
        expect(rows.at(-1)).toEqual(['21233']);
        expect(result.current.statements[0].done).toBe(true);

        const calls = callsOf(FetchRows).length;
        await act(() => result.current.loadMore());
        expect(callsOf(FetchRows)).toHaveLength(calls);
        expect(
          callsOf(FetchRows).every(c => JSON.stringify(c[1]) === JSON.stringify([{ tabId: TAB, cursorId: 7 }]))
        ).toBe(true);
      });

      it('does not mutate the rows array of the previous page when appending', async () => {
        const first = page(0);
        const { result } = await runOpen([open({ rows: first })]);
        reply({ fetch: { rows: page(PAGE), done: true } });

        await act(() => result.current.loadMore());

        expect(first).toHaveLength(PAGE);
        expect(result.current.statements[0].rows).not.toBe(first);
      });

      it('keeps asking for the next page even when a full page is smaller than 10,000, until done', async () => {
        const { result } = await runOpen([open({ rows: page(0, 500) })]);
        reply({ fetch: { rows: page(500, 500), done: false } });
        await act(() => result.current.loadMore());
        expect(result.current.statements[0]).toMatchObject({ done: false });
        expect(canLoadMore(result.current.statements[0])).toBe(true);
        expect(result.current.statements[0].rows).toHaveLength(1000);
      });
    });
  });
});
