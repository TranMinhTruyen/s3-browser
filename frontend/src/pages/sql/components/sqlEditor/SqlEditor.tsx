import { acceptCompletion, autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, redo } from '@codemirror/commands';
import { PostgreSQL, SQLite, type SQLNamespace, StandardSQL, sql } from '@codemirror/lang-sql';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, tooltips } from '@codemirror/view';
import { memo, type RefObject, useEffect, useMemo, useRef } from 'react';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import { sqlEditorTheme } from '@/pages/sql/components/sqlEditor/sqlEditorTheme';

export type SqlDialect = 'postgresql' | 'sqlite' | null;

type SqlEditorProps = {
  /** Được gán `EditorView` khi editor đã mount. */
  viewRef: RefObject<EditorView | null>;
  /** Nội dung khởi tạo của tài liệu. */
  initialDoc?: string;
  /** Phương ngữ SQL dùng để tô sáng; null nghĩa là SQL chuẩn. */
  dialect: SqlDialect;
  /** Các bảng và cột được gợi ý tự động; undefined nghĩa là chỉ gợi ý từ khóa. */
  schema?: SQLNamespace;
  onFormat?: () => void;
  onFind?: () => void;
  onExecute?: () => void;
  /** Được gọi sau mỗi lần văn bản thay đổi (nhập, hoàn tác, dán, gợi ý tự động...). */
  onDocChange?: (doc: string) => void;
};

const DIALECTS = { postgresql: PostgreSQL, sqlite: SQLite };
const getLanguage = (dialect: SqlDialect, schema?: SQLNamespace) =>
  sql({ dialect: dialect ? DIALECTS[dialect] : StandardSQL, schema });

/** Trình soạn thảo SQL (CodeMirror 6). View chỉ tạo một lần; đổi phương ngữ/schema chỉ cấu hình lại ngôn ngữ. */
function SqlEditor({
  viewRef,
  initialDoc = '',
  dialect,
  schema,
  onFormat,
  onFind,
  onExecute,
  onDocChange,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef(new Compartment());
  // Các callback mới nhất để keymap sử dụng, nhờ đó không cần tạo lại view.
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
        doc: initialDoc,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          indentOnInput(),
          languageRef.current.of(getLanguage(languageOptionsRef.current.dialect, languageOptionsRef.current.schema)),
          // preventDefault ngăn WebView tự xử lý các phím này (tìm kiếm, thanh địa chỉ...).
          Prec.highest(
            keymap.of([
              { key: 'Ctrl-q', mac: 'Cmd-q', run: run('onFormat'), preventDefault: true },
              { key: 'Ctrl-f', mac: 'Cmd-f', run: run('onFind'), preventDefault: true },
              { key: 'Ctrl-e', mac: 'Cmd-e', run: run('onExecute'), preventDefault: true },
            ])
          ),
          // historyKeymap không có Ctrl-Shift-z trên Windows; nếu thiếu phím này, WebView tự redo và làm hỏng tài liệu.
          keymap.of([{ key: 'Mod-Shift-z', run: redo, preventDefault: true }, ...defaultKeymap, ...historyKeymap]),
          // Popup được gắn vào body vì khung tab có overflow hidden và sẽ cắt popup.
          tooltips({ parent: document.body }),
          // Keymap gợi ý mặc định (Enter, Esc, phím mũi tên, Ctrl-Space) chỉ hoạt động khi popup mở,
          // nên Enter vẫn xuống dòng và Esc không làm gì khi popup đóng. Tab cũng chấp nhận gợi ý.
          autocompletion({ activateOnTyping: true }),
          Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
          EditorView.updateListener.of(update => {
            if (update.docChanged) handlersRef.current.onDocChange?.(update.state.doc.toString());
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
    // Khi mount, view đã được tạo với các giá trị này.
    if (prev.dialect === dialect && prev.schema === schema) return;
    languageOptionsRef.current = { dialect, schema };
    viewRef.current?.dispatch({ effects: languageRef.current.reconfigure(getLanguage(dialect, schema)) });
  }, [dialect, schema, viewRef]);

  // CodeMirror lưu đệm chiều cao dòng và độ rộng ký tự: đo lại khi cỡ phông gốc thay đổi.
  const scale = useUiScale();
  const measurer = useMemo(() => ({ measure: () => viewRef.current?.requestMeasure() }), [viewRef]);
  useRemeasureOnScale(measurer, scale);

  return <div ref={containerRef} style={{ height: '100%', minHeight: 0 }} />;
}
export default memo(SqlEditor);
