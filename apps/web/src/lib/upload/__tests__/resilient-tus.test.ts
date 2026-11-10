/**
 * Retry/resume decisions for TUS uploads, and a full upload against a fake
 * TUS proxy that fails the way production did (v2026.11.09.5: 500 on PATCH,
 * then 500 on HEAD, and the client restarted every file from byte 0).
 */
// The browser build (what the upload page ships), not the Node one jest resolves
jest.mock('tus-js-client', () => jest.requireActual('tus-js-client/lib.es5/browser/index.js'));

import type { HttpRequest, HttpResponse, HttpStack, UrlStorage, PreviousUpload } from 'tus-js-client';
import {
  BASE_RETRY_DELAYS_MS,
  ResilientHttpStack,
  ResilientUpload,
  classifyTusFailure,
  grantedUploadUrl,
  jitteredRetryDelays,
  reportUploadFailure,
  requestUploadResume,
  shouldMaskHeadStatus,
  uploadFingerprint,
  type ReauthoriseResult,
} from '../resilient-tus';

describe('classifyTusFailure', () => {
  it.each([
    [undefined, 'retry'],
    [0, 'retry'],
    [500, 'retry'],
    [502, 'retry'],
    [503, 'retry'],
    [408, 'retry'],
    [409, 'retry'],
    [423, 'retry'],
    [429, 'retry'],
    [401, 'refresh-auth'],
    [404, 'reauthorise'],
    [410, 'reauthorise'],
    [400, 'fatal'],
    [403, 'fatal'],
    [413, 'fatal'],
    [415, 'fatal'],
  ])('status %p -> %s', (status, action) => {
    expect(classifyTusFailure(status as number | undefined)).toBe(action);
  });
});

describe('shouldMaskHeadStatus', () => {
  it('turns transient HEAD failures into 423 so tus-js-client never creates a new upload for them', () => {
    for (const status of [0, 500, 502, 503, 504, 520, 408, 429, 401]) expect(shouldMaskHeadStatus('HEAD', status)).toBe(true);
  });
  it('leaves "gone", success and every non-HEAD request alone', () => {
    for (const status of [200, 404, 410, 403]) expect(shouldMaskHeadStatus('HEAD', status)).toBe(false);
    for (const status of [500, 503, 0]) expect(shouldMaskHeadStatus('PATCH', status)).toBe(false);
  });
});

describe('jitteredRetryDelays', () => {
  it('keeps retrying for more than ten minutes (a deploy or an incident), first retry immediate', () => {
    const total = BASE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(10 * 60 * 1000);
    expect(BASE_RETRY_DELAYS_MS[0]).toBe(0);
  });
  it('spreads each delay by ±25%', () => {
    const low = jitteredRetryDelays(BASE_RETRY_DELAYS_MS, () => 0);
    const high = jitteredRetryDelays(BASE_RETRY_DELAYS_MS, () => 0.999999);
    BASE_RETRY_DELAYS_MS.forEach((d, i) => {
      expect(low[i]).toBe(Math.round(d * 0.75));
      expect(high[i]).toBeLessThanOrEqual(Math.round(d * 1.25));
      expect(high[i]).toBeGreaterThanOrEqual(low[i]);
    });
  });
});

describe('uploadFingerprint', () => {
  it('is per video, so the same file uploaded as two videos never shares an upload URL', () => {
    const f = { name: 'a.mp4', size: 10, lastModified: 1 };
    expect(uploadFingerprint(f, 'v1')).not.toBe(uploadFingerprint(f, 'v2'));
  });
});

