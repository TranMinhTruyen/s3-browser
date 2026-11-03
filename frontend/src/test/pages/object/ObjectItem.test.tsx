import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import ObjectItem, { OBJECT_ROW_HEIGHT, type ObjectItemLabels } from '@/pages/object/ObjectItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// Every ObjectRow renders exactly one ActionIcon, labelled per row below: counting its renders counts row renders.
const rowRenders = vi.hoisted(() => new Map<string, number>());
vi.mock('@/components/buttons/ActionIcon', async importOriginal => {
  const Original = (await importOriginal<{ default: ComponentType<Record<string, unknown>> }>()).default;
  const Counted = (props: Record<string, unknown>) => {
    const label = String(props['aria-label']);
    rowRenders.set(label, (rowRenders.get(label) ?? 0) + 1);
    return <Original {...props} />;
  };
  return { default: Counted };
});

const TAB_ID = 'tab-1';

const fileItem = new ObjectItemData({
  key: 'photos/cat.png',
  name: 'cat.png',
  size: 2048,
  lastModified: '2026-01-02T03:04:05Z',
  etag: 'abc',
});
const otherFile = new ObjectItemData({ key: 'photos/dog.png', name: 'dog.png' });
const folderItem = new ObjectItemData({ key: 'photos/', name: 'photos', isFolder: true });

const labelsOf = (item: ObjectItemData): ObjectItemLabels => ({
  moreActions: `more ${item.key}`,
  download: 'Get it',
  delete: 'Remove it',
});

const makeHandlers = () => ({
  onOpenDetail: vi.fn(),
  onToggleSelect: vi.fn(),
  onClickMenuButton: vi.fn().mockResolvedValue(undefined),
  onClickDeleteFolder: vi.fn().mockResolvedValue(undefined),
  onOpenFolder: vi.fn(),
});

const rowsOf = (items: ObjectItemData[], handlers: ReturnType<typeof makeHandlers>) => (
  <>
    {items.map(item => (
      <ObjectItem key={item.key} tabId={TAB_ID} item={item} labels={labelsOf(item)} {...handlers} />
    ))}
  </>
);

function setup(item: ObjectItemData) {
  const handlers = makeHandlers();
  renderWithProviders(rowsOf([item], handlers));
  return { user: userEvent.setup(), ...handlers };
}

const moreButton = (item: ObjectItemData) => screen.getByRole('button', { name: `more ${item.key}` });

