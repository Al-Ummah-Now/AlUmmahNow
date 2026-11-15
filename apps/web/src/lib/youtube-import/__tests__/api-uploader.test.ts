/**
 * The import API client splits matches into calls of 500; the uploader sends
 * each item's initiate with youtubeImport, streams a zip entry through its
 * own tus reader, completes, and maps refusals to their messages.
 */
import type { YtFileMatch } from '@al-ummah/shared-types';
import { saveMatches, getImportStatus, YtImportApiError } from '../api';
import { emptyTakeoutSet, type TakeoutSet } from '../takeout';
import { ImportUploader, initiateErrorCode } from '../uploader';
import type { LiveState } from '../wizard';
import { item } from './fixtures';
import { reportError } from '@/lib/errors/reporter';

jest.mock('@/lib/auth/client-token', () => ({
  fetchClientAuthInfo: jest.fn(async () => ({ accessToken: 'tok' })),
  fetchClientAuthToken: jest.fn(async () => 'tok'),
  getClientAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer tok' })),
}));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ERR-TEST-0001') }));
jest.mock('@/lib/upload/fingerprint', () => ({ tryFileFingerprint: jest.fn(async () => ({ name: 'n', size: 1, lastModified: 1, hash: 'h' })) }));

beforeEach(() => (reportError as jest.Mock).mockClear());

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } }) as unknown as Response;

describe('api', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as never;
  });

  it('splits matches into calls of at most 500', async () => {
    const fetchMock = (global.fetch as jest.Mock).mockImplementation((async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { matches: unknown[] };
      return json({ success: true, updated: body.matches.length });
    }) as never);
    const matches = Array.from({ length: 1201 }, (_, i) => ({ itemId: `i${i}`, match: null as YtFileMatch | null }));
    expect(await saveMatches('imp1', matches)).toBe(1201);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => (JSON.parse(String(init.body)) as { matches: unknown[] }).matches.length);
    expect(sizes).toEqual([500, 500, 201]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/youtube-import/imp1/matches');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws the server code (never its message)', async () => {
    (global.fetch as jest.Mock).mockImplementation((async () => json({ success: false, code: 'uploads_by_invitation', error: 'raw' }, 403)) as never);
    await expect(getImportStatus('c1')).rejects.toEqual(expect.objectContaining({ status: 403, code: 'uploads_by_invitation' }));
    await expect(getImportStatus('c1')).rejects.toBeInstanceOf(YtImportApiError);
  });
});

