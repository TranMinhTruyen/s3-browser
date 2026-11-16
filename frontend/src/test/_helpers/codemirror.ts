import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });

/** jsdom has no layout: CodeMirror measures text through Range#getClientRects, which jsdom does not implement. */
export function polyfillCodeMirrorLayout() {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  proto.getClientRects ??= () => [] as unknown as DOMRectList;
  proto.getBoundingClientRect ??= emptyRect;
}

/** A real EditorView mounted on the document, with `doc` as content and an optional selection. */
export function createView(doc: string, selection?: { anchor: number; head?: number }, extensions: Extension[] = []) {
  polyfillCodeMirrorLayout();
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc, selection, extensions }) });
  return view;
}
