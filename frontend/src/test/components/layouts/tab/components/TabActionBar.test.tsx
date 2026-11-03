import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabActionBar from '@/components/layouts/tab/components/TabActionBar';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const TAB = 't1';
const menu = vi.fn();

const handlers = () => ({
  onChangeSelectProfile: vi.fn(),
  onClickConnect: vi.fn(),
  onClickRefresh: vi.fn(),
  onSearch: vi.fn(),
  onClearSearch: vi.fn(),
  onClickUpload: vi.fn(),
  onClickBack: vi.fn(),
});

type Props = Partial<React.ComponentProps<typeof TabActionBar>>;

const setTab = (patch: Record<string, unknown> = {}) =>
  useTabListStore.setState({
    activeTab: TAB,
    tabList: {
      [TAB]: { currentView: 'objectList', prefix: '', selectionItem: {}, deletingItems: {}, ...patch } as never,
    },
  });

function setup(props: Props = {}) {
  const h = handlers();
  renderWithProviders(
    <TabActionBar
      tabId={TAB}
      currentView="objectList"
      isConnected
      selectedProfileId="p1"
      profileOptions={[{ name: 'Prof', value: 'p1' }]}
      prefix=""
      keyword=""
      searchContext="ctx"
      objectListRef={{ current: { onClickMenuButton: menu } as never }}
      {...h}
      {...props}
    />
  );
  return { h, user: userEvent.setup() };
}
const btn = (name: string) => screen.getByRole('button', { name });
const queryBtn = (name: string) => screen.queryByRole('button', { name });

describe('TabActionBar', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
    setTab();
    menu.mockResolvedValue(undefined);
  });

  it('calls back for connect, refresh, upload and back', async () => {
    const { h, user } = setup();
    await user.click(btn('Upload files'));
    await user.click(btn('Refresh object list'));
    await user.click(btn('Back to bucket'));
    expect(h.onClickUpload).toHaveBeenCalledTimes(1);
    expect(h.onClickRefresh).toHaveBeenCalledTimes(1);
    expect(h.onClickBack).toHaveBeenCalledTimes(1);
    expect(h.onClickConnect).not.toHaveBeenCalled();
  });

  it('connects when disconnected with a profile selected', async () => {
    const { h, user } = setup({ isConnected: false });
    await user.click(btn('Connect'));
    expect(h.onClickConnect).toHaveBeenCalledTimes(1);
  });

  it('disables connect once connected and without a profile', () => {
    setup({ isConnected: true });
    expect(btn('Connect')).toBeDisabled();
  });

  it('disables connect without a profile', () => {
    setup({ isConnected: false, selectedProfileId: null });
    expect(btn('Connect')).toBeDisabled();
  });

  it('disables refresh, search and upload while disconnected', () => {
    setup({ isConnected: false });
    expect(btn('Refresh object list')).toBeDisabled();
    expect(btn('Upload files')).toBeDisabled();
    expect(screen.getByRole('searchbox')).toBeDisabled();
  });

  it('labels refresh and the search placeholder for the bucket list', () => {
    setup({ currentView: 'bucketList' });
    expect(btn('Refresh bucket list')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name')).toBeInTheDocument();
  });

  it('labels the search placeholder for the object list', () => {
    setup();
    expect(screen.getByPlaceholderText('Search by key')).toBeInTheDocument();
  });

  it('shows neither back nor selection actions in the bucket list', () => {
    setTab({ selectionItem: { a: true } });
    setup({ currentView: 'bucketList' });
    expect(queryBtn('Back to bucket')).not.toBeInTheDocument();
    expect(queryBtn('Clear selected')).not.toBeInTheDocument();
  });

  it('goes back to the parent folder inside a folder', () => {
    setup({ prefix: 'a/' });
    expect(btn('Back to parent folder')).toBeInTheDocument();
    expect(queryBtn('Back to bucket')).not.toBeInTheDocument();
  });

  it('reports the profile chosen in the picker', async () => {
    const { h, user } = setup();
    await user.click(screen.getAllByRole('button').find(b => b.getAttribute('aria-haspopup') === 'listbox')!);
    await user.click(await screen.findByRole('option', { name: 'Prof', hidden: true }));
    expect(h.onChangeSelectProfile).toHaveBeenCalledWith('p1');
  });

  it('lets the profile picker be searched and shows an empty message when nothing matches', async () => {
    const { user } = setup();
    await user.click(screen.getAllByRole('button').find(b => b.getAttribute('aria-haspopup') === 'listbox')!);
    fireEvent.change(await screen.findByPlaceholderText('Search profile'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('option', { name: 'Prof', hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText('No profiles found')).toBeInTheDocument();
  });

  it('reports a submitted keyword and clears the search', async () => {
    const { h, user } = setup({ keyword: 'abc' });
    const input = screen.getByRole('searchbox');
    expect(input).toHaveValue('abc');
    await user.clear(input);
    await user.type(input, 'xyz{Enter}');
    expect(h.onSearch).toHaveBeenCalledWith('xyz');
    await user.click(btn('Clear search'));
    expect(h.onClearSearch).toHaveBeenCalled();
  });

  describe('selection actions', () => {
    it('are hidden without a selection', () => {
      setup();
      expect(queryBtn('Clear selected')).not.toBeInTheDocument();
      expect(queryBtn('Download selected')).not.toBeInTheDocument();
      expect(queryBtn('Delete selected')).not.toBeInTheDocument();
    });

    it('are hidden when the tab is not in the store', () => {
      useTabListStore.setState({ tabList: {} });
      setup();
      expect(queryBtn('Delete selected')).not.toBeInTheDocument();
    });

    it('clear the selection', async () => {
      setTab({ selectionItem: { a: true, b: true } });
      const { user } = setup();
      await user.click(btn('Clear selected'));
      expect(useTabListStore.getState().tabList[TAB].selectionItem).toEqual({});
    });

    it.each([
      ['Download selected', 'download'],
      ['Delete selected', 'delete'],
    ])('"%s" runs the %s menu action on the selected keys', async (name, action) => {
      setTab({ selectionItem: { a: true, b: true } });
      const { user } = setup();
      await user.click(btn(name));
      expect(menu).toHaveBeenCalledExactlyOnceWith(['a', 'b'], action);
    });

    it('do not fail when the object list is not mounted', async () => {
      setTab({ selectionItem: { a: true } });
      const { user } = setup({ objectListRef: { current: null } });
      await user.click(btn('Download selected'));
      await user.click(btn('Delete selected'));
      expect(menu).not.toHaveBeenCalled();
    });

    it('disable clear and download but not delete while a selected item is being deleted', () => {
      setTab({ selectionItem: { a: true, b: true }, deletingItems: { b: true } });
      setup();
      expect(btn('Clear selected')).toBeDisabled();
      expect(btn('Download selected')).toBeDisabled();
      expect(btn('Delete selected')).toBeEnabled();
    });

    it.each(['constructor', 'toString'])('stay enabled for the selected inherited key "%s"', key => {
      setTab({ selectionItem: { [key]: true }, deletingItems: {} });
      setup();
      expect(btn('Clear selected')).toBeEnabled();
      expect(btn('Download selected')).toBeEnabled();
    });

    it('stay enabled when only other items are being deleted', () => {
      setTab({ selectionItem: { a: true }, deletingItems: { z: true } });
      setup();
      expect(btn('Clear selected')).toBeEnabled();
    });
  });
});
