import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bucket } from '@wails/S3Browser/models/bucket';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import BucketItem from '@/pages/tab/bucket/BucketItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/components/modals/confirm/ConfirmModal', () => ({ default: { show: vi.fn() } }));

const bucket = new Bucket({ name: 'my-bucket', creationDate: '2026-01-02T03:04:05' });

describe('BucketItem', () => {
  it('shows the bucket name and its formatted creation date', () => {
    renderWithProviders(<BucketItem item={bucket} />);
    expect(screen.getByText('my-bucket')).toBeInTheDocument();
    expect(screen.getByText('Create date:')).toBeInTheDocument();
    expect(screen.getByText(/02-01-2026 03:04:05/)).toBeInTheDocument();
  });

  it('reports the bucket name when clicked', async () => {
    const onSelectBucket = vi.fn();
    renderWithProviders(<BucketItem item={bucket} onSelectBucket={onSelectBucket} />);
    await userEvent.click(screen.getByText('my-bucket'));
    expect(onSelectBucket).toHaveBeenCalledExactlyOnceWith('my-bucket');
  });

  it('does nothing on click without a handler', async () => {
    renderWithProviders(<BucketItem item={bucket} />);
    await userEvent.click(screen.getByText('my-bucket'));
    expect(screen.getByText('my-bucket')).toBeInTheDocument();
  });
});

describe('BucketItem anonymous buckets', () => {
  const MESSAGE = 'Cannot access this bucket (no permission or it does not exist).';

  it('shows no warning for an accessible bucket', () => {
    renderWithProviders(<BucketItem item={bucket} />);
    expect(screen.queryByLabelText(MESSAGE)).not.toBeInTheDocument();
  });

  it('marks an inaccessible bucket with a warning icon and an explanatory tooltip', async () => {
    renderWithProviders(<BucketItem item={new Bucket({ name: 'private', inaccessible: true })} />);

    const icon = screen.getByLabelText(MESSAGE);
    expect(screen.getByText('private')).toBeInTheDocument();

    await userEvent.hover(icon);

    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  });

  it.each([
    ['the zero date of an unknown creation date', '0001-01-01T00:00:00Z'],
    ['the zero date with a positive timezone offset', '0001-01-01T00:00:00+09:00'],
  ])('hides the date row for %s', (_name, creationDate) => {
    renderWithProviders(<BucketItem item={new Bucket({ name: 'anon', creationDate })} />);

    expect(screen.getByText('anon')).toBeInTheDocument();
    expect(screen.queryByText('Create date:')).not.toBeInTheDocument();
  });

  it('still shows the date of an inaccessible bucket that has a valid one', () => {
    renderWithProviders(
      <BucketItem item={new Bucket({ name: 'old', creationDate: '2026-01-02T03:04:05', inaccessible: true })} />
    );

    expect(screen.getByText('Create date:')).toBeInTheDocument();
    expect(screen.getByText(/02-01-2026 03:04:05/)).toBeInTheDocument();
    expect(screen.getByLabelText(MESSAGE)).toBeInTheDocument();
  });
});

describe('BucketItem inaccessible click', () => {
  beforeEach(() => {
    vi.mocked(ConfirmModal.show).mockClear();
  });

  it.each([
    ['opens', true, 1],
    ['does not open', false, 0],
  ])('%s an inaccessible bucket when the confirmation resolves %s', async (_name, confirmed, calls) => {
    vi.mocked(ConfirmModal.show).mockResolvedValue(confirmed);
    const onSelectBucket = vi.fn();
    renderWithProviders(
      <BucketItem item={new Bucket({ name: 'private', inaccessible: true })} onSelectBucket={onSelectBucket} />
    );

    await userEvent.click(screen.getByText('private'));

    expect(ConfirmModal.show).toHaveBeenCalledExactlyOnceWith({
      type: 'warning',
      confirmCode: 'C000007',
      params: { bucket: 'private' },
    });
    await waitFor(() => expect(ConfirmModal.show).toHaveBeenCalled());
    await act(async () => {});
    if (calls) expect(onSelectBucket).toHaveBeenCalledExactlyOnceWith('private');
    else expect(onSelectBucket).not.toHaveBeenCalled();
  });

  it('does nothing after confirming an inaccessible bucket without a handler', async () => {
    vi.mocked(ConfirmModal.show).mockResolvedValue(true);
    renderWithProviders(<BucketItem item={new Bucket({ name: 'private', inaccessible: true })} />);
    await userEvent.click(screen.getByText('private'));
    await waitFor(() => expect(ConfirmModal.show).toHaveBeenCalledTimes(1));
  });

  it('opens an accessible bucket without showing the modal', async () => {
    const onSelectBucket = vi.fn();
    renderWithProviders(<BucketItem item={bucket} onSelectBucket={onSelectBucket} />);

    await userEvent.click(screen.getByText('my-bucket'));

    expect(onSelectBucket).toHaveBeenCalledExactlyOnceWith('my-bucket');
    expect(ConfirmModal.show).not.toHaveBeenCalled();
  });
});