describe('requestUploadResume', () => {
  const respond = (status: number, body: unknown) =>
    jest.fn(async () => ({ ok: status < 300, status, json: async () => body }) as unknown as Response);

  it('grants a new session (and the earlier upload) for an unfinished video', async () => {
    const f = respond(200, { success: true, result: { tusSessionId: 's2', tusUploadId: 'k.v1' } });
    await expect(requestUploadResume('https://api.test/', 'v1', { Authorization: 'Bearer t' }, f as unknown as typeof fetch))
      .resolves.toEqual({ kind: 'grant', tusSessionId: 's2', tusUploadId: 'k.v1' });
    expect(f).toHaveBeenCalledWith('https://api.test/api/videos/upload/resume/v1', expect.objectContaining({ headers: { Authorization: 'Bearer t' } }));
  });
  it('reports a finished upload as completed, a deleted one as gone, and throws on transient errors', async () => {
    await expect(requestUploadResume('a', 'v', {}, respond(409, { completed: true }) as unknown as typeof fetch)).resolves.toEqual({ kind: 'completed' });
    await expect(requestUploadResume('a', 'v', {}, respond(404, { error: 'Video not found' }) as unknown as typeof fetch)).resolves.toEqual({ kind: 'gone', message: 'Video not found' });
    await expect(requestUploadResume('a', 'v', {}, respond(503, {}) as unknown as typeof fetch)).rejects.toThrow('503');
  });
});

// ---------------------------------------------------------------------------
// A fake TUS proxy (HttpStack) with scripted failures
// ---------------------------------------------------------------------------

type Failure = { method: string; status?: number; network?: boolean };

class FakeTusServer implements HttpStack {
  uploads = new Map<string, { offset: number; size: number; videoId: string }>();
  sessions = new Map<string, string>(); // tusSessionId -> videoId
  failures: Failure[] = [];
  log: Array<{ method: string; url: string; status: number; offset?: number; auth?: string }> = [];
  private n = 0;

  constructor(readonly endpoint: string) {}

  getName() {
    return 'fake';
  }

  fail(...failures: Failure[]) {
    this.failures.push(...failures);
  }

  createRequest(method: string, url: string): HttpRequest {
    const headers: Record<string, string> = {};
    let progress: (n: number) => void = () => undefined;
    const response = (status: number, h: Record<string, string> = {}): HttpResponse => ({
      getStatus: () => status,
      getHeader: (k: string) => h[k],
      getBody: () => '',
      getUnderlyingObject: () => null,
    });
    return {
      getMethod: () => method,
      getURL: () => url,
      setHeader: (k, v) => {
        headers[k] = v;
      },
      getHeader: (k) => headers[k],
      setProgressHandler: (fn) => {
        progress = fn;
      },
      abort: async () => undefined,
      getUnderlyingObject: () => null,
      send: async (body: unknown) => {
        await Promise.resolve();
        const i = this.failures.findIndex((f) => f.method === method);
        if (i >= 0) {
          const [f] = this.failures.splice(i, 1);
          this.log.push({ method, url, status: f.network ? 0 : f.status!, auth: headers.Authorization });
          if (f.network) throw new Error('network down');
          return response(f.status!);
        }
        const auth = headers.Authorization;
        if (method === 'POST') {
          const meta = Object.fromEntries((headers['Upload-Metadata'] || '').split(',').map((p) => {
            const [k, v] = p.split(' ');
            return [k, v ? atob(v) : ''];
          }));
          const videoId = this.sessions.get(meta.tusSessionId);
          if (!videoId) {
            this.log.push({ method, url, status: 404, auth });
            return response(404);
          }
          const id = `u${++this.n}.${videoId}`;
          this.uploads.set(id, { offset: 0, size: Number(headers['Upload-Length']), videoId });
          this.log.push({ method, url, status: 201, auth });
          return response(201, { Location: `${this.endpoint}/${id}` });
        }
        const id = url.split('/').pop()!;
        const up = this.uploads.get(id);
        if (!up) {
          this.log.push({ method, url, status: 404, auth });
          return response(404);
        }
        if (method === 'HEAD') {
          this.log.push({ method, url, status: 200, offset: up.offset, auth });
          return response(200, { 'Upload-Offset': String(up.offset), 'Upload-Length': String(up.size) });
        }
        if (method === 'PATCH') {
          const at = Number(headers['Upload-Offset']);
          if (at !== up.offset) {
            this.log.push({ method, url, status: 409, offset: at, auth });
            return response(409);
          }
          const size = (body as Blob).size ?? (body as Uint8Array).length;
          progress(size);
          up.offset += size;
          this.log.push({ method, url, status: 204, offset: at, auth });
          return response(204, { 'Upload-Offset': String(up.offset) });
        }
        return response(405);
      },
    };
  }
}

