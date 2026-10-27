import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layouts/MainLayout';
import HistoryModal from '@/components/modals/HistoryModal';
import i18n from '@/locales/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/components/layouts/downloader/DownloaderWindow', () => ({ default: () => <div>downloader window</div> }));
vi.mock('@/components/layouts/uploader/UploaderWindow', () => ({ default: () => <div>uploader window</div> }));
vi.mock('@/components/layouts/navbar/LeftNavbar', () => ({ default: () => <div>left navbar</div> }));
vi.mock('@/components/modals/HistoryModal', () => ({ default: { show: vi.fn() } }));

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
  beforeEach(() => {
    vi.spyOn(i18n, 'changeLanguage').mockResolvedValue(i18n.t);
  });

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

    expect(HistoryModal.show).toHaveBeenCalledTimes(1);
  });

  it('changes the language from the segmented control', async () => {
    renderLayout();

    await userEvent.click(screen.getByLabelText('VI'));
    expect(i18n.changeLanguage).toHaveBeenLastCalledWith('vi');

    await userEvent.click(screen.getByLabelText('JA'));
    expect(i18n.changeLanguage).toHaveBeenLastCalledWith('ja');
  });
});
