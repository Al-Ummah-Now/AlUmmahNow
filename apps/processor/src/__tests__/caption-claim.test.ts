/**
 * Claiming the review transcript as a caption draft (VR11, #1296): the transcript and the
 * AUN-CAPTIONS matcher become a draft whose Quran spans are references to the official text, never
 * ASR text. Hand-typed mini Quran, fixture transcript: no AI, no QF.
 */
import {
  MessageType,
  QURAN_CURRENT_KEY,
  QuranIndex,
  captionClaimKey,
  captionDraftKey,
  quranIndexKey,
  type CaptionDraft,
} from '@al-ummah/shared-types';
import { CLAIM_LAST_ATTEMPT, claimRetryDelaySeconds, processCaptionClaimMessages, runCaptionClaim } from '../captions/claim';
import { clearQuranIndexCache } from '../quran/review-matcher';
import { handleCaptionClaimRequest } from '../index';
import { miniQuranRows } from './fixtures/quran-mini';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn() } as never;
const TRANSCRIPT = 'review/v1/r1/transcript.json';
const VERSION = 'v-test';
const RECITED = 'قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد';

class Bucket {
  store = new Map<string, string>();
  async get(key: string) {
    const v = this.store.get(key);
    return v === undefined ? null : { text: async () => v, json: async <T>() => JSON.parse(v) as T };
  }
  async put(key: string, value: string, opts?: { onlyIf?: { etagDoesNotMatch?: string } }) {
    if (opts?.onlyIf?.etagDoesNotMatch === '*' && this.store.has(key)) return null;
    this.store.set(key, value);
    return { key };
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
  }
  read<T>(key: string): T | null {
    const v = this.store.get(key);
    return v === undefined ? null : (JSON.parse(v) as T);
  }
}

function env(opts: { copy?: boolean } = {}) {
  const REVIEW_MEDIA = new Bucket();
  REVIEW_MEDIA.store.set(
    TRANSCRIPT,
    JSON.stringify({
      videoId: 'v1',
      segments: [
        { startMs: 0, endMs: 3000, text: 'قال الشيخ في درس اليوم' },
        { startMs: 3000, endMs: 9000, text: RECITED },
        { startMs: 9000, endMs: 12000, text: 'وهذه السورة تعدل ثلث القرآن' },
      ],
    }),
  );
  if (opts.copy !== false) {
    const now = new Date().toISOString();
    const rows = miniQuranRows();
    REVIEW_MEDIA.store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: VERSION, syncedAt: now, builtAt: now, surahs: 6, words: rows.length }));
    REVIEW_MEDIA.store.set(quranIndexKey(VERSION), JSON.stringify(QuranIndex.build(rows, VERSION, now)));
  }
  return {
    REVIEW_MEDIA,
    subtitles: new Bucket(),
    MESSAGE_QUEUE: { send: jest.fn().mockResolvedValue(undefined) },
    INTERNAL_API_KEY: 'internal',
    ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors',
    ENVIRONMENT: 'qa',
  };
}
const payload = (over: Record<string, unknown> = {}) => ({ videoId: 'v1', language: 'ar', transcriptKey: TRANSCRIPT, requestedBy: 'owner', requestedAt: '2026-11-14T00:00:00.000Z', ...over });
const message = (attempts = 1, p: unknown = payload()) => ({ body: { id: 'm1', type: MessageType.CaptionClaimTranscript, payload: p }, attempts, ack: jest.fn(), retry: jest.fn() });

beforeEach(() => clearQuranIndexCache());

describe('the claimed draft', () => {
  it('speech stays speech; the recited surah is one cue holding a reference, never the ASR text', async () => {
    const e = env();
    const out = await runCaptionClaim(e, payload());
    expect(out).toEqual({ status: 'drafted', cues: 3, quran: 1 });
    const draft = e.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'ar'))!;
    expect(draft).toEqual(expect.objectContaining({ version: 1, kind: 'source', origin: 'review_transcript', edited: false, updatedBy: 'owner' }));
    expect(draft.cues.map((c) => c.segments.map((s) => s.type))).toEqual([['speech'], ['quran'], ['speech']]);
    const span = draft.cues[1]!.segments[0]!;
    expect(span).toEqual(expect.objectContaining({ type: 'quran', range: '112:1:1-112:4:5', status: 'confirmed' }));
    // What was heard is kept only for "Not Quran"; the draft has no other copy of it
    expect((span as { heard?: string }).heard).toBe(RECITED);
    expect(JSON.stringify(draft.cues.filter((c) => c.segments[0]!.type === 'speech'))).not.toContain('الصمد');
    expect(draft.cues[1]!.startMs).toBe(3000);
    expect(draft.cues[1]!.endMs).toBe(9000);
  });

  it('a draft that exists is kept unless the creator asked to replace it', async () => {
    const e = env();
    e.subtitles.store.set(captionDraftKey('v1', 'ar'), JSON.stringify({ version: 4, cues: [] }));
    expect(await runCaptionClaim(e, payload())).toEqual({ status: 'failed', error: 'draft_exists' });
    expect(await runCaptionClaim(e, payload({ replace: true }))).toEqual(expect.objectContaining({ status: 'drafted' }));
    expect(e.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'ar'))!.version).toBe(5);
  });

  it('a transcript purged meanwhile fails for the creator, not the admin', async () => {
    const e = env();
    e.REVIEW_MEDIA.store.delete(TRANSCRIPT);
    const m = message();
    await processCaptionClaimMessages([m], e, undefined, logger);
    expect(m.ack).toHaveBeenCalled();
    expect(e.subtitles.read(captionClaimKey('v1', 'ar'))).toEqual(expect.objectContaining({ status: 'failed', error: 'transcript_gone' }));
  });

  it('refuses a transcript key that is not this video\'s review transcript', async () => {
    const e = env();
    const m = message(1, payload({ transcriptKey: 'quran/state.json' }));
    await processCaptionClaimMessages([m], e, undefined, logger);
    expect(m.ack).toHaveBeenCalled();
    expect(e.subtitles.read(captionDraftKey('v1', 'ar'))).toBeNull();
  });
});