describe('ImportUploader', () => {
  const match: YtFileMatch = { zipName: '', entryName: 'talk.mp4', fileName: 'talk.mp4', size: 4, by: 'id' };
  const loose = new File([new Uint8Array([1, 2, 3, 4]) as BlobPart], 'talk.mp4', { type: 'video/mp4' });
  const takeout = (): TakeoutSet => {
    const set = emptyTakeoutSet();
    set.files.push({ key: 'talk.mp4', zipName: '', entryName: 'talk.mp4', fileName: 'talk.mp4', size: 4 });
    set.sources.set('talk.mp4', { kind: 'loose', file: loose });
    return set;
  };

  function run(initiateResult: unknown, opts: { complete?: unknown; fail?: Error } = {}) {
    const states: [string, LiveState | null][] = [];
    const initiate = jest.fn(async () => initiateResult);
    const complete = jest.fn(async () => opts.complete ?? { success: true });
    const created: Record<string, unknown>[] = [];
    const createUpload = jest.fn((o: Record<string, unknown>) => {
      created.push(o);
      return {
        start: async () => {
          (o.onProgress as (a: number, b: number) => void)(2, 4);
          if (opts.fail) (o.onError as (e: Error) => void)(opts.fail);
          else (o.onSuccess as () => void)();
        },
        abort: async () => undefined,
      };
    });
    const onServerChanged = jest.fn();
    const u = new ImportUploader({ importId: 'imp1', channelId: 'c1', takeout: takeout(), onState: (id, s) => states.push([id, s]), onServerChanged, deps: { initiate, complete, createUpload } as never });
    return { u, states, initiate, complete, created, onServerChanged };
  }

  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('initiates with youtubeImport, uploads, completes, then shows Processing', async () => {
    const { u, states, initiate, complete, created } = run({ success: true, result: { videoId: 'v1', tusSessionId: 's1', authToken: 'tok' } });
    u.enqueue([item('i1', { title: 'محاضرة', selected: true, state: 'selected', match })]);
    await settle();
    expect(initiate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'محاضرة', fileSize: 4, mimeType: 'video/mp4', youtubeImport: { importId: 'imp1', itemId: 'i1' }, fingerprint: expect.any(Object) }),
      'c1',
    );
    expect(created[0]).toMatchObject({ videoId: 'v1', tusSessionId: 's1', endpoint: 'https://api.test/api/videos/tus' });
    expect(created[0]!.fileReader).toBeUndefined();
    expect(complete).toHaveBeenCalledWith('v1', 'c1', 4);
    expect(states.map(([, s]) => s?.phase)).toEqual(['waiting', 'preparing', 'uploading', 'processing']);
    expect(states[2]![1]).toMatchObject({ percent: 50 });
  });

  it('maps refusals to their own messages, other failures to a reported generic one', async () => {
    expect(initiateErrorCode({ code: 'youtube_item_taken' })).toBe('youtube_item_taken');
    expect(initiateErrorCode({ code: 'upload_limit' })).toBe('upload_limit');
    expect(initiateErrorCode({ code: 'weird' })).toBe('generic');
    const limit = run({ success: false, status: 403, code: 'upload_limit', error: 'raw' });
    limit.u.enqueue([item('i1', { selected: true, state: 'selected', match })]);
    await settle();
    expect(limit.states.at(-1)).toEqual(['i1', { phase: 'failed', errorCode: 'upload_limit' }]);
    expect(reportError).not.toHaveBeenCalled();
    const broken = run({ success: true, result: { videoId: 'v1', tusSessionId: 's1' } }, { fail: new Error('boom') });
    broken.u.enqueue([item('i2', { selected: true, state: 'selected', match })]);
    await settle();
    expect(broken.states.at(-1)).toEqual(['i2', { phase: 'failed', errorCode: 'generic', reference: 'ERR-TEST-0001' }]);
  });

  it('409 youtube_item_taken: already processing or imported, so no failure; the import is read again', async () => {
    const taken = run({ success: false, status: 409, code: 'youtube_item_taken', error: 'raw' });
    taken.u.enqueue([item('i1', { selected: true, state: 'selected', match })]);
    await settle();
    expect(taken.states.at(-1)).toEqual(['i1', { phase: 'processing' }]);
    expect(taken.onServerChanged).toHaveBeenCalledTimes(1);
    expect(taken.created).toHaveLength(0);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('404 youtube_import_not_found: the import changed elsewhere; its own message, not reported, read again', async () => {
    const gone = run({ success: false, status: 404, code: 'youtube_import_not_found', error: 'raw' });
    gone.u.enqueue([item('i1', { selected: true, state: 'selected', match })]);
    await settle();
    expect(gone.states.at(-1)).toEqual(['i1', { phase: 'failed', errorCode: 'youtube_import_not_found' }]);
    expect(gone.onServerChanged).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('asks for the file when it is not among the picked ones, and runs two at a time', async () => {
    const { u, states, initiate } = run({ success: true, result: { videoId: 'v1', tusSessionId: 's1' } });
    u.enqueue([item('gone', { selected: true, state: 'selected', match: { ...match, entryName: 'other.mp4', fileName: 'other.mp4' } })]);
    await settle();
    expect(states.at(-1)).toEqual(['gone', { phase: 'needsFile' }]);
    expect(initiate).not.toHaveBeenCalled();

    // Two uploads at a time: the third starts when one finishes
    const releases: (() => void)[] = [];
    const created: string[] = [];
    const slow = new ImportUploader({
      importId: 'imp1',
      channelId: 'c1',
      takeout: takeout(),
      onState: () => undefined,
      deps: {
        initiate: (async (_m: unknown) => ({ success: true, result: { videoId: `v${created.length}`, tusSessionId: 's' } })) as never,
        complete: (async () => ({ success: true })) as never,
        createUpload: ((o: { videoId: string; onSuccess: () => void }) => {
          created.push(o.videoId);
          return { start: async () => void releases.push(o.onSuccess), abort: async () => undefined };
        }) as never,
      },
    });
    slow.enqueue(['x1', 'x2', 'x3'].map((id) => item(id, { selected: true, state: 'selected', match })));
    await settle();
    expect(created).toHaveLength(2);
    releases[0]!();
    await settle();
    expect(created).toHaveLength(3);
  });
});
