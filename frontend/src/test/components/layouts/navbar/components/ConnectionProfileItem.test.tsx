import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '@/common/stores/profileStore';
import ConnectionProfileItem from '@/components/layouts/navbar/components/ConnectionProfileItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const onConnect = vi.fn();
const onDisconnect = vi.fn();
const onEdit = vi.fn();
const onDelete = vi.fn();
const onMenuChange = vi.fn();

const baseProfile = { id: 'p1', name: 'My S3', provider: 'aws', color: '#d0ebff', isConnected: false };

function renderItem(
  profile: Partial<ConnectionProfile> = {},
  props: { connecting?: boolean; menuOpened?: boolean } = {}
) {
  return renderWithProviders(
    <ConnectionProfileItem
      profileKey="p1"
      profile={{ ...baseProfile, ...profile } as ConnectionProfile}
      connecting={props.connecting ?? false}
      menuOpened={props.menuOpened ?? false}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      onEdit={onEdit}
      onDelete={onDelete}
      onMenuChange={onMenuChange}
    />
  );
}

const card = () => screen.getByText('My S3').closest<HTMLElement>('.mantine-Card-root')!;
const section = () => card().querySelector<HTMLElement>('.mantine-Card-section')!;
const menuTexts = async () => (await screen.findAllByRole('menuitem')).map(i => i.textContent);
const menuItem = async (text: string) => (await screen.findAllByRole('menuitem')).find(i => i.textContent === text)!;

describe('ConnectionProfileItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('display', () => {
    it('shows the name and provider', () => {
      renderItem();

      expect(screen.getByText('My S3')).toBeInTheDocument();
      expect(screen.getByText('aws')).toBeInTheDocument();
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
      renderItem({ isConnected: false }, { connecting: true });

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

    it('lists connect, edit and delete for a disconnected profile', async () => {
      renderItem({}, { menuOpened: true });

      expect(await menuTexts()).toEqual(['Connect', 'Edit', 'Delete']);
    });

    it('lists disconnect and delete for a connected profile', async () => {
      renderItem({ isConnected: true }, { menuOpened: true });

      expect(await menuTexts()).toEqual(['Disconnect', 'Delete']);
    });

    it('does not render the menu items while the menu is closed', () => {
      renderItem();

      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it.each([
      ['Connect', {}, () => onConnect],
      ['Edit', {}, () => onEdit],
      ['Delete', {}, () => onDelete],
      ['Disconnect', { isConnected: true }, () => onDisconnect],
    ])('calls the %s callback with the key', async (text, profile, cb) => {
      const user = userEvent.setup();
      renderItem(profile, { menuOpened: true });

      await user.click(await menuItem(text));

      expect(cb()).toHaveBeenCalledWith('p1');
    });

    it('reports the menu opening with the key on context menu', async () => {
      renderItem();

      fireEvent.contextMenu(card());

      await waitFor(() => expect(onMenuChange).toHaveBeenCalledWith('p1', true));
    });

    it('reports the menu closing with the key on Escape', async () => {
      const user = userEvent.setup();
      renderItem({}, { menuOpened: true });
      await menuTexts();

      await user.keyboard('{Escape}');

      await waitFor(() => expect(onMenuChange).toHaveBeenCalledWith('p1', false));
    });
  });
});
