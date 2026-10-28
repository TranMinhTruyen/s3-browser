import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConnectModal from '@/components/modals/ConnectModal';
import HistoryModal from '@/components/modals/HistoryModal';
import { showConnectModal, showHistoryModal } from '@/components/modals/lazyModals';
import i18n from '@/locales/i18n';

vi.mock('@/components/modals/ConnectModal', () => ({ default: { show: vi.fn() } }));
vi.mock('@/components/modals/HistoryModal', () => ({ default: { show: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

describe('lazyModals', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('shows the connect modal with the given props once the chunk is loaded', async () => {
    const props = { mode: 'editProfile' as const };
    await showConnectModal(props);

    expect(ConnectModal.show).toHaveBeenCalledWith(props);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows the history modal once the chunk is loaded', async () => {
    await showHistoryModal();

    expect(HistoryModal.show).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ['connect', () => showConnectModal({ mode: 'editProfile' as const }), ConnectModal],
    ['history', () => showHistoryModal(), HistoryModal],
  ])('reports a failed %s modal load without rejecting', async (_name, open, modal) => {
    const error = new Error('chunk failed');
    vi.mocked(modal.show).mockImplementationOnce(() => {
      throw error;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(open()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith('Failed to load modal chunk', error);
    const message = i18n.t('common:modalLoadError');
    expect(message).not.toBe('modalLoadError');
    expect(toast.error).toHaveBeenCalledWith(message);
  });

  it('reports a rejected show() promise for the connect modal', async () => {
    vi.mocked(ConnectModal.show).mockRejectedValueOnce(new Error('boom'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(showConnectModal({ mode: 'editProfile' as const })).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(i18n.t('common:modalLoadError'));
  });
});
