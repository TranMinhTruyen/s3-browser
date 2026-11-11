import { act, screen } from '@testing-library/react';
import TabLabel from '@/pages/s3/components/TabLabel';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ GetAllConnectionProfile: vi.fn() }));

const tab = (profileId?: string) => ({
  profileId,
  currentView: 'bucketList' as const,
  prefix: '',
  selectionItem: {},
  deletingItems: {},
});

describe('TabLabel', () => {
  beforeEach(() => {
    useProfileStore.setState({
      connectionProfiles: {
        on: { name: 'Prod', isConnected: true } as never,
        off: { name: 'Staging', isConnected: false } as never,
      },
    });
    useTabListStore.setState({
      tabList: { t1: tab('on'), t2: tab('off'), t3: tab(), t4: tab('gone') },
    });
  });

  it('shows the profile name when the profile is connected', () => {
    renderWithProviders(<TabLabel tabId="t1" />);
    expect(screen.getByText('Prod')).toBeInTheDocument();
  });

  it('falls back to the default name when the profile is not connected', () => {
    renderWithProviders(<TabLabel tabId="t2" />);
    expect(screen.getByText('New profile')).toBeInTheDocument();
  });

  it('falls back to the default name when the tab has no profile', () => {
    renderWithProviders(<TabLabel tabId="t3" />);
    expect(screen.getByText('New profile')).toBeInTheDocument();
  });

  it('falls back to the default name when the profile is unknown', () => {
    renderWithProviders(<TabLabel tabId="t4" />);
    expect(screen.getByText('New profile')).toBeInTheDocument();
  });

  it('falls back to the default name when the tab is unknown', () => {
    renderWithProviders(<TabLabel tabId="missing" />);
    expect(screen.getByText('New profile')).toBeInTheDocument();
  });

  const dotColor = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('.mantine-ColorSwatch-colorOverlay')?.style.backgroundColor;

  it('shows a green status dot when the profile is connected', () => {
    const { container } = renderWithProviders(<TabLabel tabId="t1" />);
    expect(dotColor(container)).toBe('var(--mantine-color-green-6)');
  });

  it('shows a red status dot when the profile is not connected', () => {
    const { container } = renderWithProviders(<TabLabel tabId="t2" />);
    expect(dotColor(container)).toBe('var(--mantine-color-red-6)');
  });

  it.each(['t3', 't4', 'missing'])('shows no status dot when the tab %s has no known profile', id => {
    const { container } = renderWithProviders(<TabLabel tabId={id} />);
    expect(container.querySelector('.mantine-ColorSwatch-root')).not.toBeInTheDocument();
  });

  it('updates when its profile connects', () => {
    renderWithProviders(<TabLabel tabId="t2" />);
    expect(screen.getByText('New profile')).toBeInTheDocument();

    act(() => {
      useProfileStore.setState({ connectionProfiles: { off: { name: 'Staging', isConnected: true } as never } });
    });

    expect(screen.getByText('Staging')).toBeInTheDocument();
  });
});
