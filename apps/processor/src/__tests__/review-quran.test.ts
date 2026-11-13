/**
 * The video review leaves Quran recitation out of violence and hate scoring (AlUmmahNow#1271):
 * a battle verse in the transcript, which the policy model flags, is matched to the Quran from the
 * Content Sync copy and does not hold the video. Fixture provider and a hand-typed copy: no AI, no QF.
 */
import {
  DEFAULT_VIDEO_REVIEW_SETTINGS,
  QURAN_CURRENT_KEY,
  QuranIndex,
  normaliseVideoReviewSettings,
  quranIndexKey,
  routeReview,
  type VideoReviewScanPayload,
} from '@al-ummah/shared-types';
import { runReviewPipeline, splitByQuran, type ReviewMediaBucket } from '../review/pipeline';
import type { ModerationProvider, TranscriptSegment } from '../review/provider';
import { clearQuranIndexCache, createReviewQuranMatcher, segmentWords } from '../quran/review-matcher';
import { miniQuranRows } from './fixtures/quran-mini';

// Al-Baqarah 2:191 (Imla'i), added to the mini Quran
const BATTLE_VERSE = 'واقتلوهم حيث ثقفتموهم وأخرجوهم من حيث أخرجوكم والفتنة أشد من القتل ولا تقاتلوهم عند المسجد الحرام حتى يقاتلوكم فيه فإن قاتلوكم فاقتلوهم كذلك جزاء الكافرين';
const VERSION = 'v-test';

function media(opts: { syncedAt?: string; withCopy?: boolean } = {}) {
  const rows = [...miniQuranRows(), ...BATTLE_VERSE.split(' ').map((imlaei, i) => ({ loc: { surah: 2, ayah: 191, word: i + 1 }, imlaei }))];
  rows.sort((a, b) => a.loc.surah - b.loc.surah || a.loc.ayah - b.loc.ayah || a.loc.word - b.loc.word);
  const store = new Map<string, string>([
    ['review/v1/manifest.json', JSON.stringify({ videoId: 'v1', rev: '1', durationMs: 60_000, frames: [], audio: [{ key: 'review/v1/a0.wav', startMs: 0, endMs: 60_000 }], capped: false, createdAt: 'x' })],
    ['review/v1/a0.wav', 'RIFF'],
  ]);
  if (opts.withCopy !== false) {
    const syncedAt = opts.syncedAt ?? new Date().toISOString();
    store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: VERSION, syncedAt, builtAt: syncedAt, surahs: 7, words: rows.length }));
    store.set(quranIndexKey(VERSION), JSON.stringify(QuranIndex.build(rows, VERSION, syncedAt)));
  }
  const bucket: ReviewMediaBucket = {
    get: async (key) => {
      const v = store.get(key);
      return v === undefined ? null : { text: async () => v, arrayBuffer: async () => new TextEncoder().encode(v).buffer as ArrayBuffer };
    },
  };
  return bucket;
}

/** Speech: a sentence of commentary, the battle verse recited, then commentary that is itself violent. */
const SEGMENTS: TranscriptSegment[] = [
  { startMs: 0, endMs: 6_000, text: 'قال الشيخ في درس اليوم عن آيات القتال' },
  { startMs: 6_000, endMs: 30_000, text: BATTLE_VERSE.replace('ثقفتموهم', 'ثقفتمهم') },
  { startMs: 300_000, endMs: 306_000, text: 'اذهبوا واقتلوا جيرانكم الليلة' },
];

const provider = (): ModerationProvider => ({
  kind: 'fixture',
  screenImages: async () => [],
  reviewImage: async () => ({ category: 'none', score: 0, minorPresent: 0 }),
  transcribe: async () => SEGMENTS,
  guardText: async () => ({ scores: {} }),
  // The policy model flags anything about killing, recitation included
  policyText: async (text) => ({ scores: /قتل|اقتلوا|فاقتلوهم/.test(text) ? { violent_extremism: 0.97 } : {} }),
});

