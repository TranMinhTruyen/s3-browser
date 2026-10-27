import { render, screen } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import App from '@/App';
import { useMasterDataStore } from '@/common/stores/masterDataStore';

vi.mock('@/components/layouts/MainLayout', () => ({
  default: () => (
    <div>
      main layout
      <Outlet />
    </div>
  ),
}));
vi.mock('@/components/layouts/tab/TabLayout', () => ({ default: () => <div>tab layout</div> }));

describe('App', () => {
  const loadAll = vi.fn();
  const reset = vi.fn();

  beforeEach(() => {
    useMasterDataStore.setState({ loadAll, reset });
  });

  it('renders the main layout with the root route page', async () => {
    render(<App />);
    expect(await screen.findByText(/main layout/)).toBeInTheDocument();
    expect(await screen.findByText('tab layout')).toBeInTheDocument();
  });

  it('loads the master data on mount and resets it on unmount', () => {
    const { unmount } = render(<App />);
    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();

    unmount();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
