/**
 * useBatchUpload across batches (production 2026-11-10: "added videos,
 * uploaded, tried to add again, error"):
 * - after a batch finishes, more files can be added and uploaded, any number of times;
 * - re-picking uploaded files shows "already uploaded" (no new video, no error),
 *   in the same page and after a reload;
 * - finished rows never count towards the 15-file limit;
 * - the user never sees a raw error; a version-skew error goes to the
 *   version-skew recovery instead of the banner.
 */
import { renderHook, act } from '@testing-library/react';
import type { TusCallbacks } from '@al-ummah/shared-types';
import { EN_TRANSLATIONS } from '@al-ummah/shared-types';

const tus = { created: new Map<string, TusCallbacks>() };

jest.mock('@/lib/upload/TusParallelManager', () => ({
  TusParallelManager: jest.fn().mockImplementation(() => ({
    setConcurrencyLimit: jest.fn(),
    createUpload: jest.fn((id: string, _f: File, _c: unknown, callbacks: TusCallbacks) => tus.created.set(id, callbacks)),
    start: jest.fn(async () => undefined),
    pause: jest.fn(),
    resume: jest.fn(),
    cancel: jest.fn(),
    clearAll: jest.fn(),
  })),
}));
jest.mock('@/lib/upload/UploadOptimizer', () => ({
  UploadOptimizer: jest.fn().mockImplementation(() => ({
    getOptimalConcurrency: () => 3,
    getOptimalChunkSize: () => 1024,
    canHandleBatchUpload: () => true,
    getRecommendedBatchSize: () => 15,
    updateBandwidth: jest.fn(),
  })),
}));
jest.mock('@/lib/api/upload-client', () => ({ initiateBatchUpload: jest.fn(), completeVideoUpload: jest.fn() }));
jest.mock('@/lib/upload/resilient-tus', () => ({ requestUploadResume: jest.fn() }));
jest.mock('@/lib/auth/client-token', () => ({ getClientAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer t' })) }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/version-skew/VersionSkewProvider', () => ({ useHoldReloadWhile: jest.fn() }));
jest.mock('@/lib/version-skew/recovery', () => ({
  holdReload: () => () => undefined,
  recoverFromVersionSkew: jest.fn((error: unknown) => /Server Action .* was not found/.test(String((error as Error)?.message))),
}));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: EN_TRANSLATIONS, lang: 'en' }) }));

import { useBatchUpload } from '../useBatchUpload';
import { initiateBatchUpload, completeVideoUpload } from '@/lib/api/upload-client';
import { requestUploadResume } from '@/lib/upload/resilient-tus';
import { recoverFromVersionSkew } from '@/lib/version-skew/recovery';
import { logger } from '@/lib/logger-client';

const initiate = initiateBatchUpload as jest.Mock;
const complete = completeVideoUpload as jest.Mock;
const resume = requestUploadResume as jest.Mock;

let videoN = 0;
initiate.mockImplementation(async (videos: unknown[]) => ({
  success: true,
  result: videos.map(() => {
    videoN++;
    return { videoId: `v${videoN}`, tusSessionId: `s${videoN}`, expiresAt: '', chunkSize: 1024, resumable: true };
  }),
}));

const mp4 = (name: string) => new File(['x'], name, { type: 'video/mp4', lastModified: 1 });

function setup() {
  const onError = jest.fn();
  const hook = renderHook(() => useBatchUpload({ channelId: 'ch1', onError }));
  return { onError, hook };
}

async function uploadAll(hook: ReturnType<typeof setup>['hook']) {
  await act(async () => {
    await hook.result.current.startUpload();
  });
  await act(async () => {
    for (const item of hook.result.current.files) {
      if (item.status === 'uploading') tus.created.get(item.id)!.onSuccess?.(item.id);
    }
  });
}

const statuses = (hook: ReturnType<typeof setup>['hook']) => hook.result.current.files.map((f) => f.status);

