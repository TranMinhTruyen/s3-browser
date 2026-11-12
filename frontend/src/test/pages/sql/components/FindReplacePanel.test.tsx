import type { EditorView } from '@codemirror/view';
import { act, createEvent, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler, type RefObject, useState } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FindReplacePanel from '@/pages/sql/components/FindReplacePanel';
import { DEFAULT_FIND_OPTIONS, type FindOptions } from '@/pages/sql/utils/findReplace';
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
  options?: Partial<FindOptions>;
};

/** Panel with its state owned by the test harness, like SqlTabDetail does. */
function setup({ doc = 'foo bar foo', find = '', replace = '', focusKey = 0, noView, options }: Options = {}) {
  const view = createView(doc, { anchor: 0 });
  views.push(view);
  const viewRef = { current: noView ? null : view } as RefObject<EditorView | null>;
  const spies = { onClose: vi.fn(), onChangeFind: vi.fn(), onChangeReplace: vi.fn(), onChangeOptions: vi.fn() };
  const docChangeRef = { current: null } as { current: (() => void) | null };
  const onRender = vi.fn();

  function Harness({ initialFocusKey }: { initialFocusKey: number }) {
    const [findText, setFind] = useState(find);
    const [replaceText, setReplace] = useState(replace);
    const [findOptions, setFindOptions] = useState({ ...DEFAULT_FIND_OPTIONS, ...options });
    return (
      <Profiler id="panel" onRender={onRender}>
        <FindReplacePanel
          viewRef={viewRef}
          find={findText}
          replace={replaceText}
          options={findOptions}
          docChangeRef={docChangeRef}
          focusKey={initialFocusKey}
          onChangeFind={v => {
            spies.onChangeFind(v);
            setFind(v);
          }}
          onChangeReplace={v => {
            spies.onChangeReplace(v);
            setReplace(v);
          }}
          onChangeOptions={o => {
            spies.onChangeOptions(o);
            setFindOptions(o);
          }}
          onClose={spies.onClose}
        />
      </Profiler>
    );
  }

  const utils = renderWithProviders(<Harness initialFocusKey={focusKey} />);
  const rerenderWithKey = (key: number) => utils.rerender(<Harness initialFocusKey={key} />);
  return {
    view,
    viewRef,
    onRender,
    spies,
    docChangeRef,
    user: userEvent.setup(),
    rerenderWithKey,
    unmount: utils.unmount,
  };
}

const findInput = () => screen.getByPlaceholderText('Find') as HTMLInputElement;
const replaceInput = () => screen.getByPlaceholderText('Replace with') as HTMLInputElement;
const btn = (name: string) => screen.getByRole('button', { name });
const sel = (view: EditorView) => [view.state.selection.main.from, view.state.selection.main.to];

afterEach(() => {
  vi.useRealTimers();
  for (const view of views.splice(0)) view.destroy();
});

