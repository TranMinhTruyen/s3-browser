import { act, screen } from '@testing-library/react';
import { Events } from '@wailsio/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploaderStore } from '@/common/stores/uploaderStore';
import UploaderWindow from '@/components/layouts/transfer/uploader/UploaderWindow';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// Regression: the REAL virtualizer is used (not mocked). Affix mounts its Portal one render late, so a scroll
// element held in a plain ref was still null and the list stayed empty.
vi.mock('@wailsio/runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>();
  return { ...actual, Events: { ...actual.Events, On: vi.fn() } };
});
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  CancelAllUploads: vi.fn(),
  CancelUploadOne: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

describe('UploaderWindow with the real virtualizer', () => {
  let handlers: Record<string, (e: { data: unknown }) => void>;
  const sizes = [
    ['offsetHeight', 260],
    ['offsetWidth', 400],
    ['clientHeight', 260],
    ['clientWidth', 400],
  ] as const;

  beforeEach(() => {
    handlers = {};
    vi.mocked(Events.On).mockImplementation(((name: string, cb: (e: { data: unknown }) => void) => {
      handlers[name] = cb;
      return vi.fn();
    }) as never);
    // jsdom has no layout: give elements a viewport so the virtualizer renders rows.
    for (const [prop, value] of sizes) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
    }
    useUploaderStore.getState().reset();
  });

  afterEach(() => {
    for (const [prop] of sizes) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  });

  it('lists the item when the window opens on upload-started', async () => {
    renderWithProviders(<UploaderWindow />);

    act(() =>
      handlers['uploader:upload-started']({
        data: { uploadId: 'u1', fileName: 'a.bin', key: 'a.bin', bucket: 'bkt', total: 2048 },
      })
    );

    expect(screen.getByText('Uploading')).toBeInTheDocument();
    expect(await screen.findByText('Object: a.bin')).toBeInTheDocument();
  });

  it('lays the items out in the virtual list with an 8px gap', async () => {
    renderWithProviders(<UploaderWindow />);

    for (const id of ['u1', 'u2']) {
      act(() =>
        handlers['uploader:upload-started']({
          data: { uploadId: id, fileName: `${id}.bin`, key: `${id}.bin`, bucket: 'bkt', total: 2048 },
        })
      );
    }

    const wrapper = (name: string) => screen.getByText(name).closest('[style*="translateY"]') as HTMLElement;
    await screen.findByText('Object: u2.bin');
    expect(wrapper('Object: u1.bin').style.transform).toBe('translateY(0px)');
    expect(wrapper('Object: u2.bin').style.transform).toBe('translateY(88px)');
  });
});
