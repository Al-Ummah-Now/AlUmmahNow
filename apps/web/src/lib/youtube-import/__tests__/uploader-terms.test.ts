import type { YtImportItem } from '@al-ummah/shared-types';
import { ImportUploader } from '../uploader';
import type { TakeoutSet } from '../takeout';

jest.mock('@/lib/upload/fingerprint', () => ({
  tryFileFingerprint: jest.fn().mockResolvedValue('fp-1'),
}));
jest.mock('@/lib/runtime-config', () => ({
  getApiUrl: () => 'https://api.example.test',
}));
jest.mock('@/lib/auth/client-token', () => ({
  fetchClientAuthToken: jest.fn().mockResolvedValue('tok'),
  getClientAuthHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer tok' }),
}));
jest.mock('@/lib/logger-client', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function makeItem(id: string): YtImportItem {
  return {
    id,
    importId: 'imp-1',
    youtubeVideoId: `yt-${id}`,
    title: `Video ${id}`,
    status: 'matched',
    match: { zipName: '', entryName: `${id}.mp4`, fileName: `${id}.mp4`, size: 100, by: 'name' },
  } as unknown as YtImportItem;
}

function makeTakeout(ids: string[]): TakeoutSet {
  const sources = new Map();
  for (const id of ids) {
    sources.set(`${id}.mp4`, {
      kind: 'loose',
      file: new File([new Uint8Array(100)], `${id}.mp4`, { type: 'video/mp4' }),
    });
  }
  return { files: [], sources, csv: [], picked: [], problems: [] } as unknown as TakeoutSet;
}

describe('ImportUploader terms_required pause and resume', () => {
  it('pauses the queue on first terms_required without hammering remaining items, and resumes on resume()', async () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')];
    let allow = false;
    const initiatedIds: string[] = [];
    const onTermsRequired = jest.fn();
    const states: Array<{ id: string; phase: string }> = [];

    const uploader = new ImportUploader({
      importId: 'imp-1',
      channelId: 'ch-1',
      takeout: makeTakeout(['a', 'b', 'c']),
      onState: (id, st) => {
        if (st) states.push({ id, phase: st.phase });
      },
      onTermsRequired,
      deps: {
        initiate: jest.fn(async (req) => {
          const itemId = req.youtubeImport?.itemId ?? '';
          initiatedIds.push(itemId);
          if (!allow) {
            return { success: false, status: 403, code: 'terms_required', error: 'Accept terms' };
          }
          return {
            success: true,
            result: { videoId: `vid-${itemId}`, tusSessionId: `sess-${itemId}` },
          };
        }) as unknown as never,
        complete: jest.fn().mockResolvedValue({ success: true }) as unknown as never,
        createUpload: (opts) => ({
          start: async () => {
            opts.onSuccess?.();
          },
          abort: async () => undefined,
        }),
      },
    });

    uploader.enqueue(items);
    await new Promise((r) => setTimeout(r, 30));

    // Only the initial concurrency slots (a, b) could fire before pause; c was NEVER initiated while paused,
    // and onTermsRequired fired only ONCE.
    expect(onTermsRequired).toHaveBeenCalledTimes(1);
    expect(uploader.isPausedForTerms()).toBe(true);
    expect(initiatedIds).not.toContain('c');

    // Paused, not failed; more items wait with them, and nothing asks again (the page polls every few seconds)
    expect(states.filter((s) => s.phase === 'failed')).toEqual([]);
    expect(states.filter((s) => s.phase === 'paused').map((s) => s.id).sort()).toEqual(['a', 'b']);
    uploader.enqueue([]);
    uploader.enqueue([items[0], items[1]]);
    expect(onTermsRequired).toHaveBeenCalledTimes(1);
    expect(uploader.isPausedForTerms()).toBe(true);

    // Accepting Terms and calling resume() retries the queued items and completes all three
    allow = true;
    uploader.resume();
    expect(uploader.isPausedForTerms()).toBe(false);
    await new Promise((r) => setTimeout(r, 50));

    expect(initiatedIds).toContain('c');
    expect(states.filter((s) => s.phase === 'processing').map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
    await uploader.stop();
  });

  it('a refusal of an item sent before the acceptance does not pause the queue again', async () => {
    const onTermsRequired = jest.fn();
    const answers: Record<string, Array<(v: unknown) => void>> = { a: [], b: [] };
    const uploader = new ImportUploader({
      importId: 'imp-1', channelId: 'ch-1', takeout: makeTakeout(['a', 'b']), onState: jest.fn(), onTermsRequired,
      deps: {
        initiate: jest.fn((req) => new Promise((resolve) => answers[req.youtubeImport!.itemId].push(resolve))) as unknown as never,
        complete: jest.fn().mockResolvedValue({ success: true }) as unknown as never,
        createUpload: (opts) => ({ start: async () => { opts.onSuccess?.(); }, abort: async () => undefined }),
      },
    });
    const refused = { success: false, status: 403, code: 'terms_required' };
    const tick = () => new Promise((r) => setTimeout(r, 20));
    uploader.enqueue([makeItem('a'), makeItem('b')]);
    await tick();
    answers.a[0](refused);
    await tick();
    expect(onTermsRequired).toHaveBeenCalledTimes(1);
    uploader.resume();
    await tick();
    answers.b[0](refused);
    await tick();
    expect(onTermsRequired).toHaveBeenCalledTimes(1);
    expect(uploader.isPausedForTerms()).toBe(false);
    // Both are sent again
    expect([answers.a.length, answers.b.length]).toEqual([2, 2]);
    await uploader.stop();
  });
});
