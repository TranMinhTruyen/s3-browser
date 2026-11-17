import { screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { loadLanguage } from '@/locales/i18n';
import SqlMessageList from '@/pages/sql/components/sqlResult/SqlMessageList';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';
import { statement } from '@/test/_helpers/sqlStatement';

// jsdom has no layout: render every row.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (o: { count: number; estimateSize: () => number; getScrollElement: () => unknown }) => {
    o.getScrollElement();
    return {
      measure: vi.fn(),
      measureElement: vi.fn(),
      getTotalSize: () => o.count * o.estimateSize(),
      getVirtualItems: () =>
        Array.from({ length: o.count }, (_, i) => ({ key: i, index: i, start: i * o.estimateSize(), size: 56 })),
    };
  },
}));

describe('SqlMessageList', () => {
  afterEach(async () => {
    await act(() => i18n.changeLanguage('en'));
  });

  it.each([
    [12, '0.012 s'],
    [1534, '1.534 s'],
    [0, '0.000 s'],
    [61000, '61.000 s'],
  ])('shows %i ms as seconds with 3 decimals (%s)', (elapsedMs, text) => {
    renderWithProviders(<SqlMessageList statements={[statement({ elapsedMs })]} cancelled={false} />);
    expect(screen.getByText(`1 row(s) returned · ${text}`)).toBeInTheDocument();
    expect(screen.queryByText(/ ms$/)).not.toBeInTheDocument();
  });

  it('formats the seconds with the decimal comma of the app language', async () => {
    await loadLanguage('de');
    await act(() => i18n.changeLanguage('de'));
    renderWithProviders(<SqlMessageList statements={[statement({ elapsedMs: 1534 })]} cancelled={false} />);
    expect(screen.getByText(/· 1,534 s$/)).toBeInTheDocument();
  });

  it('shows the number of rows returned with the time of a SELECT', () => {
    const rows = [statement({ rows: [['1'], ['2']], elapsedMs: 7 })];
    renderWithProviders(<SqlMessageList statements={rows} cancelled={false} />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('select 1')).toBeInTheDocument();
    expect(screen.getByText('2 row(s) returned · 0.007 s')).toBeInTheDocument();
  });

  it('adds a "+" when more rows can still be loaded', () => {
    renderWithProviders(<SqlMessageList statements={[statement({ cursorId: 4, done: false })]} cancelled={false} />);
    expect(screen.getByText('1+ row(s) returned · 0.003 s')).toBeInTheDocument();
  });

  it('shows the rows affected by a statement that returns no rows', () => {
    const insert = statement({ sql: 'insert\n  into   t values (1)', kind: 'exec', rows: [], rowsAffected: 5 });
    renderWithProviders(<SqlMessageList statements={[insert]} cancelled={false} />);
    expect(screen.getByText('insert into t values (1)')).toBeInTheDocument();
    expect(screen.getByText('5 row(s) affected · 0.003 s')).toBeInTheDocument();
  });

  it('shows the error of a failed statement instead of its outcome', () => {
    const failed = statement({ error: { code: 'DBE006', message: 'no such table: t' } });
    renderWithProviders(<SqlMessageList statements={[failed]} cancelled={false} />);
    expect(screen.getByText('SQL error.: no such table: t')).toBeInTheDocument();
    expect(screen.queryByText(/row\(s\)/)).not.toBeInTheDocument();
  });

  it('adds a canceled row after the statements when the run was canceled', () => {
    renderWithProviders(<SqlMessageList statements={[statement()]} cancelled />);
    expect(screen.getByText('Execution canceled.')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('shows only the canceled row when nothing finished', () => {
    renderWithProviders(<SqlMessageList statements={[]} cancelled />);
    expect(screen.getByText('Execution canceled.')).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('is empty without statements and without cancel', () => {
    renderWithProviders(<SqlMessageList statements={[]} cancelled={false} />);
    expect(screen.queryByText(/#|canceled/)).not.toBeInTheDocument();
  });
});
