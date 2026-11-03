import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layouts/MainLayout';
import { showHistoryModal, showSettingModal } from '@/components/modals/lazyModals';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/components/layouts/transfer/downloader/DownloaderWindow', () => ({
  default: () => <div>downloader window</div>,
}));
vi.mock('@/components/layouts/transfer/uploader/UploaderWindow', () => ({ default: () => <div>uploader window</div> }));
vi.mock('@/components/layouts/navbar/LeftNavbar', () => ({ default: () => <div>left navbar</div> }));
vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showHistoryModal: vi.fn(),
  showSettingModal: vi.fn(),
}));

const rt = vi.hoisted(() => ({ toggleMaximise: vi.fn() }));

vi.mock('@wailsio/runtime', () => ({
  Window: {
    IsMaximised: () => Promise.resolve(false),
    Minimise: vi.fn(),
    ToggleMaximise: rt.toggleMaximise,
    Close: vi.fn(),
  },
  Events: {
    On: () => () => {},
    Types: { Common: { WindowMaximise: 'max', WindowUnMaximise: 'unmax', WindowRestore: 'restore' } },
  },
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
  beforeEach(() => {
    rt.toggleMaximise.mockClear();
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

  it('has no empty group in the header', () => {
    renderLayout();

    const header = screen.getByRole('banner');
    const groups = Array.from(header.querySelectorAll('.mantine-Group-root'));
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group).not.toBeEmptyDOMElement();
  });

  it('shows the app name and the window controls in the header', async () => {
    renderLayout();

    expect(screen.getByText('S3Browser')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Maximise' })).toBeInTheDocument();
  });

  it('toggles maximise when the empty header area is double-clicked', async () => {
    renderLayout();
    await screen.findByRole('button', { name: 'Maximise' });

    fireEvent.doubleClick(screen.getByText('S3Browser'));

    expect(rt.toggleMaximise).toHaveBeenCalledTimes(1);
  });

  it('does not toggle maximise when a header button is double-clicked', async () => {
    renderLayout();
    const button = await screen.findByRole('button', { name: 'Settings' });

    fireEvent.doubleClick(button);

    expect(rt.toggleMaximise).not.toHaveBeenCalled();
  });
});