const settings = normaliseVideoReviewSettings({ ...DEFAULT_VIDEO_REVIEW_SETTINGS, mode: 'enforce' });
const payload: VideoReviewScanPayload = {
  videoId: 'v1', reviewId: 'r1', channelId: 'ch1', ownerId: 'u1', timing: 'pre', mode: 'enforce',
  metadataText: '', manifestKey: 'review/v1/manifest.json', trigger: 'upload', settings, queuedAt: new Date().toISOString(),
} as VideoReviewScanPayload;

beforeEach(() => clearQuranIndexCache());

describe('Quran in the video review (#1271)', () => {
  it('segment time is spread over its words', () => {
    expect(segmentWords([{ startMs: 1000, endMs: 2000, text: 'a  b c d' }]).map((w) => [w.startMs, w.endMs])).toEqual([
      [1000, 1250],
      [1250, 1500],
      [1500, 1750],
      [1750, 2000],
    ]);
  });

  it('the transcript splits at the spans: commentary before and after is never tagged', () => {
    const pieces = splitByQuran(
      [
        { startMs: 0, endMs: 4000, text: 'a b c d' },
        { startMs: 4000, endMs: 6000, text: 'e f' },
      ],
      [
        { startMs: 1000, endMs: 3000, ref: '1:1:1-1:1:2' },
        { startMs: 4000, endMs: 5000, ref: '1:2:1-1:2:1' },
      ],
    );
    expect(pieces.map((p) => [p.ref ?? '-', p.segments.map((s) => s.text).join('|')])).toEqual([
      ['-', 'a'],
      ['1:1:1-1:1:2', 'b c'],
      ['-', 'd'],
      ['1:2:1-1:2:1', 'e'],
      ['-', 'f'],
    ]);
  });

  it('the recited battle verse is tagged 2:191 and does not count; violent commentary still does', async () => {
    const bucket = media();
    const result = await runReviewPipeline(payload, { provider: provider(), media: bucket }, createReviewQuranMatcher(bucket));
    const violent = result.findings.filter((f) => f.category === 'violent_extremism');
    const recited = violent.filter((f) => f.quranRef);
    expect(recited.length).toBeGreaterThan(0);
    for (const f of recited) expect(f.quranRef).toMatch(/^2:191:\d+-2:191:\d+$/);
    expect(violent.some((f) => !f.quranRef && (f.atMs ?? 0) >= 300_000)).toBe(true);

    // Only the commentary holds it; without it the recitation alone is approved
    const route = routeReview(result.findings, settings, { mode: 'enforce' });
    expect(route.route).not.toBe('approve');
    const onlyRecitation = routeReview(result.findings.filter((f) => (f.atMs ?? 0) < 300_000), settings, { mode: 'enforce' });
    expect(onlyRecitation.route).toBe('approve');
  });

  it('no copy, or a copy over 7 days old: no spans, so the flagged recitation goes to a person (fail safe)', async () => {
    for (const bucket of [media({ withCopy: false }), media({ syncedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() })]) {
      clearQuranIndexCache();
      const result = await runReviewPipeline(payload, { provider: provider(), media: bucket }, createReviewQuranMatcher(bucket));
      expect(result.findings.some((f) => f.quranRef)).toBe(false);
      const early = result.findings.filter((f) => (f.atMs ?? 0) < 300_000);
      expect(routeReview(early, settings, { mode: 'enforce' }).route).not.toBe('approve');
    }
  });

  it('a broken index never fails the review: no spans, the error is reported', async () => {
    const errors: unknown[] = [];
    const bucket: ReviewMediaBucket = { get: async (key) => (key === QURAN_CURRENT_KEY ? { text: async () => '{not json', arrayBuffer: async () => new ArrayBuffer(0) } : null) };
    expect(await createReviewQuranMatcher(bucket, (e) => errors.push(e))(SEGMENTS)).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
