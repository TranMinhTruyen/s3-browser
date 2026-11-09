import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChooseImportFile, ImportProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import HeaderButtonGroup from '@/components/layouts/navbar/components/HeaderButtonGroup';
import { showConnectModal, showImportPasswordModal } from '@/components/modals/lazyModals';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showHistoryModal: vi.fn(),
  showImportPasswordModal: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({}));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({
  GetAllConnectionProfile: vi.fn(),
  ChooseImportFile: vi.fn(),
  ImportProfile: vi.fn(),
}));

describe('HeaderButtonGroup', () => {
  const loadConnectionProfiles = vi.fn();

  beforeEach(() => {
    loadConnectionProfiles.mockResolvedValue(undefined);
    useProfileStore.setState({ loadConnectionProfiles });
  });

  it('opens the connect modal in connect mode', async () => {
    renderWithProviders(<HeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(showConnectModal).toHaveBeenCalledWith({ mode: 'connect' });
  });

  it('opens the connect modal in createProfile mode', async () => {
    renderWithProviders(<HeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Create connection profile' }));

    expect(showConnectModal).toHaveBeenCalledWith({ mode: 'createProfile' });
  });

  it('reloads the connection profiles on refresh', async () => {
    renderWithProviders(<HeaderButtonGroup />);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh connection profile list' }));

    expect(loadConnectionProfiles).toHaveBeenCalledTimes(1);
  });

  describe('import profile', () => {
    const updateConnectionProfiles = vi.fn();
    const callIPCMock = vi.mocked(callIPC);
    const modalMock = vi.mocked(showImportPasswordModal);
    const profile = { id: 'p9', name: 'Imported', autoConnect: true };
    const importBtn = () => screen.getByRole('button', { name: 'Import connection profile' });

    beforeEach(() => {
      vi.clearAllMocks();
      loadConnectionProfiles.mockResolvedValue(undefined);
      useProfileStore.setState({ loadConnectionProfiles, updateConnectionProfiles });
    });

    it('exposes the Import tooltip as the button name', () => {
      renderWithProviders(<HeaderButtonGroup />);

      expect(importBtn()).toBeInTheDocument();
    });

    it.each([
      ['null (failed or canceled)', null],
      ['an empty path', { path: '', name: '', encrypted: false }],
    ])('stops when ChooseImportFile returns %s', async (_n, file) => {
      callIPCMock.mockResolvedValueOnce(file as never);
      renderWithProviders(<HeaderButtonGroup />);

      await userEvent.click(importBtn());

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      expect(callIPCMock).toHaveBeenCalledWith(ChooseImportFile, []);
      expect(modalMock).not.toHaveBeenCalled();
      expect(updateConnectionProfiles).not.toHaveBeenCalled();
    });

    it('imports a plain file with an empty password, adds it to the list and does not connect', async () => {
      callIPCMock
        .mockResolvedValueOnce({ path: 'C:/in/a.json', name: 'a.json', encrypted: false } as never)
        .mockResolvedValueOnce(profile as never);
      renderWithProviders(<HeaderButtonGroup />);

      await userEvent.click(importBtn());

      await waitFor(() => expect(updateConnectionProfiles).toHaveBeenCalledWith('p9', profile));
      expect(callIPCMock).toHaveBeenNthCalledWith(2, ImportProfile, [{ path: 'C:/in/a.json', password: '' }]);
      expect(modalMock).not.toHaveBeenCalled();
      expect(showConnectModal).not.toHaveBeenCalled();
      expect(callIPCMock).toHaveBeenCalledTimes(2);
    });

    it('does not update the store when the import returns null', async () => {
      callIPCMock
        .mockResolvedValueOnce({ path: 'C:/in/a.json', name: 'a.json', encrypted: false } as never)
        .mockResolvedValueOnce(null as never);
      renderWithProviders(<HeaderButtonGroup />);

      await userEvent.click(importBtn());

      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(2));
      expect(updateConnectionProfiles).not.toHaveBeenCalled();
    });

    it('opens the password modal for an encrypted file and adds the imported profile', async () => {
      callIPCMock.mockResolvedValueOnce({ path: 'C:/in/e.json', name: 'e.json', encrypted: true } as never);
      modalMock.mockResolvedValueOnce(profile as never);
      renderWithProviders(<HeaderButtonGroup />);

      await userEvent.click(importBtn());

      await waitFor(() => expect(updateConnectionProfiles).toHaveBeenCalledWith('p9', profile));
      expect(modalMock).toHaveBeenCalledWith({ path: 'C:/in/e.json', name: 'e.json' });
      expect(callIPCMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['canceled (null)', null],
      ['not loaded (undefined)', undefined],
    ])('does not update the store when the password modal is %s', async (_n, result) => {
      callIPCMock.mockResolvedValueOnce({ path: 'C:/in/e.json', name: 'e.json', encrypted: true } as never);
      modalMock.mockResolvedValueOnce(result as never);
      renderWithProviders(<HeaderButtonGroup />);

      await userEvent.click(importBtn());

      await waitFor(() => expect(modalMock).toHaveBeenCalledTimes(1));
      expect(updateConnectionProfiles).not.toHaveBeenCalled();
    });

    it('ignores a second click while an import is running, then allows a new one', async () => {
      let release!: (v: unknown) => void;
      callIPCMock.mockReturnValueOnce(new Promise(r => (release = r)) as never);
      renderWithProviders(<HeaderButtonGroup />);

      // Both clicks land in one batch, before React can disable the button, so only the ref guard stops the second.
      act(() => {
        fireEvent.click(importBtn());
        fireEvent.click(importBtn());
      });
      expect(callIPCMock).toHaveBeenCalledTimes(1);

      release(null);
      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      callIPCMock.mockResolvedValueOnce(null as never);
      await waitFor(async () => {
        await userEvent.click(importBtn());
        expect(callIPCMock).toHaveBeenCalledTimes(2);
      });
    });

    it('resets the guard when the import throws', async () => {
      callIPCMock.mockRejectedValueOnce(new Error('boom'));
      renderWithProviders(<HeaderButtonGroup />);

      await userEvent.click(importBtn());
      await waitFor(() => expect(callIPCMock).toHaveBeenCalledTimes(1));
      callIPCMock.mockResolvedValueOnce(null as never);
      await waitFor(async () => {
        await userEvent.click(importBtn());
        expect(callIPCMock).toHaveBeenCalledTimes(2);
      });
    });
  });
});
