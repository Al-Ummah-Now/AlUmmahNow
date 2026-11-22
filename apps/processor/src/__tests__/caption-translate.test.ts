/**
 * Transcript translation in the processor (AUN-CAPTIONS §5.7): one cue batch per delivery, Quran
 * spans kept as references (never machine-translated), a failed check retries the model and then
 * the fallback, the budget wait, and the translated draft. Fixture and fake translators only: no AI.
 */
jest.mock('../moderation/budget', () => ({ reserveBudget: jest.fn(async () => true), settleBudget: jest.fn(async () => undefined) }));
jest.mock('../moderation/usage', () => ({ recordUsage: jest.fn(async () => 10) }));

import {
  MessageType,
  QuranIndex,
  captionDraftKey,
  captionDraftVersionKey,
  captionPublishedSourceKey,
  captionSourceWorkKey,
  captionTranslateWorkKey,
  renderCaptionVtt,
  type CaptionDraft,
  type CaptionTranslatePayload,
} from '@al-ummah/shared-types';
import { miniQuranRows } from './fixtures/quran-mini';
import { reserveBudget } from '../moderation/budget';
import { BUDGET_WAIT_SECONDS, CAPTION_JOB_LAST_ATTEMPT } from '../captions/job';
import { isCaptionTranslatePayload, processCaptionTranslateMessages, readPublishedSource, readSource } from '../captions/translate';
import { DeepLTranslator, FixtureTranslator, WorkersAiTranslator, translatorFor, type Translator } from '../captions/translator';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn() } as never;
const JOB = 'job-tr-0000-1111';

class Bucket {
  store = new Map<string, { value: string; etag: string }>();
  n = 0;
  set(key: string, value: string) {
    this.store.set(key, { value, etag: `e${++this.n}` });
  }
  async get(key: string) {
    const v = this.store.get(key);
    return v ? { text: async () => v.value, etag: v.etag } : null;
  }
  async put(key: string, value: string, opts?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
    const cur = this.store.get(key);
    if (opts?.onlyIf?.etagDoesNotMatch === '*' && cur) return null;
    if (opts?.onlyIf?.etagMatches && cur?.etag !== opts.onlyIf.etagMatches) return null;
    this.set(key, value);
    return { key };
  }
  read<T>(key: string): T | null {
    const v = this.store.get(key);
    return v ? (JSON.parse(v.value) as T) : null;
  }
  async list({ prefix }: { prefix: string }) {
    return { objects: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
  }
  async delete(keys: string | string[]) {
    for (const k of [keys].flat()) this.store.delete(k);
  }
}

const source = (version = 2): CaptionDraft => ({
  v: 1,
  videoId: 'v1',
  language: 'ar',
  version,
  kind: 'source',
  origin: 'transcription',
  edited: true,
  cues: [
    { id: 'c1', startMs: 0, endMs: 4000, segments: [{ type: 'speech', text: 'قال الشيخ في درس اليوم كلامًا طيبًا' }] },
    { id: 'c2', startMs: 4000, endMs: 9000, segments: [{ type: 'speech', text: 'قال الله تعالى' }, { type: 'quran', range: '112:1:1-112:4:5', status: 'confirmed', heard: 'قل هو الله احد' } as never] },
    { id: 'c3', startMs: 9000, endMs: 12000, segments: [{ type: 'quran', range: '1:1:1-1:1:4', status: 'confirmed' }] },
  ],
  createdAt: '2026-11-14T00:00:00.000Z',
  updatedAt: '2026-11-14T00:00:00.000Z',
  updatedBy: 'owner',
});

function setup(videosStatus: (path: string) => number = () => 200) {
  const subtitles = new Bucket();
  subtitles.set(captionDraftKey('v1', 'ar'), JSON.stringify(source()));
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const sent: Array<{ message: { type: number; payload: CaptionTranslatePayload }; options?: { delaySeconds?: number } }> = [];
  const env = {
    REPORTS_DB: {} as never,
    REVIEW_MEDIA: new Bucket(),
    subtitles,
    VIDEOS: {
      fetch: async (url: RequestInfo, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, body: JSON.parse(String(init?.body)) });
        return new Response('{}', { status: videosStatus(path) });
      },
    },
    MESSAGE_QUEUE: { send: async (message: never, options?: { delaySeconds?: number }) => void sent.push({ message, ...(options ? { options } : {}) }) },
    INTERNAL_API_KEY: 'internal',
    ERRORS_INGEST_URL: 'https://admin.example/internal/errors',
  };
  return { env, calls, sent, subtitles, media: env.REVIEW_MEDIA };
}

