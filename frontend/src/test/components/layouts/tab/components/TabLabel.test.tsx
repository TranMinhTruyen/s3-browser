import { act, screen } from '@testing-library/react';
import { useProfileStore } from '@/common/stores/profileStore';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabLabel from '@/components/layouts/tab/components/TabLabel';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));
vi.mock('@wails/S3Browser/internal/handlers/profilehandler', () => ({ GetAllConnectionProfile: vi.fn() }));

const tab = (profileId?: string) => ({
  profileId,
  currentView: 'bucketList' as const,
  prefix: '',
  selectionItem: [],
  deletingItems: [],
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

  it('updates when its profile connects', () => {
    renderWithProviders(<TabLabel tabId="t2" />);
    expect(screen.getByText('New profile')).toBeInTheDocument();

    act(() => {
      useProfileStore.setState({ connectionProfiles: { off: { name: 'Staging', isConnected: true } as never } });
    });

    expect(screen.getByText('Staging')).toBeInTheDocument();
  });
});