describe('the queue job and the admin', () => {
  const realFetch = global.fetch;
  let posts: Array<{ events?: Array<{ action?: Record<string, unknown> }>; resolved?: Array<{ key: string }> }>;
  let pending: Promise<unknown>[];
  const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p) });
  beforeEach(() => {
    posts = [];
    pending = [];
    global.fetch = jest.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('no fresh Quran copy: no draft is written and the job waits for one', async () => {
    const e = env({ copy: false });
    e.subtitles.store.set(captionClaimKey('v1', 'ar'), JSON.stringify({ status: 'queued' }));
    const m = message(1);
    await processCaptionClaimMessages([m], e, ctx(), logger);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: claimRetryDelaySeconds(1) });
    expect(e.subtitles.read(captionDraftKey('v1', 'ar'))).toBeNull();
    await Promise.all(pending);
    expect(posts).toHaveLength(0);
  });

  it('the last attempt marks the claim failed and flags the admin with Try again', async () => {
    const e = env({ copy: false });
    const m = message(CLAIM_LAST_ATTEMPT);
    await processCaptionClaimMessages([m], e, ctx(), logger);
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(e.subtitles.read(captionClaimKey('v1', 'ar'))).toEqual(expect.objectContaining({ status: 'failed', error: 'failed' }));
    await Promise.all(pending);
    expect(posts[0]!.events![0]!.action).toEqual(
      expect.objectContaining({
        key: 'caption-claim:v1:ar',
        retry: { kind: 'service', service: 'processor', path: '/internal/captions/claim', body: { videoId: 'v1', language: 'ar', transcriptKey: TRANSCRIPT, requestedBy: 'owner', replace: '0' } },
        retryLabel: 'Try again',
      }),
    );
  });

  it('a successful claim clears its marker and resolves the admin item', async () => {
    const e = env();
    e.subtitles.store.set(captionClaimKey('v1', 'ar'), JSON.stringify({ status: 'queued' }));
    const m = message(2);
    await processCaptionClaimMessages([m], e, ctx(), logger);
    expect(m.ack).toHaveBeenCalled();
    expect(e.subtitles.read(captionClaimKey('v1', 'ar'))).toBeNull();
    await Promise.all(pending);
    expect(JSON.stringify(posts)).toContain('caption-claim:v1:ar');
  });

  it('POST /internal/captions/claim (the admin\'s Try again) re-queues for an internal caller only', async () => {
    const e = env();
    const req = (key?: string, body: unknown = { videoId: 'v1', language: 'ar', transcriptKey: TRANSCRIPT, requestedBy: 'owner', replace: 0 }) =>
      new Request('https://p/internal/captions/claim', { method: 'POST', headers: key ? { 'X-API-Key': key } : {}, body: JSON.stringify(body) });
    expect((await handleCaptionClaimRequest(req(), e as never, logger)).status).toBe(401);
    expect((await handleCaptionClaimRequest(req('internal', { videoId: 'v1', language: 'ar', transcriptKey: 'quran/state.json', requestedBy: 'o' }), e as never, logger)).status).toBe(400);
    expect((await handleCaptionClaimRequest(req('internal'), e as never, logger)).status).toBe(202);
    expect(e.MESSAGE_QUEUE.send).toHaveBeenCalledWith(expect.objectContaining({ type: MessageType.CaptionClaimTranscript, payload: expect.objectContaining({ videoId: 'v1', language: 'ar', replace: false }) }));
    expect(e.subtitles.read(captionClaimKey('v1', 'ar'))).toEqual(expect.objectContaining({ status: 'queued' }));
    // The Errors page sends the stored body back with strings
    await handleCaptionClaimRequest(req('internal', { videoId: 'v1', language: 'ar', transcriptKey: TRANSCRIPT, requestedBy: 'owner', replace: '1' }), e as never, logger);
    expect(e.MESSAGE_QUEUE.send).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ replace: true }) }));
  });
});