const payload = (over: Partial<CaptionTranslatePayload> = {}): CaptionTranslatePayload => ({
  jobId: JOB,
  videoId: 'v1',
  sourceLanguage: 'ar',
  sourceVersion: 2,
  language: 'en',
  replace: false,
  requestedBy: 'owner',
  nextBatch: 0,
  provider: 'workers-ai',
  model: '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  fallbackModel: '@cf/google/gemma-4-26b-a4b-it',
  dailyBudgetUsd: 1,
  requestedAt: '2026-11-14T00:00:00.000Z',
  ...over,
});
const message = (p: unknown = payload(), attempts = 1) => ({ body: { id: 'm', type: MessageType.CaptionTranslate, payload: p }, attempts, ack: jest.fn(), retry: jest.fn() });

/** Answers each call from a list (then repeats the last), recording the models asked. */
const scripted = (answers: Array<(items: Array<{ id: string; text: string }>) => unknown[] | null>): Translator & { models: string[] } => {
  const models: string[] = [];
  return {
    provider: 'workers-ai',
    models,
    async translate(batch, _from, _to, _ctx, model, usage) {
      models.push(model);
      usage.push({ model, inputUnits: 100, outputUnits: 100 });
      const answer = answers[Math.min(models.length - 1, answers.length - 1)]!;
      return answer(batch.items);
    },
  };
};
const good = (items: Array<{ id: string; text: string }>) => items.map((i) => ({ id: i.id, text: `${'The sheikh said kind words today '.slice(0, Math.max(10, i.text.replace(/⟦Q\d+⟧/g, '').length))} ${(i.text.match(/⟦Q\d+⟧/g) ?? []).join(' ')}`.trim() }));

beforeEach(() => {
  (reserveBudget as jest.Mock).mockResolvedValue(true);
  globalThis.fetch = jest.fn(async () => new Response('{}')) as never;
});

async function drain(env: ReturnType<typeof setup>['env'], sent: ReturnType<typeof setup>['sent'], translator: Translator) {
  let m = message();
  for (let i = 0; i < 5; i++) {
    await processCaptionTranslateMessages([m], env, undefined, logger, { translator });
    expect(m.ack).toHaveBeenCalled();
    const next = sent.at(-1);
    if (!next || next.message.payload.nextBatch <= (m.body.payload as CaptionTranslatePayload).nextBatch) break;
    m = message(next.message.payload);
  }
}

