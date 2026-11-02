import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bucket } from '@wails/S3Browser/models/bucket';
import BucketItem from '@/pages/bucket/BucketItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

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
  const MESSAGE = 'This bucket cannot be accessed anonymously.';

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
