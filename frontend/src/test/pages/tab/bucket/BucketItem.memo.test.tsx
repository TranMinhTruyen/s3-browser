import { Bucket } from '@wails/S3Browser/models/bucket';
import { describe, expect, it, vi } from 'vitest';
import BucketItem from '@/pages/tab/bucket/BucketItem';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// BucketItem calls dayjs once per render: counting the calls counts the renders.
const dayjsCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('dayjs', async importOriginal => {
  const real = (await importOriginal<{ default: typeof import('dayjs') }>()).default;
  const counted = Object.assign((...args: Parameters<typeof real>) => (dayjsCalls.count++, real(...args)), real);
  return { default: counted };
});

const bucket = new Bucket({ name: 'my-bucket', creationDate: '2026-01-02T03:04:05' });

describe('BucketItem memo', () => {
  it('does not re-render when the parent re-renders with the same props, but does when the bucket changes', () => {
    const onOpenDetail = vi.fn();
    const ui = (item: Bucket) => <BucketItem item={item} canEdit onOpenDetail={onOpenDetail} />;
    const { rerender } = renderWithProviders(ui(bucket));
    const afterMount = dayjsCalls.count;
    expect(afterMount).toBeGreaterThan(0);

    rerender(ui(bucket));
    expect(dayjsCalls.count).toBe(afterMount);

    rerender(ui(new Bucket({ name: 'my-bucket', creationDate: '2026-01-02T03:04:05' })));
    expect(dayjsCalls.count).toBeGreaterThan(afterMount);
  });
});
