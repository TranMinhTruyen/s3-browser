import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bucket } from '@wails/S3Browser/models/bucket';
import BucketItem from '@/pages/bucket/BucketItem';
import { renderWithProviders } from '@/test/renderWithProviders';

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