describe('FindReplacePanel', () => {
  describe('layout', () => {
    it('shows the title, the Find and Replace boxes, the option toggles, Cancel (X) in the header and the action buttons below', () => {
      setup();
      expect(screen.getByText('Find and replace')).toBeInTheDocument();
      expect(findInput()).toBeInTheDocument();
      expect(replaceInput()).toBeInTheDocument();
      const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent);
      expect(names).toEqual([
        'Cancel',
        'Match case',
        'Match whole word',
        'Use regular expression',
        'Find',
        'Replace',
        'Replace all',
      ]);
      expect(btn('Cancel').textContent).toBe('');
    });
  });

  describe('Find box right section', () => {
    it('lets the option toggles receive pointer events (regression: they were not clickable in the app)', () => {
      setup();
      const wrapper = findInput().parentElement as HTMLElement;
      expect(wrapper.style.getPropertyValue('--input-right-section-pointer-events')).toBe('all');
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
      expect(screen.queryByText('No results')).not.toBeInTheDocument();
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

  describe('search options', () => {
    const toggles = ['Match case', 'Match whole word', 'Use regular expression'];

    it.each([
      ['Match case', 'caseSensitive'],
      ['Match whole word', 'wholeWord'],
      ['Use regular expression', 'regexp'],
    ])('%s toggles aria-pressed and reports the new options', async (name, key) => {
      const { user, spies } = setup();
      expect(btn(name)).toHaveAttribute('aria-pressed', 'false');

      await user.click(btn(name));
      expect(spies.onChangeOptions).toHaveBeenLastCalledWith({ ...DEFAULT_FIND_OPTIONS, [key]: true });
      expect(btn(name)).toHaveAttribute('aria-pressed', 'true');
      for (const other of toggles.filter(n => n !== name)) expect(btn(other)).toHaveAttribute('aria-pressed', 'false');

      await user.click(btn(name));
      expect(spies.onChangeOptions).toHaveBeenLastCalledWith(DEFAULT_FIND_OPTIONS);
      expect(btn(name)).toHaveAttribute('aria-pressed', 'false');
    });

    it('with all options off it ignores case and treats the text literally (old behaviour)', async () => {
      const { user, view } = setup({ doc: 'Foo a.c abc', find: 'a.c' });
      await user.click(btn('Find'));
      expect(sel(view)).toEqual([4, 7]);
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    it('Match case limits the matches', async () => {
      const { user } = setup({ doc: 'Foo foo', find: 'foo', options: { caseSensitive: true } });
      await user.click(btn('Find'));
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    it('Match whole word limits the matches', async () => {
      const { user } = setup({ doc: 'foo foobar', find: 'foo', options: { wholeWord: true } });
      await user.click(btn('Find'));
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    it('Replace all with a regular expression expands $1', async () => {
      const { user, view } = setup({ doc: 'a1 a2', find: 'a(\\d)', replace: '<$1>', options: { regexp: true } });
      await user.click(btn('Replace all'));
      expect(view.state.doc.toString()).toBe('<1> <2>');
      expect(toast.info).toHaveBeenCalledWith('Replaced 2 occurrence(s).');
    });

    it('Replace with a regular expression replaces the selected match using its groups', async () => {
      const { user, view } = setup({ doc: 'k=1 k=2', find: 'k=(\\d)', replace: '$1', options: { regexp: true } });
      await user.click(btn('Replace'));
      await user.click(btn('Replace'));
      expect(view.state.doc.toString()).toBe('1 k=2');
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    it('a regular expression that can match the empty string does not hang and finds only real matches', async () => {
      const { user, view } = setup({ doc: 'baac', find: 'a*', options: { regexp: true } });
      await user.click(btn('Find'));
      expect(sel(view)).toEqual([1, 3]);
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    describe('invalid regular expression', () => {
      it('flags the Find box, shows the message, disables the actions and hides the counter', async () => {
        const { user } = setup({ find: 'foo' });
        await user.click(btn('Find'));
        expect(screen.getByText('1/2')).toBeInTheDocument();

        await user.click(btn('Use regular expression'));
        await user.type(findInput(), '(');

        expect(screen.getByText('Invalid regular expression')).toBeInTheDocument();
        expect(findInput()).toHaveAttribute('aria-invalid', 'true');
        expect(btn('Find')).toBeDisabled();
        expect(btn('Replace')).toBeDisabled();
        expect(btn('Replace all')).toBeDisabled();
        expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
        expect(screen.queryByText('No results')).not.toBeInTheDocument();
      });

      it('leaves the document alone when Enter is pressed', async () => {
        const { user, view } = setup({ find: '(', replace: 'x', options: { regexp: true } });
        await user.type(findInput(), '{Enter}');
        expect(view.state.doc.toString()).toBe('foo bar foo');
        expect(sel(view)).toEqual([0, 0]);
        expect(toast.info).not.toHaveBeenCalled();
      });

      it('goes away when regexp is switched off, and an empty box is not an error', async () => {
        const { user } = setup({ find: '(', options: { regexp: true } });
        expect(screen.getByText('Invalid regular expression')).toBeInTheDocument();
        await user.click(btn('Use regular expression'));
        expect(screen.queryByText('Invalid regular expression')).not.toBeInTheDocument();
        expect(btn('Find')).toBeEnabled();

        await user.clear(findInput());
        await user.click(btn('Use regular expression'));
        expect(screen.queryByText('Invalid regular expression')).not.toBeInTheDocument();
        expect(findInput()).not.toHaveAttribute('aria-invalid', 'true');
        expect(btn('Find')).toBeDisabled();
      });
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

  describe('match counter refresh (docChangeRef)', () => {
    type Ctx = ReturnType<typeof setup>;
    /** The counter is recomputed 120 ms after the last change (DOC_CHANGE_DELAY); fake timers are installed after clicks. */
    const useFakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const advance = (ms = 120) =>
      act(async () => {
        vi.advanceTimersByTime(ms);
      });
    /** Edits the document like the editor does: the change, then its update listener calls the registered refresh. */
    const edit = (ctx: Ctx, changes: { from: number; to?: number; insert?: string }) =>
      act(() => {
        ctx.view.dispatch({ changes });
        ctx.docChangeRef.current?.();
      });

    it('registers the refresh while mounted and clears it on unmount', () => {
      const ctx = setup({ find: 'foo' });
      expect(ctx.docChangeRef.current).toEqual(expect.any(Function));
      ctx.unmount();
      expect(ctx.docChangeRef.current).toBeNull();
    });

    it('updates a shown counter after typing, Backspace, undo-like and paste changes', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      expect(screen.getByText('1/2')).toBeInTheDocument();
      useFakeClock();

      edit(ctx, { from: 11, insert: ' foo' }); // typing
      await advance();
      expect(screen.getByText('1/3')).toBeInTheDocument();

      edit(ctx, { from: 11, to: 15 }); // Backspace / undo
      await advance();
      expect(screen.getByText('1/2')).toBeInTheDocument();

      edit(ctx, { from: 0, insert: 'foo foo ' }); // paste
      await advance();
      expect(screen.getByText(/^\d\/4$/)).toBeInTheDocument();
    });

    it('shows "No results" when the edit removes every match', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      useFakeClock();
      edit(ctx, { from: 0, to: ctx.view.state.doc.length, insert: 'bar' });
      await advance();
      expect(screen.getByText('No results')).toBeInTheDocument();
    });

    it('does not show a counter on edit when none was shown (info stays null)', async () => {
      const ctx = setup({ find: 'foo' });
      useFakeClock();
      edit(ctx, { from: 0, insert: 'foo ' });
      await advance();
      expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
      expect(screen.queryByText('No results')).not.toBeInTheDocument();
    });

    it('does nothing when the editor is gone', async () => {
      const ctx = setup({ find: 'foo', noView: true });
      useFakeClock();
      expect(() => act(() => ctx.docChangeRef.current?.())).not.toThrow();
      await advance();
      expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
    });

    it('keeps a shown counter without re-rendering when index and total do not change', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      const counter = screen.getByText('1/2');
      ctx.onRender.mockClear();
      useFakeClock();

      edit(ctx, { from: 11, insert: ' x' }); // no match added or removed, selection unchanged
      await advance();

      expect(ctx.onRender).not.toHaveBeenCalled();
      expect(screen.getByText('1/2')).toBe(counter);
    });

    it('re-renders and updates the text when index or total changes', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      ctx.onRender.mockClear();
      useFakeClock();

      edit(ctx, { from: 11, insert: ' foo' });
      await advance();

      expect(ctx.onRender).toHaveBeenCalled();
      expect(screen.getByText('1/3')).toBeInTheDocument();
      expect(screen.queryByText('1/2')).not.toBeInTheDocument();
    });

    it('leaves a shown counter alone when the editor disappears', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      ctx.viewRef.current = null;
      ctx.onRender.mockClear();
      useFakeClock();

      expect(() => act(() => ctx.docChangeRef.current?.())).not.toThrow();
      await advance();

      expect(ctx.onRender).not.toHaveBeenCalled();
      expect(screen.getByText('1/2')).toBeInTheDocument();
    });

    it('waits 120 ms after the change before recomputing', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      useFakeClock();
      edit(ctx, { from: 11, insert: ' foo' });
      await advance(119);
      expect(screen.getByText('1/2')).toBeInTheDocument();
      await advance(1);
      expect(screen.getByText('1/3')).toBeInTheDocument();
    });

    it('batches consecutive changes into one update', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      useFakeClock();
      ctx.onRender.mockClear();

      edit(ctx, { from: 11, insert: ' foo' });
      await advance(100);
      edit(ctx, { from: 15, insert: ' foo' });
      await advance(100); // 200 ms since the first change, 100 ms since the last
      expect(screen.getByText('1/2')).toBeInTheDocument();
      expect(ctx.onRender).not.toHaveBeenCalled();

      await advance(20);
      expect(screen.getByText('1/4')).toBeInTheDocument();
      expect(ctx.onRender).toHaveBeenCalledTimes(1);
    });

    it('does not update after unmount and leaves no timer behind', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      useFakeClock();
      edit(ctx, { from: 11, insert: ' foo' });
      ctx.onRender.mockClear();

      ctx.unmount();

      expect(vi.getTimerCount()).toBe(0);
      await advance();
      expect(ctx.onRender).not.toHaveBeenCalled();
    });

    it('drops a pending update when the query changes', async () => {
      const ctx = setup({ find: 'foo' });
      await ctx.user.click(btn('Find'));
      useFakeClock();
      edit(ctx, { from: 11, insert: ' foo' });
      expect(vi.getTimerCount()).toBe(1);

      fireEvent.change(findInput(), { target: { value: 'bar' } });

      expect(vi.getTimerCount()).toBe(0);
      await advance();
      expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
    });

    it('recomputes a shown counter when an option changes, and keeps it hidden otherwise', async () => {
      const ctx = setup({ doc: 'Foo foo', find: 'foo' });
      await ctx.user.click(btn('Find'));
      expect(screen.getByText('1/2')).toBeInTheDocument();
      await ctx.user.click(btn('Match case'));
      expect(screen.getByText('0/1')).toBeInTheDocument();
      await ctx.user.click(btn('Match case'));
      expect(screen.getByText('1/2')).toBeInTheDocument();
    });
  });

  it('keeps working after focus effects (act-wrapped flush)', async () => {
    setup({ find: 'foo' });
    await act(async () => {});
    expect(findInput()).toHaveFocus();
  });
});
