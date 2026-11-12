import type { EditorView } from '@codemirror/view';
import { act, createEvent, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type RefObject, useState } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FindReplacePanel from '@/pages/sql/components/FindReplacePanel';
import { createView } from '@/test/_helpers/codemirror';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));

const views: EditorView[] = [];

type Options = {
  doc?: string;
  find?: string;
  replace?: string;
  focusKey?: number;
  noView?: boolean;
};

/** Panel with its state owned by the test harness, like SqlTabDetail does. */
function setup({ doc = 'foo bar foo', find = '', replace = '', focusKey = 0, noView }: Options = {}) {
  const view = createView(doc, { anchor: 0 });
  views.push(view);
  const viewRef = { current: noView ? null : view } as RefObject<EditorView | null>;
  const spies = { onClose: vi.fn(), onChangeFind: vi.fn(), onChangeReplace: vi.fn() };

  function Harness({ initialFocusKey }: { initialFocusKey: number }) {
    const [findText, setFind] = useState(find);
    const [replaceText, setReplace] = useState(replace);
    return (
      <FindReplacePanel
        viewRef={viewRef}
        find={findText}
        replace={replaceText}
        focusKey={initialFocusKey}
        onChangeFind={v => {
          spies.onChangeFind(v);
          setFind(v);
        }}
        onChangeReplace={v => {
          spies.onChangeReplace(v);
          setReplace(v);
        }}
        onClose={spies.onClose}
      />
    );
  }

  const utils = renderWithProviders(<Harness initialFocusKey={focusKey} />);
  const rerenderWithKey = (key: number) => utils.rerender(<Harness initialFocusKey={key} />);
  return { view, spies, user: userEvent.setup(), rerenderWithKey, unmount: utils.unmount };
}

