/**
 * A new batch selection against a queue that already holds rows: finished
 * rows never block or count, already-uploaded files are not uploaded again.
 */
import type { UploadStatus } from '@al-ummah/shared-types';
import { MAX_BATCH_FILES, planBatchSelection, remainingSlots, unfinishedCount } from '../batch-selection';

const file = (name: string, size = 10, lastModified = 1) => new File(['x'.repeat(size)], name, { lastModified });
const row = (id: string, f: File, status: UploadStatus) => ({ id, file: f, status });

describe('planBatchSelection', () => {
  it('adds every file to an empty queue', () => {
    const picked = [file('a.mp4'), file('b.mp4')];
    expect(planBatchSelection(picked, [])).toEqual({ toAdd: picked, alreadyUploadedRowIds: [], alreadyQueued: [] });
  });

  it('marks files already uploaded in this page instead of adding them again', () => {
    const a = file('a.mp4');
    const plan = planBatchSelection([file('a.mp4'), file('c.mp4')], [row('r1', a, 'completed')]);
    expect(plan.alreadyUploadedRowIds).toEqual(['r1']);
    expect(plan.toAdd.map((f) => f.name)).toEqual(['c.mp4']);
  });

  it('re-picking only uploaded files adds nothing (an empty list, not an error)', () => {
    const a = file('a.mp4');
    const b = file('b.mp4');
    const plan = planBatchSelection([a, b], [row('r1', a, 'completed'), row('r2', b, 'completed')]);
    expect(plan.toAdd).toEqual([]);
    expect(plan.alreadyUploadedRowIds).toEqual(['r1', 'r2']);
  });

  it('skips files already waiting or uploading, re-adds cancelled ones, and drops duplicates in one pick', () => {
    const a = file('a.mp4');
    const b = file('b.mp4');
    const plan = planBatchSelection([a, b, file('b.mp4'), file('a.mp4')], [row('r1', a, 'uploading'), row('r2', b, 'cancelled')]);
    expect(plan.alreadyQueued.map((f) => f.name)).toEqual(['a.mp4', 'a.mp4']);
    expect(plan.toAdd.map((f) => f.name)).toEqual(['b.mp4']);
  });

  it('a different file with the same name is a new file', () => {
    const plan = planBatchSelection([file('a.mp4', 20)], [row('r1', file('a.mp4', 10), 'completed')]);
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.alreadyUploadedRowIds).toEqual([]);
  });
});

describe('the 15-file limit', () => {
  it('finished rows do not count towards it', () => {
    const queue = [
      ...Array.from({ length: 10 }, (_, i) => row(`c${i}`, file(`c${i}.mp4`), 'completed' as const)),
      ...Array.from({ length: 5 }, (_, i) => row(`x${i}`, file(`x${i}.mp4`), 'cancelled' as const)),
    ];
    expect(unfinishedCount(queue)).toBe(0);
    expect(remainingSlots(queue)).toBe(MAX_BATCH_FILES);
  });

  it('unfinished rows (pending, uploading, paused, failed) do', () => {
    const statuses: UploadStatus[] = ['pending', 'uploading', 'paused', 'failed', 'completed'];
    const queue = statuses.map((s, i) => row(`r${i}`, file(`${i}.mp4`), s));
    expect(remainingSlots(queue)).toBe(MAX_BATCH_FILES - 4);
    const full = Array.from({ length: 16 }, (_, i) => row(`p${i}`, file(`${i}.mp4`), 'pending' as const));
    expect(remainingSlots(full)).toBe(0);
  });
});
