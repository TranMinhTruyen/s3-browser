import type { BucketItemLabels } from '@/pages/s3/bucket/BucketItem';

/** Nhãn tiếng Anh cho `bucket` / `page` (keyPrefix của danh sách), do BucketListView truyền vào từng hàng. */
export const BUCKET_ITEM_LABELS: BucketItemLabels = {
  inaccessible: 'Cannot access this bucket (no permission or it does not exist).',
  moreActions: 'More actions',
  createDate: 'Create date:',
  detail: 'Details',
  editPolicy: 'Access permission',
  delete: 'Delete',
};
