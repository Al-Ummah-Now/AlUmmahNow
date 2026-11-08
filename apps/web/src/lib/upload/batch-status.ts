import type { UploadQueueItem } from '@al-ummah/shared-types';

/**
 * True while any queue item still needs or holds an upload slot. When it turns
 * false the batch is over and the upload page shows its actions again.
 */
export function hasActiveUploads(items: Pick<UploadQueueItem, 'status'>[]): boolean {
  return items.some((item) => item.status === 'pending' || item.status === 'uploading' || item.status === 'paused');
}
