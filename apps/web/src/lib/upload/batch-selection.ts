import type { UploadQueueItem } from '@al-ummah/shared-types';

/** Most files one selection, and the unfinished queue, may hold (api-videos batch initiate takes 1-15). */
export const MAX_BATCH_FILES = 15;

type FileIdentity = Pick<File, 'name' | 'size' | 'lastModified'>;
type QueueRow = Pick<UploadQueueItem, 'id' | 'file' | 'status'>;

/** Completed and cancelled rows are history: they stay visible but hold no slot. */
export function isFinishedRow(row: Pick<UploadQueueItem, 'status'>): boolean {
  return row.status === 'completed' || row.status === 'cancelled';
}

export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

export interface BatchSelectionPlan {
  /** Files that need a new (or resumed) upload. */
  toAdd: File[];
  /** Queue rows (completed) whose file was picked again: shown as "already uploaded". */
  alreadyUploadedRowIds: string[];
  /** Files already waiting or uploading in the queue: nothing to do. */
  alreadyQueued: File[];
}

/**
 * Splits a new selection against the queue. A file that is already uploaded
 * in this page is never uploaded twice (no duplicate video); a file already
 * queued is not queued twice; a cancelled one can be picked again.
 */
export function planBatchSelection(selected: File[], queue: QueueRow[]): BatchSelectionPlan {
  const plan: BatchSelectionPlan = { toAdd: [], alreadyUploadedRowIds: [], alreadyQueued: [] };
  for (const file of selected) {
    if (plan.toAdd.some((f) => sameFile(f, file))) continue;
    const rows = queue.filter((row) => sameFile(row.file, file));
    const completed = rows.find((row) => row.status === 'completed');
    if (completed) {
      if (!plan.alreadyUploadedRowIds.includes(completed.id)) plan.alreadyUploadedRowIds.push(completed.id);
      continue;
    }
    if (rows.some((row) => !isFinishedRow(row))) {
      plan.alreadyQueued.push(file);
      continue;
    }
    plan.toAdd.push(file);
  }
  return plan;
}

/** Unfinished rows (pending, uploading, paused, failed) count towards the limit; finished ones never do. */
export function unfinishedCount(queue: Pick<UploadQueueItem, 'status'>[]): number {
  return queue.filter((row) => !isFinishedRow(row)).length;
}

/** How many more files fit, or 0. */
export function remainingSlots(queue: Pick<UploadQueueItem, 'status'>[]): number {
  return Math.max(0, MAX_BATCH_FILES - unfinishedCount(queue));
}
