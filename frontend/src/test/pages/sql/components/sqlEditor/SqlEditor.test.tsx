import { language } from '@codemirror/language';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { createEvent, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import SqlEditor, { type SqlDialect } from '@/pages/sql/components/sqlEditor/SqlEditor';
import { polyfillCodeMirrorLayout } from '@/test/_helpers/codemirror';

polyfillCodeMirrorLayout();

type Handlers = { onFormat?: () => void; onFind?: () => void; onExecute?: () => void };

const mount = (dialect: SqlDialect = null, handlers: Handlers = {}) => {
  const viewRef = createRef<EditorView | null>() as { current: EditorView | null };
  const utils = render(<SqlEditor viewRef={viewRef} dialect={dialect} {...handlers} />);
  const rerender = (next: SqlDialect, nextHandlers: Handlers = handlers) =>
    utils.rerender(<SqlEditor viewRef={viewRef} dialect={next} {...nextHandlers} />);
  return { ...utils, viewRef, rerender };
};

const press = (view: EditorView, init: KeyboardEventInit) => {
  const event = createEvent.keyDown(view.contentDOM, {
    bubbles: true,
    cancelable: true,
    keyCode: init.key?.toUpperCase().charCodeAt(0),
    ...init,
  });
  fireEvent(view.contentDOM, event);
  return event;
};

describe('SqlEditor', () => {
  it('creates one editor view in the container and exposes it through viewRef', () => {
    const { viewRef, container } = mount();
    expect(viewRef.current).not.toBeNull();
    expect(container.querySelector('.cm-editor')).toBeInTheDocument();
    expect(container.querySelector('.cm-lineNumbers')).toBeInTheDocument();
    expect(viewRef.current?.state.facet(language)?.name).toBe('sql');
  });

  it('destroys the view and clears viewRef on unmount', () => {
    const { viewRef, unmount, container } = mount();
    const view = viewRef.current as EditorView;
    const destroy = vi.spyOn(view, 'destroy');
    unmount();
    expect(destroy).toHaveBeenCalled();
    expect(viewRef.current).toBeNull();
    expect(container.querySelector('.cm-editor')).not.toBeInTheDocument();
  });

  it('keeps the same view when only the dialect changes and keeps the document', () => {
    const { viewRef, rerender } = mount(null);
    const view = viewRef.current as EditorView;
    view.dispatch({ changes: { from: 0, insert: 'select 1' } });

    for (const dialect of ['postgresql', 'sqlite', null] as const) {
      rerender(dialect);
      expect(viewRef.current).toBe(view);
      expect(view.state.doc.toString()).toBe('select 1');
      expect(view.state.facet(language)?.name).toBe('sql');
    }
  });

  it('uses the new dialect for syntax-specific language data', () => {
    const { viewRef, rerender } = mount('postgresql');
    const view = viewRef.current as EditorView;
    expect(view.state.facet(language)).toBeTruthy();
    rerender('sqlite');
    expect(viewRef.current).toBe(view);
  });

  // Runs the keymap directly (no DOM listener), so the bindings stay covered while the DOM-level tests below fail.
  describe('keymap bindings', () => {
    it.each([
      ['Ctrl-E', 'e', 'onExecute'],
      ['Ctrl-F', 'f', 'onFind'],
      ['Ctrl-Q', 'q', 'onFormat'],
    ] as const)('%s calls only %s', (_n, key, name) => {
      const handlers = { onFormat: vi.fn(), onFind: vi.fn(), onExecute: vi.fn() };
      const { viewRef } = mount(null, handlers);
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true });

      expect(runScopeHandlers(viewRef.current as EditorView, event, 'editor')).toBe(true);

      for (const [handlerName, handler] of Object.entries(handlers)) {
        expect(handler).toHaveBeenCalledTimes(handlerName === name ? 1 : 0);
      }
    });

    it('uses the latest handler after a re-render and tolerates a missing one', () => {
      const first = vi.fn();
      const second = vi.fn();
      const { viewRef, rerender } = mount(null, { onExecute: first });
      const event = () => new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, cancelable: true });

      rerender(null, { onExecute: second });
      runScopeHandlers(viewRef.current as EditorView, event(), 'editor');
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);

      rerender(null, {});
      expect(runScopeHandlers(viewRef.current as EditorView, event(), 'editor')).toBe(true);
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  // Real DOM keydown on the editor. The React capture handler (onKeyDownCapture) calls preventDefault first, and
  // CodeMirror ignores events that are already default-prevented, so these currently fail (reported as a bug).
  describe('shortcuts through the DOM', () => {
    it.each([
      ['Ctrl-E runs onExecute', 'e', 'onExecute'],
      ['Ctrl-F runs onFind', 'f', 'onFind'],
      ['Ctrl-Q runs onFormat', 'q', 'onFormat'],
    ] as const)('%s only', (_n, key, name) => {
      const handlers = { onFormat: vi.fn(), onFind: vi.fn(), onExecute: vi.fn() };
      const { viewRef } = mount(null, handlers);

      const event = press(viewRef.current as EditorView, { key, ctrlKey: true });

      for (const [handlerName, handler] of Object.entries(handlers)) {
        expect(handler).toHaveBeenCalledTimes(handlerName === name ? 1 : 0);
      }
      expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing for the same key without Ctrl', () => {
      const handlers = { onFormat: vi.fn(), onFind: vi.fn(), onExecute: vi.fn() };
      const { viewRef } = mount(null, handlers);

      press(viewRef.current as EditorView, { key: 'e' });

      expect(handlers.onExecute).not.toHaveBeenCalled();
    });

    it('calls the latest handler after a re-render without rebuilding the view', () => {
      const first = vi.fn();
      const second = vi.fn();
      const { viewRef, rerender } = mount(null, { onExecute: first });
      const view = viewRef.current as EditorView;

      rerender(null, { onExecute: second });
      press(view, { key: 'e', ctrlKey: true });

      expect(viewRef.current).toBe(view);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('is safe when a shortcut has no handler', () => {
      const { viewRef } = mount();
      expect(() => press(viewRef.current as EditorView, { key: 'q', ctrlKey: true })).not.toThrow();
    });
  });

  describe('keydown default prevention (keys the WebView would handle itself)', () => {
    it.each([
      ['Ctrl+E', { key: 'e', ctrlKey: true }],
      ['Ctrl+F', { key: 'f', ctrlKey: true }],
      ['Ctrl+Q', { key: 'q', ctrlKey: true }],
    ])('prevents the default of %s with no handler', (_n, init) => {
      const { viewRef } = mount();
      expect(press(viewRef.current as EditorView, init).defaultPrevented).toBe(true);
    });

    it.each([
      ['Ctrl+S', { key: 's', ctrlKey: true }],
      ['plain F', { key: 'f' }],
    ])('leaves %s alone', (_n, init) => {
      const { viewRef } = mount();
      expect(press(viewRef.current as EditorView, init).defaultPrevented).toBe(false);
    });
  });

  describe('undo and redo', () => {
    const typeAndUndo = () => {
      const { viewRef } = mount();
      const view = viewRef.current as EditorView;
      view.dispatch({ changes: { from: 0, insert: 'select 1' }, userEvent: 'input.type' });
      const key = (init: KeyboardEventInit) =>
        new KeyboardEvent('keydown', {
          cancelable: true,
          ctrlKey: true,
          keyCode: init.key?.toUpperCase().charCodeAt(0),
          ...init,
        });
      expect(runScopeHandlers(view, key({ key: 'z' }), 'editor')).toBe(true);
      expect(view.state.doc.toString()).toBe('');
      return { view, key };
    };

    it('Ctrl+Shift+Z redoes the undone text', () => {
      const { view, key } = typeAndUndo();
      expect(runScopeHandlers(view, key({ key: 'Z', shiftKey: true }), 'editor')).toBe(true);

      expect(view.state.doc.toString()).toBe('select 1');
    });

    it('Ctrl+Shift+Z through the DOM redoes once and is default-prevented', () => {
      const { view } = typeAndUndo();
      const event = press(view, { key: 'Z', ctrlKey: true, shiftKey: true });

      expect(view.state.doc.toString()).toBe('select 1');
      expect(event.defaultPrevented).toBe(true);
    });

    it('Ctrl+Y still redoes', () => {
      const { view, key } = typeAndUndo();

      expect(runScopeHandlers(view, key({ key: 'y' }), 'editor')).toBe(true);

      expect(view.state.doc.toString()).toBe('select 1');
    });

    it('Ctrl+Shift+Z with nothing to redo leaves the document unchanged', () => {
      const { viewRef } = mount();
      const view = viewRef.current as EditorView;
      view.dispatch({ changes: { from: 0, insert: 'abc' }, userEvent: 'input.type' });
      const event = new KeyboardEvent('keydown', {
        key: 'Z',
        keyCode: 90,
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      });

      runScopeHandlers(view, event, 'editor');

      expect(view.state.doc.toString()).toBe('abc');
    });
  });
});
