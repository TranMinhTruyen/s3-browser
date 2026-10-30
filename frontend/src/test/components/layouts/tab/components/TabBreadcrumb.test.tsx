import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import TabBreadcrumb from '@/components/layouts/tab/components/TabBreadcrumb';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const TAB = 't1';
const setup = (prefix: string, bucket: string | undefined = 'bkt') => {
  useTabListStore.setState({
    activeTab: TAB,
    tabList: { [TAB]: { currentView: 'objectList', bucket, prefix, selectionItem: [], deletingItems: [] } as never },
  });
  const { container } = renderWithProviders(<TabBreadcrumb tabId={TAB} bucket={bucket} prefix={prefix} />);
  // Anchors without href have no link role, so the clickable crumbs are found by tag.
  const anchors = () => [...container.querySelectorAll('a')];
  const links = () => anchors().map(a => a.textContent);
  return { user: userEvent.setup(), links, anchors };
};
const prefixOf = () => useTabListStore.getState().tabList[TAB].prefix;

describe('TabBreadcrumb', () => {
  beforeEach(() => {
    useTabListStore.getState().reset();
  });

  it('shows only the bucket as plain text at the bucket root', () => {
    const { links } = setup('');
    expect(screen.getByText('bkt')).toBeInTheDocument();
    expect(links()).toEqual([]);
  });

  it('shows the bucket as a link and the last folder as plain text', () => {
    const { links } = setup('a/');
    expect(links()).toEqual(['bkt']);
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('links every folder but the last one', () => {
    const { links } = setup('a/b/c/');
    expect(links()).toEqual(['bkt', 'a', 'b']);
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it('goes to the bucket root when the bucket is clicked', async () => {
    const { user } = setup('a/b/');
    await user.click(screen.getByText('bkt'));
    expect(prefixOf()).toBe('');
  });

  it('goes to the clicked folder', async () => {
    const { user } = setup('a/b/c/');
    await user.click(screen.getByText('b'));
    expect(prefixOf()).toBe('a/b/');
  });

  it('names an empty folder "/"', async () => {
    const { user, links, anchors } = setup('a//b/');
    expect(links()).toEqual(['bkt', 'a', '/']);
    // The separators are "/" too, so the crumb is picked from the links.
    await user.click(anchors()[2]);
    expect(prefixOf()).toBe('a//');
  });

  it('goes to the bucket root when a crumb has lost its prefix attribute', async () => {
    useTabListStore.getState().changePrefix(TAB, '');
    const { user, anchors } = setup('a/b/');
    anchors()[1].removeAttribute('data-prefix');
    await user.click(anchors()[1]);
    expect(prefixOf()).toBe('');
  });
});