describe('BucketItem menu', () => {
  // jsdom has no layout, so Mantine marks the dropdown as clipped (display: none): query it with hidden: true.
  const moreActions = () => screen.getByRole('button', { name: 'More actions' });

  it('does not mount the menu until the button is clicked', () => {
    renderWithProviders(<BucketItem item={bucket} canEdit />);

    expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { hidden: true, name: 'Details' })).not.toBeInTheDocument();
  });

  it('opens the menu from the button without selecting the bucket', async () => {
    const onSelectBucket = vi.fn();
    renderWithProviders(<BucketItem item={bucket} canEdit onSelectBucket={onSelectBucket} />);

    await userEvent.click(moreActions());

    expect((await screen.findAllByRole('menuitem', { hidden: true })).map(i => i.textContent)).toEqual([
      'Details',
      'Access permission',
      'Delete',
    ]);
    expect(onSelectBucket).not.toHaveBeenCalled();
  });

  it('deletes the bucket by name from "Delete" and closes the menu', async () => {
    const onDeleteBucket = vi.fn();
    renderWithProviders(<BucketItem item={bucket} canEdit onDeleteBucket={onDeleteBucket} />);

    await userEvent.click(moreActions());
    await userEvent.click(await screen.findByRole('menuitem', { hidden: true, name: 'Delete' }));

    expect(onDeleteBucket).toHaveBeenCalledExactlyOnceWith('my-bucket');
    await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument());
  });

  it('hides "Delete" when the account may not delete the bucket', async () => {
    renderWithProviders(<BucketItem item={{ ...bucket, deleteDenied: true } as never} canEdit />);

    await userEvent.click(moreActions());

    expect((await screen.findAllByRole('menuitem', { hidden: true })).map(i => i.textContent)).toEqual([
      'Details',
      'Access permission',
    ]);
  });

  it('opens the detail of the bucket from "Details" and closes the menu', async () => {
    const onOpenDetail = vi.fn();
    renderWithProviders(<BucketItem item={bucket} canEdit onOpenDetail={onOpenDetail} />);

    await userEvent.click(moreActions());
    await userEvent.click(await screen.findByRole('menuitem', { hidden: true, name: 'Details' }));

    expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith(bucket);
    await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument());
  });

  it('edits the policy of the bucket by name from "Access permission" and closes the menu', async () => {
    const onEditPolicy = vi.fn();
    renderWithProviders(<BucketItem item={bucket} canEdit onEditPolicy={onEditPolicy} />);

    await userEvent.click(moreActions());
    await userEvent.click(await screen.findByRole('menuitem', { hidden: true, name: 'Access permission' }));

    expect(onEditPolicy).toHaveBeenCalledExactlyOnceWith('my-bucket');
    await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument());
  });

  it('does nothing when an item is chosen without a handler', async () => {
    renderWithProviders(<BucketItem item={bucket} canEdit />);

    await userEvent.click(moreActions());
    await userEvent.click(await screen.findByRole('menuitem', { hidden: true, name: 'Details' }));
    await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument());
    await userEvent.click(moreActions());
    await userEvent.click(await screen.findByRole('menuitem', { hidden: true, name: 'Access permission' }));
    await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument());
    await userEvent.click(moreActions());
    await userEvent.click(await screen.findByRole('menuitem', { hidden: true, name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument());
  });

  it('gives the focus back to the button when the menu closes', async () => {
    renderWithProviders(<BucketItem item={bucket} canEdit />);

    await userEvent.click(moreActions());
    await screen.findByRole('menu', { hidden: true });
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument());
    await waitFor(() => expect(moreActions()).toHaveFocus());
  });

  it('only has "Details" without edit permission (anonymous connection)', async () => {
    renderWithProviders(<BucketItem item={bucket} />);

    await userEvent.click(moreActions());

    expect(await screen.findByRole('menuitem', { hidden: true, name: 'Details' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { hidden: true, name: 'Access permission' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { hidden: true, name: 'Delete' })).not.toBeInTheDocument();
  });
});
