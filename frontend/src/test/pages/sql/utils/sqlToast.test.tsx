import { isValidElement, type ReactElement } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { notifyNoBackend, runSql, truncateSql } from '@/pages/sql/utils/sqlToast';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn() } }));

describe('truncateSql', () => {
  it.each([
    ['short text', 'select 1', 'select 1'],
    ['exactly the limit', 'a'.repeat(500), 'a'.repeat(500)],
    ['over the limit', 'a'.repeat(501), `${'a'.repeat(500)}…`],
  ])('%s', (_n, input, expected) => {
    expect(truncateSql(input)).toBe(expected);
  });
});

describe('notifyNoBackend', () => {
  it('shows the info toast about the missing backend', () => {
    notifyNoBackend();
    expect(toast.info).toHaveBeenCalledWith('This feature needs the database backend, which is not available yet.');
  });
});

describe('runSql', () => {
  beforeEach(() => {
    useDbProfileStore.getState().reset();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an unknown id', 'nope'],
  ])('warns to pick a profile for %s and does not run', (_n, id) => {
    runSql(id, 'select 1');
    expect(toast.warning).toHaveBeenCalledWith('Select a database profile first.');
    expect(toast.info).not.toHaveBeenCalled();
  });

  it.each(['', '   \n\t'])('warns when the SQL is blank (%j)', sql => {
    runSql('mock-pg-local', sql);
    expect(toast.warning).toHaveBeenCalledWith('There is no SQL to run.');
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('toasts the profile name with the SQL as description', () => {
    runSql('mock-pg-local', 'select 1');
    expect(toast.warning).not.toHaveBeenCalled();
    const [title, options] = vi.mocked(toast.info).mock.calls[0];
    expect(title).toBe('Local PostgreSQL');
    const description = (options as { description: ReactElement<{ children: string }> }).description;
    expect(isValidElement(description)).toBe(true);
    expect(description.props.children).toBe('select 1');
  });

  it('cuts a long SQL in the toast', () => {
    runSql('mock-pg-local', 'x'.repeat(600));
    const options = vi.mocked(toast.info).mock.calls[0][1] as { description: ReactElement<{ children: string }> };
    expect(options.description.props.children).toBe(`${'x'.repeat(500)}…`);
  });
});