describe('useBatchUpload', () => {
  beforeEach(() => {
    window.localStorage.clear();
    tus.created.clear();
    initiate.mockClear();
    complete.mockReset().mockResolvedValue({ success: true });
    resume.mockReset();
    (logger.error as jest.Mock).mockClear();
  });

  it('adds and uploads more files after a batch finished, again and again', async () => {
    const { hook, onError } = setup();
    for (let round = 0; round < 3; round++) {
      await act(async () => {
        await hook.result.current.addFiles([mp4(`r${round}-a.mp4`), mp4(`r${round}-b.mp4`)]);
      });
      expect(statuses(hook).filter((s) => s === 'pending')).toHaveLength(2);
      await uploadAll(hook);
      expect(hook.result.current.isUploading).toBe(false);
      expect(statuses(hook).every((s) => s === 'completed')).toBe(true);
    }
    expect(hook.result.current.files).toHaveLength(6);
    expect(initiate).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledTimes(6);
    expect(onError).not.toHaveBeenCalled();
  });

  it('re-picking the uploaded files marks them already uploaded: no new video, no error', async () => {
    const { hook, onError } = setup();
    const files = [mp4('a.mp4'), mp4('b.mp4')];
    await act(async () => {
      await hook.result.current.addFiles(files);
    });
    await uploadAll(hook);
    initiate.mockClear();

    await act(async () => {
      await hook.result.current.addFiles([mp4('a.mp4'), mp4('b.mp4')]);
    });
    expect(initiate).not.toHaveBeenCalled();
    expect(hook.result.current.files).toHaveLength(2);
    expect(hook.result.current.files.every((f) => f.status === 'completed' && f.alreadyUploaded)).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('after a reload, a file uploaded before gets an "already uploaded" row with its video', async () => {
    const first = setup();
    await act(async () => {
      await first.hook.result.current.addFiles([mp4('a.mp4')]);
    });
    await uploadAll(first.hook);
    const videoId = first.hook.result.current.files[0].videoId;
    first.hook.unmount();

    // A new page: the queue is empty, the remembered upload says the video is finished
    resume.mockResolvedValue({ kind: 'completed' });
    initiate.mockClear();
    const { hook, onError } = setup();
    await act(async () => {
      await hook.result.current.addFiles([mp4('a.mp4'), mp4('new.mp4')]);
    });
    expect(resume).toHaveBeenCalledWith('https://api.test', videoId, expect.anything());
    expect(initiate).toHaveBeenCalledTimes(1);
    expect(initiate.mock.calls[0][0]).toHaveLength(1);
    const rows = hook.result.current.files;
    expect(rows.find((r) => r.file.name === 'a.mp4')).toMatchObject({ status: 'completed', alreadyUploaded: true, videoId });
    expect(rows.find((r) => r.file.name === 'new.mp4')).toMatchObject({ status: 'pending' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('a pick with nothing new (all queued already) adds nothing and shows no error', async () => {
    const { hook, onError } = setup();
    await act(async () => {
      await hook.result.current.addFiles([mp4('a.mp4')]);
    });
    initiate.mockClear();
    await act(async () => {
      await hook.result.current.addFiles([mp4('a.mp4')]);
    });
    expect(initiate).not.toHaveBeenCalled();
    expect(hook.result.current.files).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('finished rows do not count towards the 15-file limit; unfinished ones do', async () => {
    const { hook, onError } = setup();
    const batch = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => mp4(`${prefix}${i}.mp4`));
    await act(async () => {
      await hook.result.current.addFiles(batch('a', 15));
    });
    await uploadAll(hook);
    await act(async () => {
      await hook.result.current.addFiles(batch('b', 15));
    });
    expect(onError).not.toHaveBeenCalled();
    expect(statuses(hook).filter((s) => s === 'pending')).toHaveLength(15);

    // 15 waiting: one more does not fit
    await act(async () => {
      await hook.result.current.addFiles(batch('c', 1));
    });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('You can add 0 more'));
    expect(hook.result.current.files).toHaveLength(30);

    // "Clear finished" keeps the waiting files
    act(() => hook.result.current.clearFinished());
    expect(statuses(hook)).toEqual(Array(15).fill('pending'));
  });

  it('a failed add shows a friendly message, never the raw API error', async () => {
    const { hook, onError } = setup();
    initiate.mockResolvedValueOnce({ success: false, error: 'TypeError: Cannot read properties of undefined (reading guid)' });
    await act(async () => {
      await hook.result.current.addFiles([mp4('a.mp4')]);
    });
    expect(onError).toHaveBeenCalledWith(EN_TRANSLATIONS.batch.errors.initiateFailed);
    expect(logger.error).toHaveBeenCalledWith('[useBatchUpload] Failed to add files', expect.anything());
    expect(hook.result.current.isInitiating).toBe(false);
  });

  it('a version-skew error goes to the skew recovery, not the error banner', async () => {
    const { hook, onError } = setup();
    initiate.mockRejectedValueOnce(new Error('Server Action "7f00" was not found on the server.'));
    await act(async () => {
      await hook.result.current.addFiles([mp4('a.mp4')]);
    });
    expect(recoverFromVersionSkew).toHaveBeenCalledWith(expect.any(Error), 'batch-add');
    expect(onError).not.toHaveBeenCalled();
  });

  it('a start that throws shows a friendly message and brings the actions back', async () => {
    const { hook, onError } = setup();
    await act(async () => {
      await hook.result.current.addFiles([mp4('a.mp4')]);
    });
    const { BatchUploadManager } = jest.requireActual('@/lib/upload/BatchUploadManager');
    const spy = jest.spyOn(BatchUploadManager.prototype, 'startUploads').mockRejectedValueOnce(new Error('raw boom'));
    // The row is still pending, so isUploading stays true only while something is active
    jest.spyOn(BatchUploadManager.prototype, 'getQueueState').mockReturnValueOnce(new Map());
    await act(async () => {
      await hook.result.current.startUpload();
    });
    expect(onError).toHaveBeenCalledWith(EN_TRANSLATIONS.errors.uploadFailed);
    expect(onError).not.toHaveBeenCalledWith('raw boom');
    expect(hook.result.current.isUploading).toBe(false);
    spy.mockRestore();
  });

  it('a failed complete call is reported, not shown (processing is tracked server-side)', async () => {
    const { hook, onError } = setup();
    complete.mockResolvedValue({ success: false, error: 'raw 500' });
    await act(async () => {
      await hook.result.current.addFiles([mp4('a.mp4')]);
    });
    await uploadAll(hook);
    expect(onError).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('[useBatchUpload] Complete upload failed', expect.objectContaining({ error: 'raw 500' }));
  });
});