class MemoryUrlStorage implements UrlStorage {
  entries = new Map<string, PreviousUpload & { fingerprint: string }>();
  private n = 0;
  async findAllUploads() {
    return [...this.entries.values()];
  }
  async findUploadsByFingerprint(fingerprint: string) {
    return [...this.entries.values()].filter((e) => e.fingerprint === fingerprint);
  }
  async removeUpload(key: string) {
    this.entries.delete(key);
  }
  async addUpload(fingerprint: string, upload: PreviousUpload) {
    const key = `k${++this.n}`;
    this.entries.set(key, { ...upload, fingerprint, urlStorageKey: key });
    return key;
  }
}

const ENDPOINT = 'https://api.test/api/videos/tus';
const CHUNK = 1024;
const fileOf = (chunks: number) => new File([new Uint8Array(chunks * CHUNK)], 'talk.mp4', { type: 'video/mp4', lastModified: 1 });

function run(opts: {
  server: FakeTusServer;
  storage?: MemoryUrlStorage;
  file?: File;
  reauthorise?: (videoId: string) => Promise<ReauthoriseResult>;
  getAuthorization?: (force: boolean) => Promise<string | null>;
  tusSessionId?: string;
  uploadUrl?: string;
  reportFailure?: (videoId: string, reason: string) => Promise<unknown>;
}) {
  const progress: number[] = [];
  const reconnecting: boolean[] = [];
  let resolve!: (r: { ok: boolean; error?: Error }) => void;
  const done = new Promise<{ ok: boolean; error?: Error }>((r) => {
    resolve = r;
  });
  const upload = new ResilientUpload({
    file: opts.file ?? fileOf(6),
    endpoint: ENDPOINT,
    videoId: 'v1',
    tusSessionId: opts.tusSessionId ?? 's1',
    uploadUrl: opts.uploadUrl,
    chunkSize: CHUNK,
    retryDelays: [0, 0, 0, 0, 0],
    httpStack: opts.server,
    urlStorage: opts.storage ?? new MemoryUrlStorage(),
    sleep: async () => undefined,
    getAuthorization: opts.getAuthorization ?? (async () => 'Bearer t'),
    reauthorise: opts.reauthorise ?? (async () => ({ kind: 'gone', message: 'no' })),
    reportFailure: opts.reportFailure,
    onProgress: (b) => progress.push(b),
    onReconnecting: (r) => reconnecting.push(r),
    onSuccess: () => resolve({ ok: true }),
    onError: (error) => resolve({ ok: false, error }),
  });
  return { upload, done, progress, reconnecting };
}

const posts = (s: FakeTusServer) => s.log.filter((l) => l.method === 'POST' && l.status === 201).length;
const patchOffsets = (s: FakeTusServer) => s.log.filter((l) => l.method === 'PATCH' && l.status === 204).map((l) => l.offset!);
const nonDecreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

