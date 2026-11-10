/**
 * The bulk queue keeps going around a failing file: a file that is retrying
 * keeps its slot (it is still uploading), a file that truly fails frees its
 * slot, and the queued files behind it start.
 */
import type { ResilientUploadOptions } from '../resilient-tus';

const instances: Array<{ opts: ResilientUploadOptions; start: jest.Mock; abort: jest.Mock }> = [];

jest.mock('../resilient-tus', () => ({
  ResilientUpload: jest.fn().mockImplementation((opts) => {
    const inst = { opts, start: jest.fn(async () => undefined), abort: jest.fn(async () => undefined) };
    instances.push(inst);
    return inst;
  }),
  apiUrlFromTusEndpoint: (e: string) => e,
  requestUploadResume: jest.fn(),
  reportUploadFailure: jest.fn(async () => true),
}));
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthToken: jest.fn(async () => 'tok') }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { TusParallelManager } from '../TusParallelManager';
import { reportUploadFailure } from '../resilient-tus';

const config = (n: number) => ({
  tusEndpoint: 'https://api.test/api/videos/tus',
  tusHeaders: { Authorization: 'Bearer initiate' },
  metadata: { tusSessionId: `s${n}`, videoId: `v${n}` },
  chunkSize: 1024,
  expiresAt: '',
});

describe('TusParallelManager', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('a failed file frees its slot and the next queued file starts; the others keep uploading', async () => {
    const manager = new TusParallelManager(2);
    const errors: string[] = [];
    const reconnecting: Array<[string, boolean]> = [];
    for (let n = 1; n <= 4; n++) {
      manager.createUpload(`f${n}`, new File(['x'], `${n}.mp4`), config(n), {
        onError: (id) => errors.push(id),
        onReconnecting: (id, r) => reconnecting.push([id, r]),
      });
    }
    for (let n = 1; n <= 4; n++) await manager.start(`f${n}`);
    expect(manager.getActiveCount()).toBe(2);
    expect(manager.getQueuedCount()).toBe(2);
    expect(instances.map((i) => i.start.mock.calls.length)).toEqual([1, 1, 0, 0]);

    // f1 reconnects: still holds its slot, nothing else starts
    instances[0].opts.onReconnecting!(true);
    expect(reconnecting).toEqual([['f1', true]]);
    expect(manager.getActiveCount()).toBe(2);

    // f2 fails for good: f3 starts in its place, f1 keeps going
    instances[1].opts.onError!(new Error('gone'));
    await Promise.resolve();
    expect(errors).toEqual(['f2']);
    expect(instances[2].start).toHaveBeenCalledTimes(1);
    expect(manager.getActiveCount()).toBe(2);

    // f1 succeeds: f4 starts
    instances[0].opts.onSuccess!();
    await Promise.resolve();
    expect(instances[3].start).toHaveBeenCalledTimes(1);
  });

  it('passes the video, session and resumable upload URL through, with a fresh token per request', async () => {
    const manager = new TusParallelManager(1);
    manager.createUpload('f1', new File(['x'], 'a.mp4'), { ...config(1), uploadUrl: 'https://api.test/api/videos/tus/k.v1' }, {});
    const opts = instances[0].opts;
    expect(opts).toMatchObject({ videoId: 'v1', tusSessionId: 's1', uploadUrl: 'https://api.test/api/videos/tus/k.v1' });
    await expect(opts.getAuthorization(false)).resolves.toBe('Bearer tok');
  });

  it('a file that fails for good is reported (flagged for a re-upload) with a fresh token', async () => {
    const manager = new TusParallelManager(1);
    manager.createUpload('f1', new File(['x'], 'a.mp4'), config(1), {});
    await instances[0].opts.reportFailure!('v1', 'Upload service said the upload is gone');
    expect(reportUploadFailure).toHaveBeenCalledWith('https://api.test/api/videos/tus', 'v1', { Authorization: 'Bearer tok' }, 'Upload service said the upload is gone');
  });

  it('pausing keeps the upload resumable; cancelling removes it', async () => {
    const manager = new TusParallelManager(1);
    manager.createUpload('f1', new File(['x'], 'a.mp4'), config(1), {});
    await manager.start('f1');
    manager.pause('f1');
    expect(instances[0].abort).toHaveBeenLastCalledWith();
    expect(manager.getActiveCount()).toBe(0);
    await manager.resume('f1');
    expect(instances[0].start).toHaveBeenCalledTimes(2);
    manager.cancel('f1');
    expect(instances[0].abort).toHaveBeenLastCalledWith(true);
    expect(manager.hasUpload('f1')).toBe(false);
  });
});
