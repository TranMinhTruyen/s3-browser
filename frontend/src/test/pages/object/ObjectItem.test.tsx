import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { useTabListStore } from '@/common/stores/tabListStore';
import ObjectItem from '@/pages/object/ObjectItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const TAB_ID = 'tab-1';

const fileItem = new ObjectItemData({
  key: 'photos/cat.png',
  name: 'cat.png',
  size: 2048,
  lastModified: '2026-01-02T03:04:05Z',
  etag: 'abc',
});
const folderItem = new ObjectItemData({ key: 'photos/', name: 'photos', isFolder: true });

function setup(item: ObjectItemData) {
  const handlers = {
    onOpenDetail: vi.fn(),
    onToggleSelect: vi.fn(),
    onClickMenuButton: vi.fn().mockResolvedValue(undefined),
    onClickDeleteFolder: vi.fn().mockResolvedValue(undefined),
    onOpenFolder: vi.fn(),
  };
  renderWithProviders(<ObjectItem tabId={TAB_ID} item={item} {...handlers} />);
  return { user: userEvent.setup(), ...handlers };
}

describe('ObjectItem', () => {
  beforeEach(() => {
    useTabListStore.setState({
      tabList: { [TAB_ID]: { currentView: 'objectList', prefix: '', selectionItem: [], deletingItems: [] } },
    });
  });

  it('shows only the name, without size and last modified', () => {
    setup(fileItem);
    expect(screen.getByText('cat.png')).toBeInTheDocument();
    expect(screen.queryByText(/bytes|KB/)).not.toBeInTheDocument();
    expect(screen.queryByText('Size')).not.toBeInTheDocument();
    expect(screen.queryByText('Last Modified')).not.toBeInTheDocument();
  });

  it('opens the detail when the card body is clicked', async () => {
    const { user, onOpenDetail, onToggleSelect } = setup(fileItem);
    await user.click(screen.getByText('cat.png'));
    expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith(fileItem);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('toggles selection from the checkbox without opening the detail', async () => {
    const { user, onOpenDetail, onToggleSelect } = setup(fileItem);
    await user.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledExactlyOnceWith(fileItem.key, true);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('shows the checkbox as checked when the key is selected', () => {
    useTabListStore.getState().addSelectItem(TAB_ID, [fileItem.key]);
    setup(fileItem);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('downloads and deletes through the menu', async () => {
    const { user, onClickMenuButton, onOpenDetail } = setup(fileItem);
    await user.click(screen.getByRole('button'));
    await user.click(await screen.findByText('Download'));
    expect(onClickMenuButton).toHaveBeenLastCalledWith([fileItem.key], 'download');

    await user.click(screen.getByRole('button'));
    await user.click(await screen.findByText('Delete'));
    expect(onClickMenuButton).toHaveBeenLastCalledWith([fileItem.key], 'delete');
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('opens a folder on click and has no checkbox', async () => {
    const { user, onOpenFolder, onOpenDetail } = setup(folderItem);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByText('photos'));
    expect(onOpenFolder).toHaveBeenCalledExactlyOnceWith(folderItem.key);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('deletes a folder through the menu', async () => {
    const { user, onClickDeleteFolder, onOpenFolder } = setup(folderItem);
    await user.click(screen.getByRole('button'));
    await user.click(await screen.findByText('Delete'));
    expect(onClickDeleteFolder).toHaveBeenCalledExactlyOnceWith(folderItem.key, folderItem.name);
    expect(onOpenFolder).not.toHaveBeenCalled();
  });

  it('offers only Delete in the folder menu', async () => {
    const { user } = setup(folderItem);
    await user.click(screen.getByRole('button'));
    expect(await screen.findByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it('does not open the detail when the checkbox area is clicked', async () => {
    const { user, onOpenDetail } = setup(fileItem);
    const section = screen.getByRole('checkbox').closest<HTMLElement>('.mantine-Card-section')!;
    await user.click(section);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('does not open a folder when the menu area is clicked', async () => {
    const { user, onOpenFolder } = setup(folderItem);
    await user.click(screen.getByRole('button'));
    expect(onOpenFolder).not.toHaveBeenCalled();
  });

  it('shows a loading menu button while deleting', () => {
    useTabListStore.getState().setDeleting(TAB_ID, [fileItem.key], true);
    setup(fileItem);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows an unselected, idle row when the tab is not in the store', () => {
    useTabListStore.setState({ tabList: {} });
    setup(fileItem);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('names a folder without a name "/"', () => {
    setup(new ObjectItemData({ key: 'a//', name: '', isFolder: true }));
    expect(screen.getByText('/')).toBeInTheDocument();
  });
});
