import { acceptCompletion, autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, redo } from '@codemirror/commands';
import { PostgreSQL, SQLite, type SQLNamespace, StandardSQL, sql } from '@codemirror/lang-sql';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, tooltips } from '@codemirror/view';
import { memo, type RefObject, useEffect, useRef } from 'react';
import { sqlEditorTheme } from '@/pages/sql/components/sqlEditor/sqlEditorTheme';

export type SqlDialect = 'postgresql' | 'sqlite' | null;

type SqlEditorProps = {
  /** Filled with the `EditorView` while the editor is mounted. */
  viewRef: RefObject<EditorView | null>;
  /** SQL dialect for highlighting; null means standard SQL. */
  dialect: SqlDialect;
  /** Tables and columns offered by autocomplete; undefined means keywords only. */
  schema?: SQLNamespace;
  onFormat?: () => void;
  onFind?: () => void;
  onExecute?: () => void;
  /** Called after every change of the text (typing, undo, paste, autocomplete...). */
  onDocChange?: () => void;
};

const DIALECTS = { postgresql: PostgreSQL, sqlite: SQLite };
const getLanguage = (dialect: SqlDialect, schema?: SQLNamespace) =>
  sql({ dialect: dialect ? DIALECTS[dialect] : StandardSQL, schema });

/** SQL editor (CodeMirror 6). The view is created once; dialect/schema changes only reconfigure the language. */
function SqlEditor({ viewRef, dialect, schema, onFormat, onFind, onExecute, onDocChange }: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef(new Compartment());
  // Latest callbacks, read by the keymap so the view never has to be rebuilt.
  const handlersRef = useRef({ onFormat, onFind, onExecute, onDocChange });
  const languageOptionsRef = useRef({ dialect, schema });

  useEffect(() => {
    handlersRef.current = { onFormat, onFind, onExecute, onDocChange };
  }, [onFormat, onFind, onExecute, onDocChange]);

  useEffect(() => {
    const run = (name: 'onFormat' | 'onFind' | 'onExecute') => () => {
      handlersRef.current[name]?.();
      return true;
    };
    const view = new EditorView({
      parent: containerRef.current as HTMLDivElement,
      state: EditorState.create({
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          indentOnInput(),
          languageRef.current.of(getLanguage(languageOptionsRef.current.dialect, languageOptionsRef.current.schema)),
          // preventDefault keeps the WebView from handling these keys itself (find, address bar...).
          Prec.highest(
            keymap.of([
              { key: 'Ctrl-q', mac: 'Cmd-q', run: run('onFormat'), preventDefault: true },
              { key: 'Ctrl-f', mac: 'Cmd-f', run: run('onFind'), preventDefault: true },
              { key: 'Ctrl-e', mac: 'Cmd-e', run: run('onExecute'), preventDefault: true },
            ])
          ),
          // historyKeymap has no Ctrl-Shift-z on Windows; without it the WebView redoes natively and corrupts the doc.
          keymap.of([{ key: 'Mod-Shift-z', run: redo, preventDefault: true }, ...defaultKeymap, ...historyKeymap]),
          // Popup is attached to body: the tab frame has overflow hidden and would clip it.
          tooltips({ parent: document.body }),
          // Default completion keymap (Enter, Esc, arrows, Ctrl-Space) only acts while the popup is open,
          // so Enter still inserts a newline and Esc does nothing otherwise. Tab also accepts.
          autocompletion({ activateOnTyping: true }),
          Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
          EditorView.updateListener.of(update => {
            if (update.docChanged) handlersRef.current.onDocChange?.();
          }),
          sqlEditorTheme,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [viewRef]);

  useEffect(() => {
    const prev = languageOptionsRef.current;
    // On mount the view was already built with these values.
    if (prev.dialect === dialect && prev.schema === schema) return;
    languageOptionsRef.current = { dialect, schema };
    viewRef.current?.dispatch({ effects: languageRef.current.reconfigure(getLanguage(dialect, schema)) });
  }, [dialect, schema, viewRef]);

  return <div ref={containerRef} style={{ height: '100%', minHeight: 0 }} />;
}
export default memo(SqlEditor);
