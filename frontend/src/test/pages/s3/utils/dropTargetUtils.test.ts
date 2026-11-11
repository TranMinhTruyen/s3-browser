import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installDropTargetCleanup } from '@/pages/s3/utils/dropTargetUtils';

const ACTIVE = 'file-drop-target-active';

const dragLeave = (relatedTarget: unknown, types?: string[]) => {
  const event = new Event('dragleave', { bubbles: true });
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
  if (types) Object.defineProperty(event, 'dataTransfer', { value: { types } });
  document.body.dispatchEvent(event);
};

const addTarget = () => {
  const el = document.createElement('div');
  el.className = ACTIVE;
  document.body.appendChild(el);
  return el;
};

describe('installDropTargetCleanup', () => {
  let cleanups: Array<() => void>;
  const install = () => {
    const fn = installDropTargetCleanup();
    cleanups.push(fn);
    return fn;
  };

  beforeEach(() => {
    cleanups = [];
  });

  afterEach(() => {
    for (const fn of cleanups) fn();
    delete (window as unknown as { chrome?: unknown }).chrome;
    document.body.innerHTML = '';
  });

  it('does not listen without webview and returns a no-op', () => {
    const el = addTarget();
    const cleanup = install();

    dragLeave(null, ['Files']);

    expect(el).toHaveClass(ACTIVE);
    expect(cleanup()).toBeUndefined();
  });

  it('does not listen when chrome exists but has no webview', () => {
    (window as unknown as { chrome: object }).chrome = {};
    const el = addTarget();
    install();

    dragLeave(null, ['Files']);

    expect(el).toHaveClass(ACTIVE);
  });

  describe('with webview', () => {
    beforeEach(() => {
      (window as unknown as { chrome: object }).chrome = { webview: {} };
    });

    it('removes the class from every active element on a file dragleave with null relatedTarget', () => {
      const a = addTarget();
      const b = addTarget();
      install();

      dragLeave(null, ['text/plain', 'Files']);

      expect(a).not.toHaveClass(ACTIVE);
      expect(b).not.toHaveClass(ACTIVE);
    });

    it('keeps the class when relatedTarget is not null', () => {
      const el = addTarget();
      install();

      dragLeave(document.body, ['Files']);

      expect(el).toHaveClass(ACTIVE);
    });

    it('keeps the class when the drag carries no files', () => {
      const el = addTarget();
      install();

      dragLeave(null, ['text/plain']);

      expect(el).toHaveClass(ACTIVE);
    });

    it('keeps the class when there is no dataTransfer', () => {
      const el = addTarget();
      install();

      dragLeave(null);

      expect(el).toHaveClass(ACTIVE);
    });

    it('removes the listener on cleanup', () => {
      const el = addTarget();
      const cleanup = install();

      cleanup();
      dragLeave(null, ['Files']);

      expect(el).toHaveClass(ACTIVE);
    });
  });
});
