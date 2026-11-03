import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConnectionProfile, useProfileStore } from '@/common/stores/profileStore';
import ConnectionProfileItem, { CARD_HEIGHT } from '@/components/layouts/navbar/components/ConnectionProfileItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// getAuthType runs once per render of an item with a profile, so it counts the item renders.
const renders = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock('@/common/utils/authUtils', async importActual => {
  const actual = await importActual<typeof import('@/common/utils/authUtils')>();
  return {
    ...actual,
    getAuthType: (p: Parameters<typeof actual.getAuthType>[0] & { id?: string }) => {
      renders.count(p.id);
      return actual.getAuthType(p);
    },
  };
});

const onConnect = vi.fn();

const baseProfile = { id: 'p1', name: 'My S3', provider: 'aws', color: '#d0ebff', isConnected: false };

function seed(profile: Partial<ConnectionProfile> = {}, id = 'p1') {
  useProfileStore.setState({ connectionProfiles: { [id]: { ...baseProfile, id, ...profile } as ConnectionProfile } });
}

function renderItem(profile: Partial<ConnectionProfile> = {}, connecting = false) {
  seed(profile);
  return renderWithProviders(<ConnectionProfileItem profileKey="p1" connecting={connecting} onConnect={onConnect} />);
}

const card = () => screen.getByText('My S3').closest<HTMLElement>('.mantine-Card-root')!;
const section = () => card().querySelector<HTMLElement>('.mantine-Card-section')!;

describe('ConnectionProfileItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfileStore.setState({ connectionProfiles: {} });
  });

  describe('display', () => {
    it('shows the name and provider', () => {
      renderItem();

      expect(screen.getByText('My S3')).toBeInTheDocument();
      expect(screen.getByText('aws')).toBeInTheDocument();
    });

    it('renders nothing when the profile does not exist', () => {
      useProfileStore.setState({ connectionProfiles: {} });
      const { container } = renderWithProviders(
        <ConnectionProfileItem profileKey="gone" connecting={false} onConnect={onConnect} />
      );

      expect(container.querySelector('.mantine-Card-root')).not.toBeInTheDocument();
    });

    it('has a fixed height and exposes its key for the shared context menu', () => {
      renderItem();

      expect(CARD_HEIGHT).toBe(68);
      expect(card()).toHaveAttribute('data-profile-key', 'p1');
      expect(card().style.getPropertyValue('--card-height') || card().getAttribute('style')).toBeTruthy();
    });

    it('does not mount a menu of its own', () => {
      renderItem();

      fireEvent.contextMenu(card());

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('shows the authentication method badge, static for a profile saved before auth types existed', () => {
      renderItem();

      expect(screen.getByText('Access key')).toBeInTheDocument();
    });

    it('shows the label of the profile authentication method', () => {
      renderItem({ authType: 'assumeRole' });

      expect(screen.getByText('Assume role')).toBeInTheDocument();
      expect(screen.queryByText('Access key')).not.toBeInTheDocument();
    });

    it.each([
      ['light color', '#ffffff', 'var(--mantine-color-black)'],
      ['dark color', '#000000', 'var(--mantine-color-white)'],
      ['no color', undefined, 'var(--mantine-color-text)'],
    ])('uses the matching text color for %s', (_n, color, expected) => {
      renderItem({ color });

      expect(card()).toHaveStyle({ color: expected });
    });

    it('uses the profile color as background when set, the body color otherwise', () => {
      const { unmount } = renderItem({ color: '#ff0000' });
      const bg = () => card().querySelectorAll<HTMLElement>('.mantine-Card-section')[1].style.backgroundColor;
      expect(bg()).toBe('rgb(255, 0, 0)');
      unmount();

      renderItem({ color: undefined });
      expect(bg()).toBe('var(--mantine-color-body)');
    });

    it('shows a green cable when connected and a red unplug when not', () => {
      const { unmount } = renderItem({ isConnected: true });
      expect(section().style.backgroundColor).toBe('var(--mantine-color-green-light)');
      expect(section().style.color).toBe('var(--mantine-color-green-light-color)');
      expect(card().querySelector('.lucide-cable')).toBeInTheDocument();
      unmount();

      renderItem({ isConnected: false });
      expect(section().style.backgroundColor).toBe('var(--mantine-color-red-light)');
      expect(section().style.color).toBe('var(--mantine-color-red-light-color)');
      expect(card().querySelector('.lucide-unplug')).toBeInTheDocument();
    });

    it('shows a spinner instead of the status icon while connecting', () => {
      renderItem({ isConnected: false }, true);

      expect(card().querySelector('.mantine-Loader-root')).toBeInTheDocument();
      expect(card().querySelector('.lucide-unplug')).not.toBeInTheDocument();
      expect(card().querySelector('.lucide-cable')).not.toBeInTheDocument();
    });

    it('shows no spinner when not connecting', () => {
      renderItem();

      expect(card().querySelector('.mantine-Loader-root')).not.toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('connects with its key on double click', () => {
      renderItem();

      fireEvent.doubleClick(card());

      expect(onConnect).toHaveBeenCalledWith('p1');
    });
  });

  describe('reactivity', () => {
    it('reflects a change of its own profile in the store', () => {
      renderItem();

      act(() =>
        useProfileStore.getState().updateConnectionProfiles('p1', { ...baseProfile, isConnected: true } as never)
      );

      expect(card().querySelector('.lucide-cable')).toBeInTheDocument();
    });

    it('re-renders only when its own profile changes, not when another profile does', () => {
      useProfileStore.setState({
        connectionProfiles: {
          p1: { ...baseProfile, id: 'p1' } as ConnectionProfile,
          p2: { ...baseProfile, id: 'p2', name: 'Other' } as ConnectionProfile,
        },
      });
      renderWithProviders(
        <>
          <ConnectionProfileItem profileKey="p1" connecting={false} onConnect={onConnect} />
          <ConnectionProfileItem profileKey="p2" connecting={false} onConnect={onConnect} />
        </>
      );
      const rendersOf = (id: string) => renders.count.mock.calls.filter(c => c[0] === id).length;
      const before = { p1: rendersOf('p1'), p2: rendersOf('p2') };

      act(() =>
        useProfileStore
          .getState()
          .updateConnectionProfiles('p2', { ...baseProfile, id: 'p2', name: 'Other', isConnected: true } as never)
      );

      expect(rendersOf('p2')).toBeGreaterThan(before.p2);
      expect(rendersOf('p1')).toBe(before.p1);
    });
  });
});
