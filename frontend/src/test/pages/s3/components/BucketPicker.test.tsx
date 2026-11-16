import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetListBucket, SearchBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import type { Bucket } from '@wails/S3Browser/models/bucket';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import BucketPicker from '@/pages/s3/components/BucketPicker';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({
  GetListBucket: vi.fn(),
  SearchBucket: vi.fn(),
}));

const size = vi.hoisted(() => ({ width: null as number | null }));
vi.mock('@mantine/hooks', async importOriginal => {
  const actual = await importOriginal<typeof import('@mantine/hooks')>();
  return {
    ...actual,
    useElementSize: <T extends HTMLElement>() => {
      const r = actual.useElementSize<T>();
      return size.width === null ? r : { ...r, width: size.width };
    },
  };
});

type Page = { bucketList?: Partial<Bucket>[]; nextCursor?: string } | null | undefined;
type Pending = { resolve: (page: Page) => void; signal: AbortSignal; binding: unknown; args: unknown[] };

const page = (names: string[], nextCursor = ''): Page => ({ bucketList: names.map(name => ({ name })), nextCursor });

/** Replaces callIPC with a mock that answers from a queue (or keeps the call pending when manual). */
function answerWith(...pages: Page[]) {
  const queue = [...pages];
  vi.mocked(callIPC).mockImplementation((async () => (queue.length > 1 ? queue.shift() : queue[0])) as never);
}

function holdRequests() {
  const pending: Pending[] = [];
  vi.mocked(callIPC).mockImplementation(
    ((binding: unknown, args: unknown[], opts: { signal: AbortSignal }) =>
      new Promise<Page>(resolve => {
        pending.push({ resolve, signal: opts.signal, binding, args });
      })) as never
  );
  return pending;
}

const flush = () => act(async () => {});
const trigger = () => screen.getAllByRole('button').find(b => b.getAttribute('aria-haspopup') === 'listbox')!;

function setup(props: Partial<React.ComponentProps<typeof BucketPicker>> = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const view = renderWithProviders(
    <BucketPicker connectionId="c1" profileName="Prof" value={null} onChange={onChange} {...props} />
  );
  return { onChange, user, view };
}

