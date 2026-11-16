import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainLayout from '@/components/layouts/MainLayout';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/s3/transfer/downloader/DownloaderWindow', () => ({ default: () => <div /> }));
vi.mock('@/pages/s3/transfer/uploader/UploaderWindow', () => ({ default: () => <div /> }));
const mounts = vi.hoisted(() => ({ s3: 0, sql: 0 }));
vi.mock('@/pages/s3/S3Workspace', async () => {
  const { useEffect } = await import('react');
  return {
    default: function S3WorkspaceMock() {
      useEffect(() => {
        mounts.s3 += 1;
      }, []);
      return <div>s3 workspace</div>;
    },
  };
});
vi.mock('@/pages/sql/SqlWorkspace', async () => {
  const { useEffect } = await import('react');
  return {
    default: function SqlWorkspaceMock() {
      useEffect(() => {
        mounts.sql += 1;
      }, []);
      return <div>sql workspace</div>;
    },
  };
});
vi.mock('@/components/modals/lazyModals', () => ({
  showConnectModal: vi.fn(),
  showHistoryModal: vi.fn(),
  showSettingModal: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

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

const renderLayout = () => renderWithProviders(<MainLayout />);

const mode = (name: string) => screen.getByRole('radio', { name });

describe('MainLayout SQL mode', () => {
  beforeEach(() => {
    rt.toggleMaximise.mockClear();
    mounts.s3 = 0;
    mounts.sql = 0;
  });

  it('starts in S3 mode with SQL not mounted', async () => {
    renderLayout();
    await screen.findByText('s3 workspace');
    expect(mode('S3')).toBeChecked();
    expect(mode('SQL')).not.toBeChecked();
    expect(screen.queryByText('sql workspace')).not.toBeInTheDocument();
    expect(screen.getByText('s3 workspace')).toBeVisible();
  });

  it('mounts SQL on first selection, hides S3 but keeps it mounted, and switches back', async () => {
    renderLayout();

    await userEvent.click(mode('SQL'));

    expect(await screen.findByText('sql workspace')).toBeVisible();
    expect(screen.getByText('s3 workspace')).toBeInTheDocument();
    expect(screen.getByText('s3 workspace')).not.toBeVisible();

    await userEvent.click(mode('S3'));

    expect(screen.getByText('s3 workspace')).toBeVisible();
    expect(screen.getByText('sql workspace')).toBeInTheDocument();
    expect(screen.getByText('sql workspace')).not.toBeVisible();
  });

  it('does not remount the S3 tab page when switching to SQL and back', async () => {
    renderLayout();
    await screen.findByText('s3 workspace');
    const first = screen.getByText('s3 workspace');
    await userEvent.click(mode('SQL'));
    await screen.findByText('sql workspace');
    await userEvent.click(mode('S3'));
    expect(screen.getByText('s3 workspace')).toBe(first);
    expect(mounts.s3).toBe(1);
  });

  it('does not remount a workspace when its mode is selected again', async () => {
    renderLayout();
    await screen.findByText('s3 workspace');

    await userEvent.click(mode('S3'));
    expect(mounts.s3).toBe(1);

    await userEvent.click(mode('SQL'));
    await screen.findByText('sql workspace');
    await userEvent.click(mode('S3'));
    await userEvent.click(mode('SQL'));
    await userEvent.click(mode('SQL'));
    expect(mounts.sql).toBe(1);
    expect(mounts.s3).toBe(1);
  });

  it('keeps the same SQL instance across switches (no remount)', async () => {
    renderLayout();
    await userEvent.click(mode('SQL'));
    const first = await screen.findByText('sql workspace');
    await userEvent.click(mode('S3'));
    await userEvent.click(mode('SQL'));
    expect(screen.getByText('sql workspace')).toBe(first);
  });

  it('does not toggle maximise when the mode switch or header groups are double-clicked', async () => {
    renderLayout();
    await screen.findByRole('button', { name: 'Maximise' });

    fireEvent.doubleClick(mode('SQL'));
    fireEvent.doubleClick(screen.getByRole('radiogroup'));
    const settingsGroup = screen.getByRole('button', { name: 'Settings' }).closest('[data-no-maximise]')!;
    fireEvent.doubleClick(settingsGroup);

    expect(rt.toggleMaximise).not.toHaveBeenCalled();
  });

  it('still toggles maximise on the empty header area', async () => {
    renderLayout();
    await screen.findByRole('button', { name: 'Maximise' });
    fireEvent.doubleClick(screen.getByText('S3Browser'));
    expect(rt.toggleMaximise).toHaveBeenCalledTimes(1);
  });
});
