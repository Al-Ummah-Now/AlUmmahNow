/**
 * BatchUploadManager across batches: after a batch finishes the same manager
 * takes more files and uploads only those, an empty add is a no-op, files
 * picked again are shown as already uploaded, and "Clear finished" removes
 * only finished rows.
 */
import type { TusCallbacks } from '@al-ummah/shared-types';

const tus = {
  created: new Map<string, TusCallbacks>(),
  started: [] as string[],
  cancelled: [] as string[],
};

jest.mock('../TusParallelManager', () => ({
  TusParallelManager: jest.fn().mockImplementation(() => ({
    setConcurrencyLimit: jest.fn(),
    createUpload: jest.fn((id: string, _file: File, _config: unknown, callbacks: TusCallbacks) => {
      tus.created.set(id, callbacks);
    }),
    start: jest.fn(async (id: string) => {
      tus.started.push(id);
    }),
    pause: jest.fn(),
    resume: jest.fn(),
    cancel: jest.fn((id: string) => tus.cancelled.push(id)),
    clearAll: jest.fn(),
  })),
}));
jest.mock('../UploadOptimizer', () => ({
  UploadOptimizer: jest.fn().mockImplementation(() => ({ getOptimalConcurrency: () => 3, updateBandwidth: jest.fn() })),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { BatchUploadManager, type BatchUploadEntry } from '../BatchUploadManager';
import { logger } from '@/lib/logger-client';

const entry = (n: number): BatchUploadEntry => ({
  file: new File(['x'], `${n}.mp4`, { type: 'video/mp4' }),
  videoId: `v${n}`,
  tusConfig: { tusEndpoint: 'https://api.test/api/videos/tus', tusHeaders: {}, metadata: { videoId: `v${n}`, tusSessionId: `s${n}` }, chunkSize: 1, expiresAt: '' },
});

const rows = (m: BatchUploadManager) => Array.from(m.getQueueState().values());
const finishAll = (m: BatchUploadManager) => {
  for (const item of rows(m)) if (item.status === 'uploading') tus.created.get(item.id)!.onSuccess?.(item.id);
};

describe('BatchUploadManager', () => {
  beforeEach(() => {
    tus.created.clear();
    tus.started.length = 0;
    tus.cancelled.length = 0;
    jest.clearAllMocks();
  });

  it('takes more files after a batch finished and uploads only the new ones', async () => {
    const m = new BatchUploadManager();
    const succeeded: string[] = [];
    m.onUploadSuccess((item) => succeeded.push(item.videoId!));

    await m.addVideos([entry(1), entry(2)], {});
    await m.startUploads();
    finishAll(m);
    expect(rows(m).map((r) => r.status)).toEqual(['completed', 'completed']);

    await m.addVideos([entry(3), entry(4)], {});
    expect(rows(m).map((r) => r.status)).toEqual(['completed', 'completed', 'pending', 'pending']);

    tus.started.length = 0;
    await m.startUploads();
    expect(tus.started).toHaveLength(2);
    expect(tus.started.every((id) => ['v3', 'v4'].includes(m.getQueueState().get(id)!.videoId!))).toBe(true);
    finishAll(m);
    expect(rows(m).every((r) => r.status === 'completed')).toBe(true);
    expect(succeeded).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(m.getProgress()).toMatchObject({ total: 4, completed: 4, pending: 0, uploading: 0 });
  });

  it('an empty add does nothing and does not throw', async () => {
    const m = new BatchUploadManager();
    const progress = jest.fn();
    m.onProgressUpdate(progress);
    await expect(m.addVideos([], {})).resolves.toBeUndefined();
    expect(rows(m)).toEqual([]);
    expect(progress).not.toHaveBeenCalled();
  });

  it('shows a re-picked file as already uploaded, on its row or as a new finished row', async () => {
    const m = new BatchUploadManager();
    await m.addVideos([entry(1)], {});
    await m.startUploads();
    finishAll(m);
    const [first] = rows(m);
    m.markAlreadyUploaded(first.id);
    expect(m.getQueueState().get(first.id)).toMatchObject({ status: 'completed', alreadyUploaded: true, videoId: 'v1' });

    const file = new File(['y'], 'old.mp4');
    const id = m.addAlreadyUploaded(file, 'v-old', {});
    expect(m.getQueueState().get(id)).toMatchObject({ status: 'completed', alreadyUploaded: true, videoId: 'v-old', progress: 100 });
    // Nothing is uploaded for it
    expect(tus.created.has(id)).toBe(false);
    tus.started.length = 0;
    await m.startUploads();
    expect(tus.started).toEqual([]);
  });

  it('"Clear finished" removes completed and cancelled rows only', async () => {
    const m = new BatchUploadManager();
    await m.addVideos([entry(1), entry(2), entry(3), entry(4)], {});
    const [a, b, c] = rows(m);
    await m.startUploads();
    tus.created.get(a.id)!.onSuccess?.(a.id);
    await m.cancelUpload(b.id);
    tus.created.get(c.id)!.onError?.(c.id, new Error('tus: response code: 500, response text: {"error":"raw"}'));

    m.clearFinished();
    expect(rows(m).map((r) => r.status)).toEqual(['failed', 'uploading']);
    // The raw tus text is reported for the logs
    expect(logger.error).toHaveBeenCalledWith('[BatchUploadManager] Upload tus failed', expect.objectContaining({ error: expect.any(Error) }));
  });
});