describe('BucketPicker', () => {
  afterEach(() => {
    size.width = null;
    vi.mocked(ConfirmModal.show).mockReset();
    vi.useRealTimers();
  });

  it('sets the dropdown min-width in raw px and sizes the check icon in rem', async () => {
    size.width = 311;
    answerWith(page(['alpha', 'beta']));
    const { user } = setup({ value: 'alpha' });
    await user.click(trigger());
    await screen.findByText('beta');

    const dropdown = document.querySelector<HTMLElement>('.mantine-Combobox-dropdown')!;
    expect(dropdown.style.minWidth).toBe('311px');
    const [alpha, beta] = screen.getAllByRole('option', { hidden: true });
    expect(alpha.querySelector('svg')).toHaveAttribute('width', '0.75rem');
    expect(beta.querySelector('svg')).toBeNull();
  });

  it('shows the placeholder and does not load until opened', () => {
    answerWith(page(['a']));
    setup();
    expect(screen.getByText('Select bucket')).toBeInTheDocument();
    expect(callIPC).not.toHaveBeenCalled();
  });

  it('loads the first 20 buckets when the dropdown opens and selects one', async () => {
    answerWith(page(['alpha', 'beta']));
    const { user, onChange } = setup();
    await user.click(trigger());
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(callIPC).toHaveBeenCalledExactlyOnceWith(
      GetListBucket,
      [{ connectionId: 'c1', profileName: 'Prof', nextCursor: '', limit: 20, checkWrite: true }],
      { signal: expect.any(AbortSignal) }
    );
    expect(screen.queryByText('Load more')).not.toBeInTheDocument();

    await user.click(screen.getByText('beta'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('beta');
  });

  it('marks the selected bucket and shows its name', async () => {
    answerWith(page(['alpha', 'beta']));
    const { user } = setup({ value: 'beta' });
    expect(screen.getAllByText('beta')).toHaveLength(1);
    await user.click(trigger());
    await screen.findByText('alpha');
    const options = screen.getAllByRole('option', { hidden: true });
    expect(options.find(o => o.textContent === 'beta')).toHaveAttribute('data-combobox-active', 'true');
    expect(options.find(o => o.textContent === 'alpha')).not.toHaveAttribute('data-combobox-active');
  });

  it('focuses the search box when the dropdown opens', async () => {
    answerWith(page(['alpha']));
    // jsdom cannot focus inside the display:none transition wrapper, so assert the focus() call target.
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
    const { user } = setup();
    await user.click(trigger());
    const search = await screen.findByPlaceholderText('Search bucket');
    await waitFor(() => expect(focus.mock.contexts).toContain(search));
  });

  it('shows the empty message when there are no buckets', async () => {
    answerWith(page([]));
    const { user } = setup();
    await user.click(trigger());
    expect(await screen.findByText('No buckets found')).toBeInTheDocument();
  });

  it('treats a null answer and a missing list as no buckets', async () => {
    answerWith(null);
    const { user } = setup();
    await user.click(trigger());
    expect(await screen.findByText('No buckets found')).toBeInTheDocument();
  });

  it('treats a page without list or cursor as empty', async () => {
    answerWith({});
    const { user } = setup();
    await user.click(trigger());
    expect(await screen.findByText('No buckets found')).toBeInTheDocument();
    expect(screen.queryByText('Load more')).not.toBeInTheDocument();
  });

  it('does not call the backend without a connection', async () => {
    const { user } = setup({ connectionId: undefined });
    await user.click(trigger());
    expect(await screen.findByText('No buckets found')).toBeInTheDocument();
    expect(callIPC).not.toHaveBeenCalled();
  });

  it('does not render buckets without a name and shows the empty message when none has one', async () => {
    answerWith({ bucketList: [{}, { name: '' }], nextCursor: '' });
    const { user } = setup();
    await user.click(trigger());

    expect(await screen.findByText('No buckets found')).toBeInTheDocument();
    expect(screen.queryAllByRole('option', { hidden: true })).toHaveLength(0);
  });

  it('renders only the buckets that have a name from a mixed list', async () => {
    answerWith({ bucketList: [{}, { name: 'a' }, { name: '' }, { name: 'b' }], nextCursor: '' });
    const { user } = setup();
    await user.click(trigger());

    const options = await screen.findAllByRole('option', { hidden: true });
    expect(options.map(o => o.textContent)).toEqual(['a', 'b']);
    expect(screen.queryByText('No buckets found')).not.toBeInTheDocument();
  });

  it('shows a loader while loading and hides the load more button', async () => {
    const pending = holdRequests();
    const { user } = setup();
    await user.click(trigger());
    await flush();
    expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(screen.queryByText('No buckets found')).not.toBeInTheDocument();
    await act(async () => pending[0].resolve(page(['a'], 'next')));
    expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    expect(screen.getByText('Load more')).toBeInTheDocument();
  });

  describe('load more', () => {
    it('appends the next page using the cursor and hides the button when exhausted', async () => {
      answerWith(page(['a', 'b'], 'cur1'), page(['c'], ''));
      const { user } = setup();
      await user.click(trigger());
      await user.click(await screen.findByText('Load more'));
      expect(await screen.findByText('c')).toBeInTheDocument();
      expect(screen.getByText('a')).toBeInTheDocument();
      expect(vi.mocked(callIPC).mock.calls[1][1]).toEqual([
        { connectionId: 'c1', profileName: 'Prof', nextCursor: 'cur1', limit: 20, checkWrite: true },
      ]);
      expect(screen.queryByText('Load more')).not.toBeInTheDocument();
    });

    it('handles a page without list or cursor', async () => {
      answerWith(page(['a'], 'cur1'), {});
      const { user } = setup();
      await user.click(trigger());
      await user.click(await screen.findByText('Load more'));
      await flush();
      expect(screen.getByText('a')).toBeInTheDocument();
      expect(screen.queryByText('Load more')).not.toBeInTheDocument();
    });

    it('keeps the list and the cursor when loading more fails', async () => {
      answerWith(page(['a'], 'cur1'), null);
      const { user } = setup();
      await user.click(trigger());
      await user.click(await screen.findByText('Load more'));
      await flush();
      expect(screen.getByText('a')).toBeInTheDocument();
      expect(screen.getByText('Load more')).toBeInTheDocument();
      expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    });

    it('ignores the answer of a canceled load more', async () => {
      const pending = holdRequests();
      const { user } = setup();
      await user.click(trigger());
      await act(async () => pending[0].resolve(page(['a'], 'cur1')));
      await user.click(await screen.findByText('Load more'));
      expect(pending).toHaveLength(2);
      // Closing the dropdown aborts the running request.
      await user.keyboard('{Escape}');
      expect(pending[1].signal.aborted).toBe(true);
      await act(async () => pending[1].resolve(page(['late'], '')));
      expect(screen.queryByText('late')).not.toBeInTheDocument();
    });
  });

  describe('search', () => {
    it('searches after the 300ms debounce with the trimmed keyword', async () => {
      answerWith(page(['a']));
      const { user } = setup();
      await user.click(trigger());
      await screen.findByText('a');
      vi.mocked(callIPC).mockClear();
      answerWith(page(['found'], 's1'));

      vi.useFakeTimers();
      fireEvent.change(screen.getByPlaceholderText('Search bucket'), { target: { value: ' fo ' } });
      expect(callIPC).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(299);
      });
      expect(callIPC).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      await flush();

      expect(callIPC).toHaveBeenCalledExactlyOnceWith(
        SearchBucket,
        [{ connectionId: 'c1', profileName: 'Prof', keyword: 'fo', nextCursor: '', checkWrite: true }],
        { signal: expect.any(AbortSignal) }
      );
      expect(screen.getByText('found')).toBeInTheDocument();
      expect(screen.queryByText('a')).not.toBeInTheDocument();
    });

    it('pages search results with the cursor', async () => {
      answerWith(page(['a']));
      const { user } = setup();
      await user.click(trigger());
      await screen.findByText('a');
      answerWith(page(['f1'], 's1'), page(['f2'], ''));
      vi.useFakeTimers();
      fireEvent.change(screen.getByPlaceholderText('Search bucket'), { target: { value: 'f' } });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      await flush();
      fireEvent.click(screen.getByText('Load more'));
      await flush();
      expect(screen.getByText('f2')).toBeInTheDocument();
      expect(vi.mocked(callIPC).mock.calls.at(-1)).toEqual([
        SearchBucket,
        [{ connectionId: 'c1', profileName: 'Prof', keyword: 'f', nextCursor: 's1', checkWrite: true }],
        { signal: expect.any(AbortSignal) },
      ]);
    });

    it('aborts the previous request when a new search starts', async () => {
      const pending = holdRequests();
      const { user } = setup();
      await user.click(trigger());
      await flush();
      expect(pending).toHaveLength(1);
      vi.useFakeTimers();
      fireEvent.change(screen.getByPlaceholderText('Search bucket'), { target: { value: 'x' } });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(pending[0].signal.aborted).toBe(true);
      expect(pending.at(-1)!.binding).toBe(SearchBucket);
      // The stale answer of the first request is ignored.
      await act(async () => pending[0].resolve(page(['stale'])));
      expect(screen.queryByText('stale')).not.toBeInTheDocument();
    });
  });

  describe('closing', () => {
    it('aborts the request on unmount', async () => {
      const pending = holdRequests();
      const { user, view } = setup();
      await user.click(trigger());
      await flush();
      view.unmount();
      expect(pending[0].signal.aborted).toBe(true);
    });

    it('hides the loader when the dropdown is closed while a request is pending', async () => {
      holdRequests();
      const { user } = setup();
      await user.click(trigger());
      await flush();
      expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await flush();
      expect(screen.getByPlaceholderText('Search bucket')).not.toBeVisible();
      // Reopening shows the loader only for the fresh request, and closing again clears it.
      await user.click(trigger());
      await flush();
      expect(document.querySelector('.mantine-Loader-root')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await flush();
      expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    });

    it('shows the answer of the new keyword after the previous request was aborted', async () => {
      const pending = holdRequests();
      const { user } = setup();
      await user.click(trigger());
      await flush();
      vi.useFakeTimers();
      fireEvent.change(screen.getByPlaceholderText('Search bucket'), { target: { value: 'x' } });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(pending[0].signal.aborted).toBe(true);
      await act(async () => pending.at(-1)!.resolve(page(['x1'])));
      expect(screen.getByText('x1')).toBeInTheDocument();
      expect(document.querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    });

    it('reloads the first page when the dropdown opens again', async () => {
      answerWith(page(['a']));
      const { user } = setup();
      await user.click(trigger());
      await screen.findByText('a');
      await user.keyboard('{Escape}');
      await user.click(trigger());
      await flush();
      expect(callIPC).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear', () => {
    it('shows a clear button for a value and clears it without opening the dropdown', async () => {
      const { user, onChange } = setup({ value: 'alpha' });
      await user.click(screen.getByRole('button', { name: 'Clear' }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
      expect(callIPC).not.toHaveBeenCalled();
    });

    it('prevents the default of mousedown on the clear button', () => {
      setup({ value: 'alpha' });
      const notPrevented = fireEvent.mouseDown(screen.getByRole('button', { name: 'Clear' }));
      expect(notPrevented).toBe(false);
    });

    it('toggles the dropdown open and closed by clicking the field', async () => {
      answerWith(page(['a']));
      const { user } = setup();
      await user.click(trigger());
      expect(screen.getByPlaceholderText('Search bucket')).toHaveAttribute('data-expanded', 'true');
      await user.click(trigger());
      expect(screen.getByPlaceholderText('Search bucket')).not.toHaveAttribute('data-expanded');
    });

    it('has no clear button without a value', () => {
      setup();
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });

    it('has no clear button when disabled', () => {
      setup({ value: 'alpha', disabled: true });
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
      expect(trigger()).toBeDisabled();
    });
  });

  describe('inaccessible buckets', () => {
    const mixed = () =>
      answerWith({
        bucketList: [{ name: 'open' }, { name: 'locked', inaccessible: true }, { name: 'plain', inaccessible: false }],
        nextCursor: '',
      } as Page);
    const warning = 'Cannot access this bucket (no permission or it does not exist).';

    it('shows the warning icon only on inaccessible buckets', async () => {
      mixed();
      const { user } = setup();
      await user.click(trigger());
      await screen.findByText('locked');
      const icons = screen.getAllByLabelText(warning);
      expect(icons).toHaveLength(1);
      const options = screen.getAllByRole('option', { hidden: true });
      expect(options.find(o => o.textContent === 'locked')).toContainElement(icons[0]);
    });

    it.each([
      ['selects', true, 1],
      ['does not select', false, 0],
    ])('%s an inaccessible bucket when the confirmation resolves %s and closes the dropdown', async (_n, ok, calls) => {
      vi.mocked(ConfirmModal.show).mockResolvedValue(ok);
      mixed();
      const { user, onChange } = setup();
      await user.click(trigger());
      await user.click(await screen.findByText('locked'));
      expect(ConfirmModal.show).toHaveBeenCalledExactlyOnceWith({
        type: 'warning',
        confirmCode: 'C000007',
        params: { bucket: 'locked' },
      });
      await waitFor(() => expect(ConfirmModal.show).toHaveBeenCalled());
      await act(async () => {});
      if (calls) expect(onChange).toHaveBeenCalledExactlyOnceWith('locked');
      else expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('Search bucket')).not.toHaveAttribute('data-expanded');
    });

    it.each(['open', 'plain'])('selects the accessible bucket %s without a warning', async name => {
      mixed();
      const { user, onChange } = setup();
      await user.click(trigger());
      await user.click(await screen.findByText(name));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(name);
      expect(ConfirmModal.show).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('Search bucket')).not.toHaveAttribute('data-expanded');
    });
  });

  describe('read-only buckets', () => {
    const list = () =>
      answerWith({
        bucketList: [{ name: 'open' }, { name: 'ro', readOnly: true }, { name: 'rw', readOnly: false }],
        nextCursor: '',
      } as Page);
    const warning = 'You may not have permission to upload to this bucket.';

    it('shows the read-only warning icon only on read-only buckets', async () => {
      list();
      const { user } = setup();
      await user.click(trigger());
      await screen.findByText('ro');
      const icons = screen.getAllByLabelText(warning);
      expect(icons).toHaveLength(1);
      const options = screen.getAllByRole('option', { hidden: true });
      expect(options.find(o => o.textContent === 'ro')).toContainElement(icons[0]);
    });

    it.each([
      ['selects', true, 1],
      ['does not select', false, 0],
    ])('%s a read-only bucket (C000008) when the confirmation resolves %s', async (_n, ok, calls) => {
      vi.mocked(ConfirmModal.show).mockResolvedValue(ok);
      list();
      const { user, onChange } = setup();
      await user.click(trigger());
      await user.click(await screen.findByText('ro'));
      expect(ConfirmModal.show).toHaveBeenCalledExactlyOnceWith({
        type: 'warning',
        confirmCode: 'C000008',
        params: { bucket: 'ro' },
      });
      await waitFor(() => expect(ConfirmModal.show).toHaveBeenCalled());
      await act(async () => {});
      if (calls) expect(onChange).toHaveBeenCalledExactlyOnceWith('ro');
      else expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('Search bucket')).not.toHaveAttribute('data-expanded');
    });

    it('prefers the inaccessible message when a bucket is both inaccessible and read-only', async () => {
      answerWith({ bucketList: [{ name: 'both', inaccessible: true, readOnly: true }], nextCursor: '' } as Page);
      vi.mocked(ConfirmModal.show).mockResolvedValue(false);
      const { user, onChange } = setup();
      await user.click(trigger());
      await user.click(await screen.findByText('both'));
      expect(screen.getAllByLabelText('Cannot access this bucket (no permission or it does not exist).')).toHaveLength(
        1
      );
      expect(ConfirmModal.show).toHaveBeenCalledExactlyOnceWith({
        type: 'warning',
        confirmCode: 'C000007',
        params: { bucket: 'both' },
      });
      await act(async () => {});
      expect(onChange).not.toHaveBeenCalled();
    });

    it('selects a writable bucket normally', async () => {
      list();
      const { user, onChange } = setup();
      await user.click(trigger());
      await user.click(await screen.findByText('rw'));
      expect(onChange).toHaveBeenCalledExactlyOnceWith('rw');
      expect(ConfirmModal.show).not.toHaveBeenCalled();
    });
  });

  it('renders the label and the error', () => {
    setup({ label: 'Target bucket', error: 'Choose a target bucket' });
    expect(screen.getByText('Target bucket')).toBeInTheDocument();
    expect(screen.getByText('Choose a target bucket')).toBeInTheDocument();
  });
});
