import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layouts/MainLayout';
import { showHistoryModal, showSettingModal } from '@/components/modals/lazyModals';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/components/layouts/downloader/DownloaderWindow', () => ({ default: () => <div>downloader window</div> }));
vi.mock('@/components/layouts/uploader/UploaderWindow', () => ({ default: () => <div>uploader window</div> }));
vi.mock('@/components/layouts/navbar/LeftNavbar', () => ({ default: () => <div>left navbar</div> }));
vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showHistoryModal: vi.fn(),
  showSettingModal: vi.fn(),
}));

const renderLayout = () =>
  renderWithProviders(
    <MemoryRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<div>outlet page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

describe('MainLayout', () => {
  it('renders the navbar, the routed page and the transfer windows', () => {
    renderLayout();

    expect(screen.getByText('left navbar')).toBeInTheDocument();
    expect(screen.getByText('outlet page')).toBeInTheDocument();
    expect(screen.getByText('downloader window')).toBeInTheDocument();
    expect(screen.getByText('uploader window')).toBeInTheDocument();
  });

  it('opens the download history modal from the header button', async () => {
    renderLayout();

    await userEvent.click(screen.getByRole('button', { name: 'Download history' }));

    expect(showHistoryModal).toHaveBeenCalledTimes(1);
  });

  it('opens the setting modal from the header button and no longer shows the language switch', async () => {
    renderLayout();

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(showSettingModal).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('VI')).not.toBeInTheDocument();
  });

  it('places the setting button before the history button', () => {
    renderLayout();

    const buttons = screen.getAllByRole('button');
    const setting = buttons.indexOf(screen.getByRole('button', { name: 'Settings' }));
    const history = buttons.indexOf(screen.getByRole('button', { name: 'Download history' }));
    expect(setting).toBeLessThan(history);
  });
});