describe('ObjectItem', () => {
  beforeEach(() => {
    rowRenders.clear();
    useTabListStore.setState({
      tabList: { [TAB_ID]: { currentView: 'objectList', prefix: '', selectionItem: {}, deletingItems: {} } },
    });
  });

  it('uses a fixed row height', () => {
    expect(OBJECT_ROW_HEIGHT).toBe(88);
  });

  it.each(['constructor', 'toString'])('does not treat the inherited key "%s" as selected or deleting', key => {
    setup(new ObjectItemData({ key, name: key }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: `more ${key}` })).toBeEnabled();
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

  it.each([true, false])('reports the checkbox change (checked after the click: %s)', async checkedAfter => {
    if (!checkedAfter) useTabListStore.getState().addSelectItem(TAB_ID, [fileItem.key]);
    const { user, onOpenDetail, onToggleSelect } = setup(fileItem);
    await user.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledExactlyOnceWith(fileItem.key, checkedAfter);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('shows the checkbox as checked when the key is selected, and follows the store', async () => {
    useTabListStore.getState().addSelectItem(TAB_ID, [fileItem.key]);
    setup(fileItem);
    expect(screen.getByRole('checkbox')).toBeChecked();
    act(() => useTabListStore.getState().removeSelectItem(TAB_ID, [fileItem.key]));
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  });

  it('does not show a selection made on another key', () => {
    useTabListStore.getState().addSelectItem(TAB_ID, [otherFile.key]);
    setup(fileItem);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  describe('more actions menu', () => {
    it('is not mounted until the "more actions" button is clicked', async () => {
      const { user } = setup(fileItem);
      expect(screen.queryByText('Remove it')).not.toBeInTheDocument();
      expect(screen.queryByText('Get it')).not.toBeInTheDocument();
      expect(moreButton(fileItem)).not.toHaveAttribute('aria-haspopup');

      await user.click(moreButton(fileItem));

      expect(await screen.findByText('Get it')).toBeInTheDocument();
      expect(screen.getByText('Get it')).toBeInTheDocument();
      expect(screen.getByText('Remove it')).toBeInTheDocument();
    });

    it('unmounts the menu again when it closes', async () => {
      const { user } = setup(fileItem);
      await user.click(moreButton(fileItem));
      await screen.findByText('Get it');

      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByText('Get it')).not.toBeInTheDocument());
      expect(moreButton(fileItem)).not.toHaveAttribute('aria-haspopup');
      await user.click(moreButton(fileItem));
      expect(await screen.findByText('Get it')).toBeInTheDocument();
    });

    it('does not steal the focus on open, and gives it back to the button on Escape', async () => {
      const { user } = setup(fileItem);
      await user.click(moreButton(fileItem));
      await screen.findByText('Get it');
      expect(document.activeElement).not.toBe(moreButton(fileItem));

      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByText('Get it')).not.toBeInTheDocument());
      await waitFor(() => expect(document.activeElement).toBe(moreButton(fileItem)));
    });

    it('gives the focus back to the button after choosing an item', async () => {
      const { user } = setup(fileItem);
      await user.click(moreButton(fileItem));
      await user.click(await screen.findByText('Get it'));

      await waitFor(() => expect(screen.queryByText('Get it')).not.toBeInTheDocument());
      await waitFor(() => expect(document.activeElement).toBe(moreButton(fileItem)));
    });

    it('does not open the detail or a folder when the menu button is clicked', async () => {
      const file = setup(fileItem);
      await file.user.click(moreButton(fileItem));
      expect(file.onOpenDetail).not.toHaveBeenCalled();
    });

    it('downloads and deletes a file through the menu', async () => {
      const { user, onClickMenuButton, onOpenDetail } = setup(fileItem);
      await user.click(moreButton(fileItem));
      await user.click(await screen.findByText('Get it'));
      expect(onClickMenuButton).toHaveBeenLastCalledWith([fileItem.key], 'download');

      await waitFor(() => expect(screen.queryByText('Get it')).not.toBeInTheDocument());
      await user.click(moreButton(fileItem));
      await user.click(await screen.findByText('Remove it'));
      expect(onClickMenuButton).toHaveBeenLastCalledWith([fileItem.key], 'delete');
      expect(onClickMenuButton).toHaveBeenCalledTimes(2);
      expect(onOpenDetail).not.toHaveBeenCalled();
    });
  });

  describe('folder row', () => {
    it('opens the folder on click and has no checkbox', async () => {
      const { user, onOpenFolder, onOpenDetail } = setup(folderItem);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      await user.click(screen.getByText('photos'));
      expect(onOpenFolder).toHaveBeenCalledExactlyOnceWith(folderItem.key);
      expect(onOpenDetail).not.toHaveBeenCalled();
    });

    it('deletes the folder through the menu', async () => {
      const { user, onClickDeleteFolder, onClickMenuButton, onOpenFolder } = setup(folderItem);
      await user.click(moreButton(folderItem));
      await user.click(await screen.findByText('Remove it'));
      expect(onClickDeleteFolder).toHaveBeenCalledExactlyOnceWith(folderItem.key, folderItem.name);
      expect(onClickMenuButton).not.toHaveBeenCalled();
      expect(onOpenFolder).not.toHaveBeenCalled();
    });

    it('offers only Delete in the folder menu', async () => {
      const { user, onOpenFolder } = setup(folderItem);
      await user.click(moreButton(folderItem));
      expect(await screen.findByText('Remove it')).toBeInTheDocument();
      expect(screen.queryByText('Get it')).not.toBeInTheDocument();
      expect(onOpenFolder).not.toHaveBeenCalled();
    });

    it('names a folder without a name "/"', () => {
      setup(new ObjectItemData({ key: 'a//', name: '', isFolder: true }));
      expect(screen.getByText('/')).toBeInTheDocument();
    });
  });

  it('does not open the detail when the checkbox area is clicked', async () => {
    const { user, onOpenDetail } = setup(fileItem);
    const section = screen.getByRole('checkbox').closest<HTMLElement>('.mantine-Card-section')!;
    await user.click(section);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  describe('deleting spinner', () => {
    it('disables the closed menu button while the key is being deleted', () => {
      useTabListStore.getState().setDeleting(TAB_ID, [fileItem.key], true);
      setup(fileItem);
      expect(moreButton(fileItem)).toBeDisabled();
    });

    it('does not mark a row whose key is not being deleted', () => {
      useTabListStore.getState().setDeleting(TAB_ID, [otherFile.key], true);
      setup(fileItem);
      expect(moreButton(fileItem)).toBeEnabled();
    });

    it('also disables the button of an open menu when the delete starts', async () => {
      const { user } = setup(fileItem);
      await user.click(moreButton(fileItem));
      await screen.findByText('Get it');

      act(() => useTabListStore.getState().setDeleting(TAB_ID, [fileItem.key], true));

      await waitFor(() => expect(moreButton(fileItem)).toBeDisabled());
    });
  });

  it('shows an unselected, idle row when the tab is not in the store', () => {
    useTabListStore.setState({ tabList: {} });
    setup(fileItem);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(moreButton(fileItem)).toBeEnabled();
  });

  describe('re-rendering (memo)', () => {
    const rendersOf = (item: ObjectItemData) => rowRenders.get(`more ${item.key}`) ?? 0;

    it('re-renders only the row whose selection changed', async () => {
      renderWithProviders(rowsOf([fileItem, otherFile], makeHandlers()));
      expect(rendersOf(fileItem)).toBe(1);
      expect(rendersOf(otherFile)).toBe(1);

      act(() => useTabListStore.getState().addSelectItem(TAB_ID, [fileItem.key]));
      await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).toBeChecked());

      expect(rendersOf(fileItem)).toBe(2);
      expect(rendersOf(otherFile)).toBe(1);

      act(() => useTabListStore.getState().removeSelectItem(TAB_ID, [fileItem.key]));
      await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked());
      expect(rendersOf(fileItem)).toBe(3);
      expect(rendersOf(otherFile)).toBe(1);
    });

    it('re-renders only the row whose deleting state changed', async () => {
      renderWithProviders(rowsOf([fileItem, otherFile], makeHandlers()));

      act(() => useTabListStore.getState().setDeleting(TAB_ID, [otherFile.key], true));
      await waitFor(() => expect(moreButton(otherFile)).toBeDisabled());

      expect(rendersOf(fileItem)).toBe(1);
      expect(rendersOf(otherFile)).toBe(2);
    });

    it('does not re-render any row when the parent renders again with the same props', () => {
      const handlers = makeHandlers();
      const labels = { [fileItem.key]: labelsOf(fileItem) };
      const ui = <ObjectItem tabId={TAB_ID} item={fileItem} labels={labels[fileItem.key]} {...handlers} />;
      const { rerender } = renderWithProviders(ui);
      expect(rendersOf(fileItem)).toBe(1);

      rerender(ui);
      rerender(<ObjectItem tabId={TAB_ID} item={fileItem} labels={labels[fileItem.key]} {...handlers} />);

      expect(rendersOf(fileItem)).toBe(1);
    });
  });
});
