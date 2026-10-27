import { CancelError, CancellablePromise } from '@wailsio/runtime';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callIPC, invalidateLoads } from '@/common/utils/ipcUtils';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock('@/locales/i18n', () => ({ default: { t: (key: string) => key } }));

const ok = (body: unknown, extra: object = {}) => ({ result: true, body, messageList: [], ...extra }) as never;
const deferred = () => {
  let release!: (value: unknown) => void;
  const promise = new Promise(resolve => {
    release = resolve;
  });
  return { promise, release };
};

describe('callIPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the body of a successful call and runs resolveAction', async () => {
    const resolveAction = vi.fn();
    const rejectAction = vi.fn();
    const binding = vi.fn().mockResolvedValue(ok('body'));

    const body = await callIPC(binding, [1, 2] as never, { resolveAction, rejectAction });

    expect(binding).toHaveBeenCalledWith(1, 2);
    expect(body).toBe('body');
    expect(resolveAction).toHaveBeenCalledOnce();
    expect(rejectAction).not.toHaveBeenCalled();
  });

  it('returns null and runs rejectAction for a failed result, tolerating missing actions', async () => {
    const rejectAction = vi.fn();
    const failed = { result: false, body: 'zero' } as never;

    expect(await callIPC(vi.fn().mockResolvedValue(failed), [] as never, { rejectAction })).toBeNull();
    expect(rejectAction).toHaveBeenCalledOnce();
    expect(await callIPC(vi.fn().mockResolvedValue(failed), [] as never)).toBeNull();
    expect(await callIPC(vi.fn().mockResolvedValue(ok('x')), [] as never)).toBe('x');
  });

  it('does not show messages when showMessage is false', async () => {
    const output = ok('x', { messageList: [{ messageType: 'E', moduleName: 'm', messageCode: 'c' }] });
    await callIPC(vi.fn().mockResolvedValue(output), [] as never, { showMessage: false });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows messages sorted by order with the matching toast type', async () => {
    const calls: string[] = [];
    vi.mocked(toast.error).mockImplementation(((m: string) => calls.push(`E:${m}`)) as never);
    vi.mocked(toast.warning).mockImplementation(((m: string) => calls.push(`W:${m}`)) as never);
    vi.mocked(toast.info).mockImplementation(((m: string) => calls.push(`I:${m}`)) as never);
    vi.mocked(toast.success).mockImplementation(((m: string) => calls.push(`S:${m}`)) as never);
    const msg = (messageType: string, messageCode: string, order?: string, errorDetail?: string) => ({
      messageType,
      moduleName: 'mod',
      messageCode,
      order,
      errorDetail,
      params: { p: 1 },
    });
    const output = ok('x', {
      messageList: [
        msg('S', 'S1', '4'),
        msg('I', 'I1', '3'),
        msg('W', 'W1', '2'),
        msg('E', 'E1', '1', 'detail'),
        msg('E', 'E0'),
        msg('S', 'S0', '5'),
        msg('E', 'E00'),
      ],
    });

    await callIPC(vi.fn().mockResolvedValue(output), [] as never);

    expect(calls).toEqual([
      'E:ipcMessage:mod.E0',
      'E:ipcMessage:mod.E00',
      'E:ipcMessage:mod.E1',
      'W:ipcMessage:mod.W1',
      'I:ipcMessage:mod.I1',
      'S:ipcMessage:mod.S1',
      'S:ipcMessage:mod.S0',
    ]);
    expect(toast.error).toHaveBeenCalledWith('ipcMessage:mod.E1', { description: 'detail' });
    expect(toast.warning).toHaveBeenCalledWith('ipcMessage:mod.W1', { description: '' });
  });

  it('tolerates a missing message list', async () => {
    expect(await callIPC(vi.fn().mockResolvedValue({ result: true, body: 1 }), [] as never)).toBe(1);
  });

  it('drops the result of a stale call in the same scope', async () => {
    const first = deferred();
    const firstCall = callIPC(vi.fn().mockReturnValue(first.promise), [] as never, { scope: 'stale' });
    const secondBody = await callIPC(vi.fn().mockResolvedValue(ok('second')), [] as never, { scope: 'stale' });
    first.release(ok('first'));

    expect(secondBody).toBe('second');
    expect(await firstCall).toBeNull();
  });

  it('drops the result after invalidateLoads on the scope or its parent', async () => {
    const pending = deferred();
    const call = callIPC(vi.fn().mockReturnValue(pending.promise), [] as never, { scope: 'parent/child' });
    invalidateLoads('other');
    invalidateLoads('parent');
    pending.release(ok('late'));
    expect(await call).toBeNull();
  });

  it('does not invalidate scopes that only share a prefix', async () => {
    const pending = deferred();
    const call = callIPC(vi.fn().mockReturnValue(pending.promise), [] as never, { scope: 'keeper' });
    invalidateLoads('keep');
    pending.release(ok('v'));
    expect(await call).toBe('v');
  });

  it('cancels a CancellablePromise on abort and returns null', async () => {
    const controller = new AbortController();
    const promise = new CancellablePromise<never>(() => {});
    const cancelOn = vi.spyOn(promise, 'cancelOn');

    const call = callIPC(vi.fn().mockReturnValue(promise), [] as never, { signal: controller.signal });
    controller.abort();

    expect(await call).toBeNull();
    expect(cancelOn).toHaveBeenCalledWith(controller.signal);
  });

  it('returns null when the signal is aborted but the call is a plain promise', async () => {
    const controller = new AbortController();
    const call = callIPC(vi.fn().mockResolvedValue(ok('x')), [] as never, { signal: controller.signal });
    controller.abort();
    expect(await call).toBeNull();
  });

  it('keeps the result for a live signal', async () => {
    const controller = new AbortController();
    expect(await callIPC(vi.fn().mockResolvedValue(ok('x')), [] as never, { signal: controller.signal })).toBe('x');
  });

  it('treats CancelError as silent', async () => {
    const body = await callIPC(vi.fn().mockRejectedValue(new CancelError('stop')), [] as never);
    expect(body).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts other errors and runs rejectAction', async () => {
    const rejectAction = vi.fn();
    expect(await callIPC(vi.fn().mockRejectedValue(new Error('boom')), [] as never, { rejectAction })).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('ipcMessage:common.CME001', { description: 'boom' });
    expect(rejectAction).toHaveBeenCalledWith(undefined);

    await callIPC(vi.fn().mockRejectedValue('text'), [] as never);
    expect(toast.error).toHaveBeenLastCalledWith('ipcMessage:common.CME001', { description: 'text' });
  });
});