describe('ResilientHttpStack', () => {
  it('a HEAD 500 reaches tus as 423; a PATCH 500 stays 500; a 401 is reported', async () => {
    const server = new FakeTusServer(ENDPOINT);
    const onUnauthorized = jest.fn();
    const stack = new ResilientHttpStack(server, onUnauthorized);
    server.fail({ method: 'HEAD', status: 500 }, { method: 'PATCH', status: 500 }, { method: 'HEAD', status: 401 });
    expect((await stack.createRequest('HEAD', `${ENDPOINT}/x`).send(null)).getStatus()).toBe(423);
    expect((await stack.createRequest('PATCH', `${ENDPOINT}/x`).send(null)).getStatus()).toBe(500);
    expect((await stack.createRequest('HEAD', `${ENDPOINT}/x`).send(null)).getStatus()).toBe(423);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('ResilientUpload against a failing proxy', () => {
  it('PATCH 500s and HEAD 500s (the production incident) resume at the server offset, never from 0', async () => {
    const server = new FakeTusServer(ENDPOINT);
    server.sessions.set('s1', 'v1');
    const { upload, done, progress, reconnecting } = run({ server });
    // After two chunks: PATCH 500, then HEAD 500 twice, then a network error
    let patches = 0;
    const original = server.createRequest.bind(server);
    server.createRequest = (method, url) => {
      if (method === 'PATCH' && ++patches === 3) {
        server.fail({ method: 'PATCH', status: 500 }, { method: 'HEAD', status: 500 }, { method: 'HEAD', status: 502 }, { method: 'PATCH', network: true });
      }
      return original(method, url);
    };
    await upload.start();
    const result = await done;
    expect(result).toEqual({ ok: true });
    expect(posts(server)).toBe(1); // one upload, never re-created
    expect(nonDecreasing(patchOffsets(server))).toBe(true);
    expect(patchOffsets(server)).toEqual([0, 1, 2, 3, 4, 5].map((n) => n * CHUNK));
    expect(nonDecreasing(progress)).toBe(true);
    expect(progress[progress.length - 1]).toBe(6 * CHUNK);
    expect(reconnecting).toEqual([true, false]);
  });

  it('a reload resumes the stored upload URL of this video (no new upload, no bytes re-sent)', async () => {
    const server = new FakeTusServer(ENDPOINT);
    server.sessions.set('s1', 'v1');
    const storage = new MemoryUrlStorage();
    const first = run({ server, storage });
    let patches = 0;
    const original = server.createRequest.bind(server);
    server.createRequest = (method, url) => {
      if (method === 'PATCH' && ++patches === 4) void first.upload.abort(); // the tab closes mid-upload
      return original(method, url);
    };
    await first.upload.start();
    await new Promise((r) => setTimeout(r, 20));
    server.createRequest = original;
    const offsetAtReload = [...server.uploads.values()][0].offset;
    expect(offsetAtReload).toBeGreaterThan(0);

    const second = run({ server, storage }); // new page, same file, same video
    await second.upload.start();
    expect(await second.done).toEqual({ ok: true });
    expect(posts(server)).toBe(1);
    expect(nonDecreasing(patchOffsets(server))).toBe(true);
    expect(Math.min(...patchOffsets(server).slice(patchOffsets(server).indexOf(offsetAtReload)))).toBe(offsetAtReload);
  });

  it('a lost session (PATCH 404) re-authorises the SAME video and resumes its Bunny upload', async () => {
    const server = new FakeTusServer(ENDPOINT);
    server.sessions.set('s1', 'v1');
    let uploadId = '';
    const reauthorise = jest.fn(async (videoId: string): Promise<ReauthoriseResult> => {
      server.sessions.set('s2', videoId);
      return { kind: 'grant', tusSessionId: 's2', tusUploadId: uploadId };
    });
    const { upload, done } = run({ server, reauthorise });
    let patches = 0;
    const original = server.createRequest.bind(server);
    server.createRequest = (method, url) => {
      if (method === 'PATCH' && ++patches === 3) {
        uploadId = url.split('/').pop()!;
        server.fail({ method: 'PATCH', status: 404 });
      }
      return original(method, url);
    };
    await upload.start();
    expect(await done).toEqual({ ok: true });
    expect(reauthorise).toHaveBeenCalledWith('v1');
    expect(posts(server)).toBe(1);
    expect(nonDecreasing(patchOffsets(server))).toBe(true);
  });

  it('an expired initiate session (POST 404, queued bulk file) gets a new session for the same video', async () => {
    const server = new FakeTusServer(ENDPOINT);
    const reauthorise = jest.fn(async (videoId: string): Promise<ReauthoriseResult> => {
      server.sessions.set('fresh', videoId);
      return { kind: 'grant', tusSessionId: 'fresh' };
    });
    const { upload, done } = run({ server, reauthorise, tusSessionId: 'expired' });
    await upload.start();
    expect(await done).toEqual({ ok: true });
    expect(reauthorise).toHaveBeenCalledTimes(1);
    expect([...server.uploads.values()][0]).toMatchObject({ videoId: 'v1', offset: 6 * CHUNK });
  });

  it('when Bunny lost the bytes (HEAD 404) it starts over in the same video, and says so honestly', async () => {
    const server = new FakeTusServer(ENDPOINT);
    server.sessions.set('s1', 'v1');
    const { upload, done, progress } = run({ server, uploadUrl: `${ENDPOINT}/gone.v1` });
    await upload.start();
    expect(await done).toEqual({ ok: true });
    expect(posts(server)).toBe(1);
    expect(progress[progress.length - 1]).toBe(6 * CHUNK);
  });

  it('a finished upload found on re-authorisation counts as success', async () => {
    const server = new FakeTusServer(ENDPOINT);
    const { upload, done } = run({ server, tusSessionId: 'expired', reauthorise: async () => ({ kind: 'completed' }) });
    await upload.start();
    expect(await done).toEqual({ ok: true });
  });

  it('a 401 (expired token) asks for a fresh token and carries on', async () => {
    const server = new FakeTusServer(ENDPOINT);
    server.sessions.set('s1', 'v1');
    const getAuthorization = jest.fn(async (force: boolean) => (force ? 'Bearer fresh' : 'Bearer old'));
    const { upload, done } = run({ server, getAuthorization });
    let patches = 0;
    const original = server.createRequest.bind(server);
    server.createRequest = (method, url) => {
      if (method === 'PATCH' && ++patches === 2) server.fail({ method: 'PATCH', status: 401 });
      return original(method, url);
    };
    await upload.start();
    expect(await done).toEqual({ ok: true });
    expect(getAuthorization).toHaveBeenCalledWith(true);
    expect(posts(server)).toBe(1);
  });

  it('a fatal error (403) fails the file without retrying forever', async () => {
    const server = new FakeTusServer(ENDPOINT);
    server.sessions.set('s1', 'v1');
    server.fail({ method: 'POST', status: 403 });
    const reportFailure = jest.fn(async () => true);
    const { upload, done } = run({ server, reportFailure });
    await upload.start();
    const result = await done;
    expect(result.ok).toBe(false);
    // never silent: the video is flagged for a re-upload, once
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith('v1', expect.any(String));
  });

  it('a successful upload reports nothing', async () => {
    const server = new FakeTusServer(ENDPOINT);
    server.sessions.set('s1', 'v1');
    const reportFailure = jest.fn(async () => true);
    const { upload, done } = run({ server, reportFailure });
    await upload.start();
    expect(await done).toEqual({ ok: true });
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe('grantedUploadUrl', () => {
  const file = { size: 100 };
  it('resumes the earlier upload only for a file of the same size', () => {
    expect(grantedUploadUrl('https://api.test/tus/', { tusUploadId: 'k.v1', tusUploadFileSize: 100 }, file)).toBe('https://api.test/tus/k.v1');
    expect(grantedUploadUrl('https://api.test/tus', { tusUploadId: 'k.v1' }, file)).toBe('https://api.test/tus/k.v1');
  });
  it('a different file (re-upload) starts a new upload in the same video', () => {
    expect(grantedUploadUrl('https://api.test/tus', { tusUploadId: 'k.v1', tusUploadFileSize: 99 }, file)).toBeUndefined();
    expect(grantedUploadUrl('https://api.test/tus', {}, file)).toBeUndefined();
  });
});

describe('reportUploadFailure', () => {
  const res = (status: number) => ({ ok: status < 300, status }) as Response;
  const sleep = async () => undefined;
  it('posts the reason to the failed endpoint', async () => {
    const f = jest.fn(async () => res(200));
    await expect(reportUploadFailure('https://api.test/', 'v 1', { Authorization: 'Bearer t' }, 'gone', { fetchImpl: f as unknown as typeof fetch, sleep })).resolves.toBe(true);
    expect(f).toHaveBeenCalledWith('https://api.test/api/videos/upload/failed/v%201', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'gone' }),
    }));
  });
  it('retries network errors and 5xx, stops on a final answer, never throws', async () => {
    const f = jest.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
    await expect(reportUploadFailure('a', 'v', {}, 'r', { fetchImpl: f as unknown as typeof fetch, sleep })).resolves.toBe(true);
    expect(f).toHaveBeenCalledTimes(3);
    const finished = jest.fn(async () => res(409));
    await expect(reportUploadFailure('a', 'v', {}, 'r', { fetchImpl: finished as unknown as typeof fetch, sleep })).resolves.toBe(false);
    expect(finished).toHaveBeenCalledTimes(1);
    const down = jest.fn(async () => { throw new TypeError('offline'); });
    await expect(reportUploadFailure('a', 'v', {}, 'r', { fetchImpl: down as unknown as typeof fetch, sleep })).resolves.toBe(false);
    expect(down).toHaveBeenCalledTimes(4);
  });
});
