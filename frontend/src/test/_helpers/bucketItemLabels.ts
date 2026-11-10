import type { BucketItemLabels } from '@/pages/tab/bucket/BucketItem';

/** English texts of `bucket` / `page` (keyPrefix of the list), as BucketListView passes them to rows. */
export const BUCKET_ITEM_LABELS: BucketItemLabels = {
  inaccessible: 'Cannot access this bucket (no permission or it does not exist).',
  moreActions: 'More actions',
  createDate: 'Create date:',
  detail: 'Details',
  editPolicy: 'Access permission',
  delete: 'Delete',
};