describe('caption translate consumer', () => {
  it('translates batch by batch, keeps Quran as references and writes the translation draft', async () => {
    const { env, calls, sent, subtitles, media } = setup();
    await drain(env, sent, new FixtureTranslator());
    const draft = subtitles.read<CaptionDraft>(captionDraftKey('v1', 'en'))!;
    expect(draft).toMatchObject({ kind: 'translation', origin: 'translation', sourceLanguage: 'ar', sourceVersion: 2, version: 1, edited: false, machine: { provider: 'fixture' } });
    // The Quran segment is the same reference; `heard` (ASR text) never travels
    expect(draft.cues[1]!.segments).toEqual([expect.objectContaining({ type: 'speech' }), { type: 'quran', range: '112:1:1-112:4:5', status: 'confirmed' }]);
    // A Quran-only cue is never sent to a model and stays as it was
    expect(draft.cues[2]!.segments).toEqual([{ type: 'quran', range: '1:1:1-1:1:4', status: 'confirmed' }]);
    expect(JSON.stringify(draft)).not.toContain('قال');
    expect(calls.at(-1)).toEqual({ path: `/internal/captions/jobs/${JOB}/finish`, body: { outcome: 'ready', minutesUsed: 0 } });
    expect(calls.map((c) => c.body.status).filter(Boolean)).toEqual(['translating', 'postprocessing']);
    expect(media.read(captionTranslateWorkKey(JOB))).toBeNull();
  });

  it('a failed check retries the model, then the fallback model', async () => {
    const { env, sent, subtitles } = setup();
    const t = scripted([() => null, (items) => items.map((i) => ({ id: i.id, text: 'نص عربي خاطئ تمامًا هنا' })), good]);
    await drain(env, sent, t);
    expect(t.models).toEqual(['@cf/deepseek-ai/deepseek-v4.1-flash-1017', '@cf/deepseek-ai/deepseek-v4.1-flash-1017', '@cf/google/gemma-4-26b-a4b-it']);
    expect(subtitles.read<CaptionDraft>(captionDraftKey('v1', 'en'))!.machine).toEqual({ provider: 'workers-ai', model: '@cf/google/gemma-4-26b-a4b-it' });
  });

  it('a lost Quran token fails the check (never a translated ayah)', async () => {
    const { env, sent } = setup();
    const t = scripted([(items) => items.map((i) => ({ id: i.id, text: 'Say: He is Allah, the One and Only, said the sheikh' }))]);
    const m = message();
    await processCaptionTranslateMessages([m], env, undefined, logger, { translator: t });
    expect(t.models).toHaveLength(3);
    expect(m.retry).toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('waits for tomorrow when the caption budget is spent', async () => {
    const { env, sent, calls } = setup();
    (reserveBudget as jest.Mock).mockResolvedValue(false);
    const m = message();
    await processCaptionTranslateMessages([m], env, undefined, logger, { translator: new FixtureTranslator() });
    expect(sent[0]!.options).toEqual({ delaySeconds: BUDGET_WAIT_SECONDS });
    expect(sent[0]!.message.payload.nextBatch).toBe(0);
    expect(calls[0]!.body).toEqual({ status: 'waiting_budget', done: 0, total: 1 });
  });

  it('source edited and its version not kept → source_changed; the kept copy of a published version is used', async () => {
    const one = setup();
    one.subtitles.set(captionDraftKey('v1', 'ar'), JSON.stringify(source(3)));
    await processCaptionTranslateMessages([message()], one.env, undefined, logger, { translator: new FixtureTranslator() });
    expect(one.calls.at(-1)!.body).toEqual({ outcome: 'failed', error: 'source_changed' });

    const two = setup();
    two.subtitles.set(captionDraftKey('v1', 'ar'), JSON.stringify(source(3)));
    two.subtitles.set(captionDraftVersionKey('v1', 'ar', 2), JSON.stringify(source(2)));
    expect((await readSource(two.subtitles, payload()))!.version).toBe(2);
  });

  it('an existing draft in the target language is kept unless replace was asked', async () => {
    const one = setup();
    one.subtitles.set(captionDraftKey('v1', 'en'), JSON.stringify({ ...source(4), language: 'en' }));
    await drain(one.env, one.sent, new FixtureTranslator());
    expect(one.calls.at(-1)!.body).toEqual({ outcome: 'failed', error: 'draft_exists' });

    const two = setup();
    two.subtitles.set(captionDraftKey('v1', 'en'), JSON.stringify({ ...source(4), language: 'en' }));
    const m = message(payload({ replace: true }));
    await processCaptionTranslateMessages([m], two.env, undefined, logger, { translator: new FixtureTranslator() });
    await processCaptionTranslateMessages([message(two.sent[0]!.message.payload)], two.env, undefined, logger, { translator: new FixtureTranslator() });
    expect(two.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'en'))).toMatchObject({ kind: 'translation', version: 5 });
  });

  it('stops quietly when api-videos says the job was cancelled', async () => {
    const { env, sent } = setup(() => 409);
    const m = message();
    await processCaptionTranslateMessages([m], env, undefined, logger, { translator: new FixtureTranslator() });
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('the last attempt fails the job and flags the admin with a Retry', async () => {
    const { env, calls } = setup();
    const broken: Translator = { provider: 'workers-ai', translate: async () => { throw new Error('capacity'); } };
    const last = message(payload(), CAPTION_JOB_LAST_ATTEMPT);
    await processCaptionTranslateMessages([last], env, undefined, logger, { translator: broken });
    expect(last.ack).toHaveBeenCalled();
    expect(calls.at(-1)).toEqual({ path: `/internal/captions/jobs/${JOB}/finish`, body: { outcome: 'failed', error: 'translation_failed' } });
    const report = JSON.parse(String((globalThis.fetch as jest.Mock).mock.calls.at(-1)[1].body));
    expect(report.events[0].action).toMatchObject({ key: `caption-job:${JOB}`, title: 'Caption translation failed', retry: { path: '/internal/captions/jobs/retry', body: { jobId: JOB } } });
  });

  it('validates the payload', () => {
    expect(isCaptionTranslatePayload(payload())).toBe(true);
    expect(isCaptionTranslatePayload(payload({ language: 'ar' }))).toBe(false);
    expect(isCaptionTranslatePayload(payload({ model: 'https://evil' }))).toBe(false);
    expect(isCaptionTranslatePayload(payload({ sourceVersion: 0 }))).toBe(false);
    expect(isCaptionTranslatePayload(payload({ source: 'published' }))).toBe(true);
    expect(isCaptionTranslatePayload(payload({ source: 'draft' }))).toBe(true);
    expect(isCaptionTranslatePayload(payload({ source: 'elsewhere' as never }))).toBe(false);
  });
});

describe('translating a published track (TA-20)', () => {
  const index = new QuranIndex(QuranIndex.build(miniQuranRows(), 'v-test', new Date().toISOString()));
  /** An imported sidecar as stored: speech, then Al-Ikhlas recited in full (no markers: it is a file). */
  const SIDECAR = ['WEBVTT', '', '1', '00:00:00.000 --> 00:00:04.000', '‏قال الشيخ في درس اليوم كلامًا طيبًا', '', '2', '00:00:04.000 --> 00:00:12.000', '‏قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له كفوا أحد', ''].join('\n');
  const QURAN_WORDS = /قل هو الله|الصمد|يولد|كفوا/;

  function published(vtt: string) {
    const s = setup();
    s.subtitles.store.delete(captionDraftKey('v1', 'ar'));
    s.media.set(captionPublishedSourceKey(JOB), vtt);
    return s;
  }
  const recording = () => {
    const seen: string[] = [];
    const t: Translator = { provider: 'workers-ai', async translate(batch, _f, _t, _c, model, usage) {
      usage.push({ model, inputUnits: 1, outputUnits: 1 });
      seen.push(...batch.items.map((i) => i.text), ...batch.context.map((i) => i.text));
      return good(batch.items);
    } };
    return { t, seen };
  };
  async function run(s: ReturnType<typeof setup>, translator: Translator, quranIndex: () => Promise<QuranIndex | null> = async () => index) {
    let m = message(payload({ source: 'published', sourceVersion: 1 }));
    for (let i = 0; i < 5; i++) {
      await processCaptionTranslateMessages([m], s.env, undefined, logger, { translator, quranIndex });
      const next = s.sent.at(-1);
      if (!next || next.message.payload.nextBatch <= (m.body.payload as CaptionTranslatePayload).nextBatch) return m;
      m = message(next.message.payload);
    }
    return m;
  }

  it('a sidecar: the Quran matcher finds the recitation, which stays a reference and never reaches the model', async () => {
    const s = published(SIDECAR);
    const { t, seen } = recording();
    await run(s, t);
    const draft = s.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'en'))!;
    expect(draft).toMatchObject({ kind: 'translation', origin: 'translation', sourceLanguage: 'ar', sourceTrack: 'published', edited: false, machine: { provider: 'workers-ai' } });
    expect(draft.sourceVersion).toBeUndefined();
    const quran = draft.cues.flatMap((c) => c.segments).filter((x) => x.type === 'quran');
    expect(quran).toEqual([expect.objectContaining({ type: 'quran', range: expect.stringMatching(/^112:1:1-112:4:\d+$/) })]);
    expect(seen.join(' ')).not.toMatch(QURAN_WORDS);
    expect(seen.join(' ')).toContain('قال الشيخ');
    expect(JSON.stringify(draft)).not.toMatch(QURAN_WORDS);
    expect(s.calls.at(-1)).toEqual({ path: `/internal/captions/jobs/${JOB}/finish`, body: { outcome: 'ready', minutesUsed: 0 } });
    // The sidecar is never touched: no draft is made in its language
    expect(s.subtitles.read(captionDraftKey('v1', 'ar'))).toBeNull();
    expect(s.media.read(captionSourceWorkKey(JOB))).toBeNull();
  });

  it('a track published from a draft keeps its Quran spans as references, without the matcher', async () => {
    const s = published(renderCaptionVtt(source(2)));
    const { t, seen } = recording();
    const noIndex = jest.fn(async () => null);
    await run(s, t, noIndex);
    expect(noIndex).not.toHaveBeenCalled();
    const draft = s.subtitles.read<CaptionDraft>(captionDraftKey('v1', 'en'))!;
    expect(draft.cues.flatMap((c) => c.segments).filter((x) => x.type === 'quran')).toEqual([
      { type: 'quran', range: '112:1:1-112:4:5', status: 'review' },
      { type: 'quran', range: '1:1:1-1:1:4', status: 'review' },
    ]);
    expect(seen.join(' ')).not.toMatch(QURAN_WORDS);
  });

  it('every batch reads the same cues: the processor writes them once', async () => {
    const s = published(SIDECAR);
    const first = await readPublishedSource(s.media, payload({ source: 'published', sourceVersion: 1 }), async () => index, Date.now());
    s.media.set(captionPublishedSourceKey(JOB), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nchanged\n');
    const again = await readPublishedSource(s.media, payload({ source: 'published', sourceVersion: 1 }), async () => null, Date.now());
    expect(again).toEqual(first);
    expect(first!.cues.some((c) => c.segments.some((x) => x.type === 'quran'))).toBe(true);
  });

  it('no fresh Quran copy: retried, never translated as speech', async () => {
    const s = published(SIDECAR);
    const { t, seen } = recording();
    const m = message(payload({ source: 'published', sourceVersion: 1 }));
    await processCaptionTranslateMessages([m], s.env, undefined, logger, { translator: t, quranIndex: async () => null });
    expect(m.retry).toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('the copy gone: source_missing', async () => {
    const s = setup();
    await processCaptionTranslateMessages([message(payload({ source: 'published', sourceVersion: 1 }))], s.env, undefined, logger, { translator: new FixtureTranslator(), quranIndex: async () => index });
    expect(s.calls.at(-1)!.body).toEqual({ outcome: 'failed', error: 'source_missing' });
  });

  it('the last attempt flags the admin with the source in the item', async () => {
    const s = published(SIDECAR);
    const broken: Translator = { provider: 'workers-ai', translate: async () => { throw new Error('capacity'); } };
    await processCaptionTranslateMessages([message(payload({ source: 'published', sourceVersion: 1 }), CAPTION_JOB_LAST_ATTEMPT)], s.env, undefined, logger, { translator: broken, quranIndex: async () => index });
    const report = JSON.parse(String((globalThis.fetch as jest.Mock).mock.calls.at(-1)[1].body));
    expect(report.events[0].action).toMatchObject({ key: `caption-job:${JOB}`, retry: { path: '/internal/captions/jobs/retry', body: { jobId: JOB } } });
    expect(JSON.stringify(report.events[0])).toContain('published');
  });
});

describe('translators', () => {
  it('real providers refuse to run under test (no AI spend in tests)', () => {
    expect(() => new WorkersAiTranslator({ run: jest.fn() }, {})).toThrow(/Refusing/);
    expect(() => new DeepLTranslator('key', {})).toThrow(/Refusing/);
  });

  it('fixture mode never reaches a model; DeepL without a key is Workers AI', async () => {
    expect((await translatorFor({ TRANSLATION_PROVIDER: 'fixture' }, 'deepl')).provider).toBe('fixture');
    await expect(translatorFor({ AI: { run: jest.fn() } }, 'deepl')).rejects.toThrow(/Refusing/);
  });
});