const findInput = () => screen.getByPlaceholderText('Find') as HTMLInputElement;
const replaceInput = () => screen.getByPlaceholderText('Replace with') as HTMLInputElement;
const btn = (name: string) => screen.getByRole('button', { name });
const sel = (view: EditorView) => [view.state.selection.main.from, view.state.selection.main.to];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe('FindReplacePanel', () => {
  describe('layout', () => {
    it('shows the title, the Find and Replace boxes, Cancel (X) on the left, and the action buttons on the right', () => {
      setup();
      expect(screen.getByText('Find and replace')).toBeInTheDocument();
      expect(findInput()).toBeInTheDocument();
      expect(replaceInput()).toBeInTheDocument();
      const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent);
      expect(names).toEqual(['Cancel', 'Find', 'Replace', 'Replace all']);
      expect(btn('Cancel').textContent).toBe('');
    });
  });

  describe('focus', () => {
    it('focuses and selects the Find box when it opens', () => {
      setup({ find: 'foo' });
      expect(findInput()).toHaveFocus();
      expect(findInput().selectionStart).toBe(0);
      expect(findInput().selectionEnd).toBe(3);
    });

    it('focuses the Find box again when focusKey changes', () => {
      const { rerenderWithKey } = setup({ find: 'foo' });
      replaceInputFocus();
      rerenderWithKey(1);
      expect(findInput()).toHaveFocus();
    });

    function replaceInputFocus() {
      findInput().blur();
      expect(findInput()).not.toHaveFocus();
    }
  });

  describe('typing', () => {
    it('reports the Find text and clears the match info', async () => {
      const { user, spies } = setup({ find: 'foo' });
      await user.click(btn('Find'));
      expect(screen.getByText('1/2')).toBeInTheDocument();

      await user.type(findInput(), 'x');

      expect(spies.onChangeFind).toHaveBeenLastCalledWith('foox');
      expect(screen.queryByText('1/2')).not.toBeInTheDocument();
    });

    it('reports the Replace text', async () => {
      const { user, spies } = setup({});
      await user.type(replaceInput(), 'z');
      expect(spies.onChangeReplace).toHaveBeenLastCalledWith('z');
    });
  });

  describe('Find', () => {
    it('is disabled without a Find text', () => {
      setup();
      expect(btn('Find')).toBeDisabled();
    });

    it('selects the next match and shows i/n, wrapping around', async () => {
      const { user, view } = setup({ find: 'foo' });

      await user.click(btn('Find'));
      expect(sel(view)).toEqual([0, 3]);
      expect(screen.getByText('1/2')).toBeInTheDocument();

      await user.click(btn('Find'));
      expect(sel(view)).toEqual([8, 11]);
      expect(screen.getByText('2/2')).toBeInTheDocument();

      await user.click(btn('Find'));
      expect(screen.getByText('1/2')).toBeInTheDocument();
    });

    it('shows "No results" when nothing matches', async () => {
      const { user } = setup({ find: 'zzz' });
      await user.click(btn('Find'));
      expect(screen.getByText('No results')).toBeInTheDocument();
    });

    it('Enter in the Find box finds the next match', async () => {
      const { user, view } = setup({ find: 'foo' });
      await user.type(findInput(), '{Enter}');
      expect(sel(view)).toEqual([0, 3]);
    });

    it('Enter in the Replace box does not search', async () => {
      const { user, view } = setup({ find: 'foo' });
      await user.type(replaceInput(), '{Enter}');
      expect(sel(view)).toEqual([0, 0]);
    });

    it('does nothing when the editor is gone', async () => {
      const { user } = setup({ find: 'foo', noView: true });
      await user.click(btn('Find'));
      expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
    });
  });

  describe('Replace', () => {
    it('is disabled without a Find text and leaves the document untouched', async () => {
      const { user, view } = setup();
      expect(btn('Replace')).toBeDisabled();
      await user.click(btn('Replace'));
      expect(view.state.doc.toString()).toBe('foo bar foo');
    });

    it('selects the first match, then replaces it and moves to the next', async () => {
      const { user, view } = setup({ find: 'foo', replace: 'x' });

      await user.click(btn('Replace'));
      expect(sel(view)).toEqual([0, 3]);
      expect(view.state.doc.toString()).toBe('foo bar foo');

      await user.click(btn('Replace'));
      expect(view.state.doc.toString()).toBe('x bar foo');
      expect(sel(view)).toEqual([6, 9]);
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    it('does nothing when the editor is gone', async () => {
      const { user } = setup({ find: 'foo', replace: 'x', noView: true });
      await user.click(btn('Replace'));
      expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
    });
  });

  describe('Replace all', () => {
    it('is disabled without a Find text', () => {
      setup({});
      expect(btn('Replace all')).toBeDisabled();
    });

    it('replaces every match and toasts the count', async () => {
      const { user, view } = setup({ find: 'foo', replace: 'x' });
      await user.click(btn('Replace all'));
      expect(view.state.doc.toString()).toBe('x bar x');
      expect(toast.info).toHaveBeenCalledWith('Replaced 2 occurrence(s).');
    });

    it('toasts 0 when nothing matches', async () => {
      const { user, view } = setup({ find: 'zzz', replace: 'x' });
      await user.click(btn('Replace all'));
      expect(view.state.doc.toString()).toBe('foo bar foo');
      expect(toast.info).toHaveBeenCalledWith('Replaced 0 occurrence(s).');
    });

    it('does nothing when the editor is gone', async () => {
      const { user } = setup({ find: 'foo', noView: true });
      await user.click(btn('Replace all'));
      expect(toast.info).not.toHaveBeenCalled();
    });
  });

  describe('closing and shortcuts', () => {
    it('Cancel closes the panel and gives focus back to the editor', async () => {
      const { user, spies, view } = setup();
      const focus = vi.spyOn(view, 'focus');
      await user.click(btn('Cancel'));
      expect(spies.onClose).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalled();
    });

    it('Cancel still closes when the editor is gone', async () => {
      const { user, spies } = setup({ noView: true });
      await user.click(btn('Cancel'));
      expect(spies.onClose).toHaveBeenCalledTimes(1);
    });

    it('Escape closes the panel, refocuses the editor and stops propagation', () => {
      const { spies, view } = setup();
      const focus = vi.spyOn(view, 'focus');
      const event = createEvent.keyDown(findInput(), { key: 'Escape' });
      const stop = vi.spyOn(event, 'stopPropagation');

      fireEvent(findInput(), event);

      expect(spies.onClose).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalled();
      expect(stop).toHaveBeenCalled();
    });

    it.each([
      ['Ctrl+F', { key: 'f', ctrlKey: true }],
      ['Cmd+F', { key: 'F', metaKey: true }],
    ])('%s is kept from the WebView and re-focuses the Find box', (_n, init) => {
      setup({ find: 'foo' });
      replaceInput().focus();
      const event = createEvent.keyDown(replaceInput(), init);

      fireEvent(replaceInput(), event);

      expect(event.defaultPrevented).toBe(true);
      expect(findInput()).toHaveFocus();
    });

    it('ignores other keys', () => {
      const { spies } = setup({ find: 'foo' });
      const event = createEvent.keyDown(findInput(), { key: 'f' });
      fireEvent(findInput(), event);
      expect(event.defaultPrevented).toBe(false);
      expect(spies.onClose).not.toHaveBeenCalled();
    });
  });

  describe('stale match counter', () => {
    it('clears the i/n counter when the user edits the document', async () => {
      const { user, view } = setup({ find: 'foo' });
      await user.click(btn('Find'));
      expect(screen.getByText('1/2')).toBeInTheDocument();

      act(() => {
        view.contentDOM.dispatchEvent(new Event('input', { bubbles: true }));
      });

      expect(screen.queryByText('1/2')).not.toBeInTheDocument();
    });

    it('stops listening to the editor after unmount', async () => {
      const { view, unmount } = setup({ find: 'foo' });
      const remove = vi.spyOn(view.contentDOM, 'removeEventListener');
      unmount();
      expect(remove).toHaveBeenCalledWith('input', expect.any(Function));
    });
  });

  it('keeps working after focus effects (act-wrapped flush)', async () => {
    setup({ find: 'foo' });
    await act(async () => {});
    expect(findInput()).toHaveFocus();
  });
});
