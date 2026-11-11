import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// Colors only come from Mantine theme variables so the editor follows the light/dark theme.
const color = (light: string, dark: string) =>
  `light-dark(var(--mantine-color-${light}), var(--mantine-color-${dark}))`;

// Font follows the Settings font (--mantine-font-family): overrides CodeMirror's default monospace.
const FONT = { fontFamily: 'var(--mantine-font-family)', fontSize: 'var(--mantine-font-size-sm)' };

const editorTheme = EditorView.theme({
  // `&.cm-editor`, not `&`: the tooltip container appended to <body> also gets the theme class,
  // and `height: 100%` on it would double the page height (window scrollbar).
  '&.cm-editor': {
    height: '100%',
    color: 'var(--mantine-color-text)',
    backgroundColor: 'var(--mantine-color-body)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { ...FONT, overflow: 'auto' },
  '.cm-content': { ...FONT, caretColor: 'var(--mantine-color-text)' },
  '.cm-gutters': {
    ...FONT,
    color: 'var(--mantine-color-dimmed)',
    backgroundColor: 'var(--mantine-color-body)',
    borderRight: '1px solid var(--mantine-color-default-border)',
  },
  '.cm-activeLine': { backgroundColor: color('gray-light', 'dark-6') },
  '.cm-activeLineGutter': { backgroundColor: color('gray-light', 'dark-6'), color: 'var(--mantine-color-text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--mantine-color-text)' },
  '.cm-selectionBackground': { backgroundColor: color('blue-1', 'dark-4') },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: color('blue-2', 'blue-9'),
  },
  '.cm-matchingBracket': { backgroundColor: color('gray-3', 'dark-3') },
  // Autocomplete popup.
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

/** Extensions for the SQL editor look: theme (colors, font) and syntax highlighting. */
export const sqlEditorTheme = [editorTheme, syntaxHighlighting(highlightStyle)];
