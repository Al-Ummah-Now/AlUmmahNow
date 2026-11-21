/**
 * D10: a transcript made on the creator's computer (desktop Studio, whisper.cpp) goes through the
 * same Quran matcher as the review transcript. Hand-typed mini Quran: no AI, no QF.
 */
import { MessageType, QURAN_CURRENT_KEY, QuranIndex, captionDraftKey, onDeviceTranscriptKey, quranIndexKey, type CaptionDraft } from '@al-ummah/shared-types';
import { claimFromRetryBody, isClaimPayload, processCaptionClaimMessages, runCaptionClaim } from '../captions/claim';
import { clearQuranIndexCache } from '../quran/review-matcher';
import { miniQuranRows } from './fixtures/quran-mini';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn() } as never;
const KEY = onDeviceTranscriptKey('v1', 'ar');
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

function env() {
  const REVIEW_MEDIA = new Bucket();
  const now = new Date().toISOString();
  const rows = miniQuranRows();
  REVIEW_MEDIA.store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: 'v-test', syncedAt: now, builtAt: now, surahs: 6, words: rows.length }));
  REVIEW_MEDIA.store.set(quranIndexKey('v-test'), JSON.stringify(QuranIndex.build(rows, 'v-test', now)));
  const subtitles = new Bucket();
  subtitles.store.set(
    KEY,
    JSON.stringify({
      videoId: 'v1',
      segments: [
        { startMs: 0, endMs: 3000, text: 'قال الشيخ في درس اليوم' },
        { startMs: 3000, endMs: 9000, text: RECITED },
      ],
    }),
  );
  return { REVIEW_MEDIA, subtitles, MESSAGE_QUEUE: { send: jest.fn() }, INTERNAL_API_KEY: 'internal', ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors', ENVIRONMENT: 'qa' };
}
const payload = (over: Record<string, unknown> = {}) => ({
  videoId: 'v1',
  language: 'ar',
  transcriptKey: KEY,
  source: 'on_device',
  engine: { provider: 'whisper.cpp', model: 'large-v3-turbo-q5_0' },
  requestedBy: 'owner',
  requestedAt: '2026-11-14T00:00:00.000Z',
  ...over,
});

beforeEach(() => clearQuranIndexCache());

describe('on-device transcript claims', () => {
  it('writes an on_device draft with Quran as a reference, records the engine and deletes the upload', async () => {
    const e = env();
    const out = await runCaptionClaim(e as never, payload() as never);
    expect(out).toMatchObject({ status: 'drafted', quran: 1 });
    const draft = e.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'ar'))!;
    expect(draft.origin).toBe('on_device');
    expect(draft.machine).toEqual({ provider: 'whisper.cpp', model: 'large-v3-turbo-q5_0' });
    const quran = draft.cues.flatMap((c) => c.segments).filter((s) => s.type === 'quran');
    expect(quran).toHaveLength(1);
    // The recitation is a reference to the official text; speech cues never carry its ASR text
    expect(quran[0]).toEqual(expect.objectContaining({ range: '112:1:1-112:4:5', status: 'confirmed' }));
    expect(JSON.stringify(draft.cues.filter((c) => c.segments[0]!.type === 'speech'))).not.toContain('كفوا');
    expect(e.subtitles.store.has(KEY)).toBe(false);
  });

  it('spans matched on the device go in as references, in time order, with the matcher on the rest', async () => {
    const e = env();
    e.subtitles.store.set(
      KEY,
      JSON.stringify({
        videoId: 'v1',
        segments: [
          { startMs: 0, endMs: 3000, text: 'قال الشيخ في درس اليوم' },
          { startMs: 3000, endMs: 5000, text: '', quran: { range: '1:1:1-1:1:4', status: 'basmala' } },
          { startMs: 5000, endMs: 11000, text: RECITED },
          { startMs: 11000, endMs: 12000, text: 'والحمد لله' },
        ],
      }),
    );
    expect(await runCaptionClaim(e as never, payload() as never)).toMatchObject({ status: 'drafted', quran: 2 });
    const draft = e.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'ar'))!;
    expect(draft.cues.map((c) => c.id)).toEqual(draft.cues.map((_, k) => `c${k + 1}`));
    expect(draft.cues.map((c) => c.startMs)).toEqual([...draft.cues.map((c) => c.startMs)].sort((a, b) => a - b));
    const quran = draft.cues.flatMap((c) => c.segments).filter((s) => s.type === 'quran');
    expect(quran[0]).toEqual({ type: 'quran', range: '1:1:1-1:1:4', status: 'basmala' });
    expect(quran[1]).toEqual(expect.objectContaining({ range: '112:1:1-112:4:5' }));
  });

  it('only this video and language: the key must be its own on-device key', () => {
    expect(isClaimPayload(payload())).toBe(true);
    expect(isClaimPayload(payload({ transcriptKey: onDeviceTranscriptKey('v2', 'ar') }))).toBe(false);
    expect(isClaimPayload(payload({ transcriptKey: onDeviceTranscriptKey('v1', 'en') }))).toBe(false);
    expect(isClaimPayload(payload({ transcriptKey: 'review/v1/r1/transcript.json' }))).toBe(false);
    expect(isClaimPayload(payload({ source: 'elsewhere' }))).toBe(false);
    expect(isClaimPayload(payload({ engine: { provider: 'x'.repeat(41) } }))).toBe(false);
    // A review claim cannot point at the on-device key either
    expect(isClaimPayload(payload({ source: undefined }))).toBe(false);
  });

  it('a transcript gone before the job ran is a refusal Studio shows, not a retry', async () => {
    const e = env();
    e.subtitles.store.delete(KEY);
    expect(await runCaptionClaim(e as never, payload() as never)).toEqual({ status: 'failed', error: 'transcript_gone' });
  });

  it('the last failed attempt flags the admin with a Retry that keeps the source and engine', async () => {
    const e = env();
    e.REVIEW_MEDIA.store.clear(); // no Quran copy: retryable until the last attempt
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const msg = { body: { id: 'm1', type: MessageType.CaptionClaimTranscript, payload: payload() }, attempts: 4, ack: jest.fn(), retry: jest.fn() };
    const waits: Promise<unknown>[] = [];
    await processCaptionClaimMessages([msg], e as never, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as never, logger);
    await Promise.all(waits);
    expect(msg.ack).toHaveBeenCalled();
    const action = JSON.parse(String(fetchMock.mock.calls[0][1]!.body)).events[0].action;
    expect(JSON.stringify(JSON.parse(String(fetchMock.mock.calls[0][1]!.body)))).toContain('Caption draft from an on-device transcript failed');
    const retry = claimFromRetryBody(action.retry.body);
    expect(retry).toMatchObject({ source: 'on_device', transcriptKey: KEY, engine: { provider: 'whisper.cpp', model: 'large-v3-turbo-q5_0' } });
    fetchMock.mockRestore();
  });
});
