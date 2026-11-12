import type { EditorView } from '@codemirror/view';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SqlTabDetail from '@/pages/sql/components/SqlTabDetail';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { formatEditorSql } from '@/pages/sql/utils/sqlFormat';
import { runSql } from '@/pages/sql/utils/sqlToast';
import { createView } from '@/test/_helpers/codemirror';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

type EditorProps = {
  viewRef: { current: EditorView | null };
  dialect: string | null;
  onFormat: () => void;
  onFind: () => void;
  onExecute: () => void;
  onDocChange: () => void;
};

const editor = vi.hoisted(() => ({ props: null as unknown, view: null as unknown, mount: true }));

// The real editor is covered by its own test; here it hands the page a real view and its callbacks.
vi.mock('@/pages/sql/components/sqlEditor/SqlEditor', () => ({
  default: function EditorMock(props: EditorProps) {
    editor.props = props;
    useEffect(() => {
      props.viewRef.current = editor.mount ? (editor.view as EditorView) : null;
    });
    return <div data-testid="editor" data-dialect={String(props.dialect)} />;
  },
}));
vi.mock('@/pages/sql/utils/sqlFormat', () => ({ formatEditorSql: vi.fn() }));
vi.mock('@/pages/sql/utils/sqlToast', () => ({ runSql: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const props = () => editor.props as EditorProps;
const view = () => editor.view as EditorView;
const tabId = () => useSqlTabStore.getState().activeTab;
const profileIdOfTab = () => useSqlTabStore.getState().tabList[tabId()].profileId;
const flush = () => act(async () => {});

const picker = () => screen.getAllByRole('button').find(b => b.getAttribute('aria-haspopup') === 'listbox')!;

async function pickProfile(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(picker());
  await user.click(await screen.findByRole('option', { name, hidden: true }));
}

function renderDetail(profileId: string | null = null) {
  if (profileId) useSqlTabStore.getState().setTabProfile(tabId(), profileId);
  return renderWithProviders(<SqlTabDetail tabId={tabId()} />);
}

const views: EditorView[] = [];

describe('SqlTabDetail', () => {
  beforeEach(() => {
    useDbProfileStore.getState().reset();
    useSqlTabStore.getState().reset();
    editor.view = createView('select 1', { anchor: 0 });
    views.push(editor.view as EditorView);
    editor.mount = true;
  });

  afterEach(() => {
    for (const v of views.splice(0)) v.destroy();
  });

  it('shows the toolbar and the editor with the standard dialect when no profile is chosen', () => {
    renderDetail();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-dialect', 'null');
    expect(screen.getByRole('button', { name: 'Run SQL' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it.each([
    ['mock-pg-local', 'postgresql'],
    ['mock-sqlite-local', 'sqlite'],
  ])('gives the editor the dialect of the chosen profile (%s)', (id, dialect) => {
    renderDetail(id);
    expect(screen.getByTestId('editor')).toHaveAttribute('data-dialect', dialect);
  });

  it('falls back to the standard dialect when the chosen profile was deleted', () => {
    renderDetail('gone');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-dialect', 'null');
  });

  describe('profile', () => {
    it('stores the profile picked in the dropdown on this tab', async () => {
      const user = userEvent.setup();
      renderDetail();

      await pickProfile(user, 'Staging PostgreSQL');

      expect(profileIdOfTab()).toBe('mock-pg-staging');
      expect(screen.getByTestId('editor')).toHaveAttribute('data-dialect', 'postgresql');
      expect(screen.getByRole('button', { name: 'Run SQL' })).toBeEnabled();
    });

    it('lists every profile by name', async () => {
      const user = userEvent.setup();
      renderDetail();
      await user.click(picker());
      const names = (await screen.findAllByRole('option', { hidden: true })).map(o => o.textContent);
      expect(names).toEqual(['Local PostgreSQL', 'Staging PostgreSQL', 'Local SQLite']);
    });
  });

  describe('connect', () => {
    it('connects the chosen profile and toasts its name', async () => {
      renderDetail('mock-pg-local');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
      expect(useDbProfileStore.getState().dbProfiles['mock-pg-local']?.isConnected).toBe(true);
      expect(toast.success).toHaveBeenCalledWith('Connected to Local PostgreSQL');
    });

    it('disables Connect once connected', () => {
      useDbProfileStore.getState().setConnected('mock-pg-local', true);
      renderDetail('mock-pg-local');
      expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    });
  });

  describe('execute', () => {
    it('Run SQL runs the whole editor text with the chosen profile', async () => {
      renderDetail('mock-pg-local');
      await userEvent.click(screen.getByRole('button', { name: 'Run SQL' }));
      expect(runSql).toHaveBeenCalledWith('mock-pg-local', 'select 1');
    });

    it('Run SQL passes an empty text when there is no editor view', async () => {
      editor.mount = false;
      renderDetail('mock-pg-local');
      await userEvent.click(screen.getByRole('button', { name: 'Run SQL' }));
      expect(runSql).toHaveBeenCalledWith('mock-pg-local', '');
    });

    it('Ctrl+E runs the whole text when nothing is selected', () => {
      renderDetail('mock-pg-local');
      props().onExecute();
      expect(runSql).toHaveBeenCalledWith('mock-pg-local', 'select 1');
    });

    it('Ctrl+E runs only the selection', () => {
      renderDetail('mock-pg-local');
      view().dispatch({ selection: { anchor: 7, head: 8 } });
      props().onExecute();
      expect(runSql).toHaveBeenCalledWith('mock-pg-local', '1');
    });

    it('Ctrl+E does nothing without a view', () => {
      editor.mount = false;
      renderDetail('mock-pg-local');
      props().onExecute();
      expect(runSql).not.toHaveBeenCalled();
    });
  });

  describe('format (Ctrl+Q)', () => {
    it('does nothing without a view', async () => {
      editor.mount = false;
      renderDetail();
      await props().onFormat();
      expect(formatEditorSql).not.toHaveBeenCalled();
    });

    it('formats with the dialect of the chosen profile', async () => {
      vi.mocked(formatEditorSql).mockResolvedValue({ ok: true, scope: 'all' });
      renderDetail('mock-sqlite-local');
      await props().onFormat();
      expect(formatEditorSql).toHaveBeenCalledWith(view(), 'sqlite');
    });

    it.each([
      ['the whole text', 'all', 'SQL formatted.'],
      ['the selection', 'selection', 'Selection formatted.'],
    ] as const)('toasts a success message after formatting %s', async (_n, scope, message) => {
      vi.mocked(formatEditorSql).mockResolvedValue({ ok: true, scope });
      renderDetail();
      await props().onFormat();
      expect(toast.success).toHaveBeenCalledWith(message);
    });

    it('toasts the error when the SQL cannot be formatted', async () => {
      vi.mocked(formatEditorSql).mockResolvedValue({ ok: false, message: 'bad syntax' });
      renderDetail();
      await props().onFormat();
      expect(toast.error).toHaveBeenCalledWith('Cannot format SQL: bad syntax');
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('stays silent when there is nothing to format', async () => {
      vi.mocked(formatEditorSql).mockResolvedValue(null);
      renderDetail();
      await props().onFormat();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('find (Ctrl+F)', () => {
    const findBox = () => screen.queryByPlaceholderText('Find') as HTMLInputElement | null;

    it('is closed at first and opens on Ctrl+F', async () => {
      renderDetail();
      expect(findBox()).not.toBeInTheDocument();

      act(() => props().onFind());

      expect(findBox()).toBeInTheDocument();
      await flush();
      expect(findBox()).toHaveFocus();
    });

    it('uses a single-line selection as the search text', () => {
      renderDetail();
      view().dispatch({ selection: { anchor: 0, head: 6 } });
      act(() => props().onFind());
      expect(findBox()).toHaveValue('select');
    });

    it('ignores a multi-line selection', () => {
      view().dispatch({ changes: { from: 0, to: 8, insert: 'a\nb' }, selection: { anchor: 0, head: 3 } });
      renderDetail();
      act(() => props().onFind());
      expect(findBox()).toHaveValue('');
    });

    it('ignores an empty selection and keeps the previous text', async () => {
      const user = userEvent.setup();
      renderDetail();
      act(() => props().onFind());
      await user.type(findBox()!, 'abc');
      view().dispatch({ selection: { anchor: 0 } });

      act(() => props().onFind());

      expect(findBox()).toHaveValue('abc');
    });

    it('opens without a view too', () => {
      editor.mount = false;
      renderDetail();
      act(() => props().onFind());
      expect(findBox()).toBeInTheDocument();
    });

    it('keeps the search text after closing and reopening', async () => {
      const user = userEvent.setup();
      renderDetail();
      act(() => props().onFind());
      await user.type(findBox()!, 'sel');

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(findBox()).not.toBeInTheDocument();

      act(() => props().onFind());
      expect(findBox()).toHaveValue('sel');
    });

    it('shows the Replace box straight away (no find-only mode) and Replace all replaces in the editor', async () => {
      const user = userEvent.setup();
      renderDetail();
      act(() => props().onFind());
      await user.type(findBox()!, 'select');

      await user.type(screen.getByPlaceholderText('Replace with'), 'SELECT');
      await user.click(screen.getByRole('button', { name: 'Replace all' }));

      expect(view().state.doc.toString()).toBe('SELECT 1');
    });

    it('keeps the search options after closing and reopening the panel', async () => {
      const user = userEvent.setup();
      renderDetail();
      act(() => props().onFind());
      await user.click(screen.getByRole('button', { name: 'Match case' }));
      await user.click(screen.getByRole('button', { name: 'Use regular expression' }));

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      act(() => props().onFind());

      expect(screen.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Match whole word' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Use regular expression' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('applies the search options to Replace all in the editor', async () => {
      const user = userEvent.setup();
      renderDetail();
      act(() => props().onFind());
      await user.click(screen.getByRole('button', { name: 'Use regular expression' }));
      await user.type(findBox()!, 'SEL(E)CT');
      await user.type(screen.getByPlaceholderText('Replace with'), 'x$1');
      await user.click(screen.getByRole('button', { name: 'Replace all' }));
      expect(view().state.doc.toString()).toBe('xe 1');
    });

    it('refreshes the shown counter when the editor reports a document change', async () => {
      const user = userEvent.setup();
      renderDetail();
      act(() => props().onFind());
      await user.type(findBox()!, 'select');
      await user.click(screen.getByRole('button', { name: 'Find' }));
      expect(screen.getByText('1/1')).toBeInTheDocument();

      act(() => {
        view().dispatch({ changes: { from: view().state.doc.length, insert: ' select' } });
        props().onDocChange();
      });

      expect(screen.getByText('1/2')).toBeInTheDocument();
    });

    it('ignores document changes while the panel is closed or after it was closed', async () => {
      const user = userEvent.setup();
      renderDetail();
      expect(() => act(() => props().onDocChange())).not.toThrow();

      act(() => props().onFind());
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(() => act(() => props().onDocChange())).not.toThrow();
    });
  });
});
