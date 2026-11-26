import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// Chỉ lấy màu từ biến theme của Mantine để editor theo chế độ sáng/tối.
const color = (light: string, dark: string) =>
  `light-dark(var(--mantine-color-${light}), var(--mantine-color-${dark}))`;

// Phông chữ theo thiết lập (--mantine-font-family), ghi đè phông monospace mặc định của CodeMirror.
const FONT = { fontFamily: 'var(--mantine-font-family)', fontSize: 'var(--mantine-font-size-sm)' };

const editorTheme = EditorView.theme({
  // Dùng `&.cm-editor`, không dùng `&`: container tooltip được gắn vào <body> cũng nhận class theme,
  // và `height: 100%` trên container đó sẽ làm chiều cao trang tăng gấp đôi (xuất hiện thanh cuộn cửa sổ).
  '&.cm-editor': {
    height: '100%',
    color: 'var(--mantine-color-text)',
    backgroundColor: 'var(--mantine-color-body)',
  },
  // Vẽ viền focus bên trong editor để khung tab (overflow hidden) không cắt mất.
  '&.cm-focused': { outline: '2px solid var(--mantine-primary-color-filled)', outlineOffset: '-2px' },
  '.cm-scroller': { ...FONT, overflow: 'auto' },
  '.cm-content': { ...FONT, caretColor: 'var(--mantine-color-text)' },
  '.cm-gutters': {
    ...FONT,
    color: 'var(--mantine-color-dimmed)',
    backgroundColor: 'var(--mantine-color-body)',
    borderRight: '1px solid var(--mantine-color-default-border)',
  },
  // Dùng màu bán trong suốt để lớp vùng chọn (vẽ bên dưới nội dung dòng) vẫn nhìn thấy trên dòng đang hoạt động.
  '.cm-activeLine': {
    backgroundColor:
      'light-dark(color-mix(in srgb, var(--mantine-color-gray-5) 12%, transparent), ' +
      'color-mix(in srgb, var(--mantine-color-dark-3) 15%, transparent))',
  },
  '.cm-activeLineGutter': { backgroundColor: color('gray-light', 'dark-6'), color: 'var(--mantine-color-text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--mantine-color-text)' },
  '.cm-selectionBackground': { backgroundColor: color('blue-1', 'dark-4') },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: color('blue-2', 'blue-9'),
  },
  '.cm-matchingBracket': { backgroundColor: color('gray-3', 'dark-3') },
  // Popup gợi ý tự động.
  '.cm-tooltip': {
    ...FONT,
    color: 'var(--mantine-color-text)',
    backgroundColor: 'var(--mantine-color-body)',
    border: '1px solid var(--mantine-color-default-border)',
    borderRadius: 'var(--mantine-radius-sm)',
    boxShadow: 'var(--mantine-shadow-sm)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': { ...FONT },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--mantine-primary-color-light)',
    color: 'var(--mantine-primary-color-light-color)',
  },
  '.cm-completionLabel': { color: 'inherit' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
  '.cm-completionDetail': { color: 'var(--mantine-color-dimmed)' },
  '.cm-completionIcon': { color: 'var(--mantine-color-dimmed)' },
});

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword], color: color('violet-7', 'violet-3'), fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: color('green-8', 'green-3') },
  { tag: [tags.number, tags.bool, tags.null], color: color('orange-8', 'orange-3') },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: color('gray-6', 'dark-2'), fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation], color: color('cyan-8', 'cyan-3') },
  { tag: [tags.typeName, tags.standard(tags.name)], color: color('blue-7', 'blue-3') },
]);

/** Các extension định dạng SQL editor: theme (màu sắc, phông chữ) và tô sáng cú pháp. */
export const sqlEditorTheme = [editorTheme, syntaxHighlighting(highlightStyle)];
