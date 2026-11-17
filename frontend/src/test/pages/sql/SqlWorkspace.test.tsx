import { screen } from '@testing-library/react';
import { GetAllDbProfile } from '@wails/S3Browser/internal/handlers/dbhandler';
import { describe, expect, it, vi } from 'vitest';
import { callIPC } from '@/common/utils/ipcUtils';
import SqlWorkspace from '@/pages/sql/SqlWorkspace';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/dbhandler', () => ({ GetAllDbProfile: vi.fn() }));
vi.mock('@/pages/sql/navbar/SqlNavbar', () => ({ default: () => <div>sql navbar</div> }));
vi.mock('@/pages/sql/SqlTabPage', () => ({ default: () => <div>sql tab page</div> }));

describe('SqlWorkspace', () => {
  it('shows the profile navbar and the tab page side by side', () => {
    renderWithProviders(<SqlWorkspace />);
    expect(screen.getByText('sql navbar')).toBeInTheDocument();
    expect(screen.getByText('sql tab page')).toBeInTheDocument();
  });

  it('loads the saved SQLite profiles once when it mounts', () => {
    renderWithProviders(<SqlWorkspace />);
    expect(callIPC).toHaveBeenCalledTimes(1);
    expect(callIPC).toHaveBeenCalledWith(GetAllDbProfile, [], expect.anything());
  });
});
