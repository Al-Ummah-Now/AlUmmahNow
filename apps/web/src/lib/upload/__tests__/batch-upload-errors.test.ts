/** Every way a batch file fails reaches the error callback (useBatchUpload reports it), with the step. */
import type { ResilientUploadOptions } from '../resilient-tus';

const instances: Array<{ opts: ResilientUploadOptions; start: jest.Mock }> = [];
jest.mock('../resilient-tus', () => ({
  ResilientUpload: jest.fn().mockImplementation((opts) => {
    const inst = { opts, start: jest.fn(async () => undefined), abort: jest.fn(async () => undefined) };
    instances.push(inst);
    return inst;
  }),
  apiUrlFromTusEndpoint: (e: string) => e,
  requestUploadResume: jest.fn(),
}));
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthToken: jest.fn(async () => 'tok') }));
const logError = jest.fn();
jest.mock('@/lib/logger-client', () => ({ logger: { error: (...a: unknown[]) => logError(...a), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { BatchUploadManager } from '../BatchUploadManager';

const entry = (n: number) => ({
  file: new File([new Uint8Array(100 * n)], `${n}.mp4`, { type: 'video/mp4' }),
  videoId: `v${n}`,
  tusConfig: { tusEndpoint: 'https://api.test/api/videos/tus', tusHeaders: { Authorization: 'Bearer x' }, metadata: { tusSessionId: `s${n}`, videoId: `v${n}` }, chunkSize: 1024, expiresAt: '' },
});

describe('BatchUploadManager failures', () => {
  beforeEach(() => {
    instances.length = 0;
    logError.mockClear();
  });

  it('a TUS failure and a start failure each reach onUploadError with their step', async () => {
    const manager = new BatchUploadManager(5);
    const seen: Array<[string, string, string]> = [];
    manager.onUploadError((item, error, step) => seen.push([item.videoId ?? item.id, step, (error as Error).message]));
    await manager.addVideos([entry(1), entry(2)], {});
    instances[1].start.mockRejectedValueOnce(new Error('could not create upload'));
    await manager.startUploads();
    instances[0].opts.onError!(new Error('tus: 502 on PATCH'));
    expect(seen).toEqual(
      expect.arrayContaining([
        [expect.stringMatching(/2/), 'start', 'could not create upload'],
        [expect.stringMatching(/1/), 'tus', 'tus: 502 on PATCH'],
      ]),
    );
  });

  it('without a callback the failure is logged (and the logger reports it)', async () => {
    const manager = new BatchUploadManager(5);
    await manager.addVideos([entry(3)], {});
    await manager.startUploads();
    instances[0].opts.onError!(new Error('tus: offline'));
    expect(logError).toHaveBeenCalledWith('[BatchUploadManager] Upload tus failed', expect.objectContaining({ error: expect.any(Error) }));
  });
});
