/**
 * Transcript translation in the processor (AUN-CAPTIONS §5.7): one cue batch per delivery, Quran
 * spans kept as references (never machine-translated), a failed check retries the model and then
 * the fallback, the budget wait, and the translated draft. Fixture and fake translators only: no AI.
 */
jest.mock('../moderation/budget', () => ({ reserveBudget: jest.fn(async () => true), settleBudget: jest.fn(async () => undefined) }));
jest.mock('../moderation/usage', () => ({ recordUsage: jest.fn(async () => 10) }));

import { MessageType, captionDraftKey, captionDraftVersionKey, captionTranslateWorkKey, type CaptionDraft, type CaptionTranslatePayload } from '@al-ummah/shared-types';
import { reserveBudget } from '../moderation/budget';
import { BUDGET_WAIT_SECONDS, CAPTION_JOB_LAST_ATTEMPT } from '../captions/job';
import { isCaptionTranslatePayload, processCaptionTranslateMessages, readSource } from '../captions/translate';
import { DeepLTranslator, DeeplError, FixtureTranslator, WorkersAiTranslator, deeplKey, resetDeeplFlags, translatorFor, type Translator } from '../captions/translator';
import { sealServiceCredential } from '@al-ummah/shared-types';

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

  it('DeepL refusing the key flags the admin once (Retry tests the key) and the job goes on with Workers AI (DEEPL-KEY)', async () => {
    resetDeeplFlags();
    const { env, sent, subtitles } = setup();
    const deeplCalls: number[] = [];
    const refused: Translator = { provider: 'deepl', translate: async () => { deeplCalls.push(1); throw new DeeplError(403); } };
    const fallback = scripted([good]);
    let m = message(payload({ provider: 'deepl', model: 'deepl-pro' }));
    for (let i = 0; i < 5; i++) {
      await processCaptionTranslateMessages([m], env, undefined, logger, { translator: refused, fallback });
      expect(m.ack).toHaveBeenCalled();
      const next = sent.at(-1);
      if (!next || next.message.payload.nextBatch <= (m.body.payload as CaptionTranslatePayload).nextBatch) break;
      m = message(next.message.payload);
    }
    // One DeepL try per batch, then straight to the Workers AI fallback model (no second DeepL try)
    expect(deeplCalls.length).toBeGreaterThan(0);
    expect(fallback.models.every((model) => model === '@cf/google/gemma-4-26b-a4b-it')).toBe(true);
    expect(subtitles.read<CaptionDraft>(captionDraftKey('v1', 'en'))!.machine).toEqual({ provider: 'workers-ai', model: '@cf/google/gemma-4-26b-a4b-it' });
    const reports = (globalThis.fetch as jest.Mock).mock.calls.map((c) => JSON.parse(String(c[1].body))).filter((b) => b.events?.[0]?.action?.key === 'deepl-key');
    expect(reports).toHaveLength(1);
    expect(reports[0].events[0].action).toMatchObject({ key: 'deepl-key', source: 'ai', title: 'DeepL refused the API key', itemUrl: '/captions-settings#deepl-key', retry: { kind: 'builtin', handler: 'deepl-key-test' } });
  });

  it('used-up DeepL characters (456) flag the admin; a DeepL outage (503) only falls back', async () => {
    resetDeeplFlags();
    for (const status of [456, 503]) {
      (globalThis.fetch as jest.Mock).mockClear();
      const { env, sent } = setup();
      const failing: Translator = { provider: 'deepl', translate: async () => { throw new DeeplError(status); } };
      const m = message(payload({ provider: 'deepl', model: 'deepl-pro' }));
      await processCaptionTranslateMessages([m], env, undefined, logger, { translator: failing, fallback: scripted([good]) });
      expect(m.ack).toHaveBeenCalled();
      expect(sent.at(-1)!.message.payload.nextBatch).toBe(1);
      const flagged = (globalThis.fetch as jest.Mock).mock.calls.map((c) => JSON.parse(String(c[1].body))).filter((b) => b.events?.[0]?.action?.key === 'deepl-key');
      expect(flagged.map((b) => b.events[0].action.title)).toEqual(status === 456 ? ["DeepL's character limit is used up"] : []);
    }
  });

  it('validates the payload', () => {
    expect(isCaptionTranslatePayload(payload())).toBe(true);
    expect(isCaptionTranslatePayload(payload({ language: 'ar' }))).toBe(false);
    expect(isCaptionTranslatePayload(payload({ model: 'https://evil' }))).toBe(false);
    expect(isCaptionTranslatePayload(payload({ sourceVersion: 0 }))).toBe(false);
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

describe('DeepL key and hosts (DEEPL-KEY; DeepL mocked)', () => {
  const MASTER = 'internal-api-key-for-tests-0123456789';
  const db = (row: unknown) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) }) as never;

  it('the admin’s sealed key wins over the bound secret; an unreadable one falls back to it', async () => {
    const sealed = await sealServiceCredential('deepl', '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b', MASTER);
    const row = { provider: 'deepl', ...sealed };
    expect(await deeplKey({ SEARCH_DB: db(row), INTERNAL_API_KEY: MASTER, AI_KEY_DEEPL: 'bound-key-000000000000' })).toBe('0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
    expect(await deeplKey({ SEARCH_DB: db(row), INTERNAL_API_KEY: 'rotated-internal-key-0000', AI_KEY_DEEPL: 'bound-key-000000000000' })).toBe('bound-key-000000000000');
    expect(await deeplKey({ SEARCH_DB: db(null), INTERNAL_API_KEY: MASTER })).toBeNull();
    // A key found means DeepL (whose guard refuses under test); none means Workers AI (no AI binding here)
    await expect(translatorFor({ SEARCH_DB: db(row), INTERNAL_API_KEY: MASTER }, 'deepl')).rejects.toThrow(/Refusing/);
    await expect(translatorFor({ SEARCH_DB: db(null), INTERNAL_API_KEY: MASTER }, 'deepl')).rejects.toThrow(/AI binding missing/);
  });

  it('Free keys (":fx") call api-free.deepl.com, Pro keys api.deepl.com; 403 and 456 are DeeplErrors', async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, CI: process.env.CI, E2E_ENV: process.env.E2E_ENV };
    // The guard reads process.env: lift it for this test only; every call goes to the mock below
    process.env.NODE_ENV = 'development';
    delete process.env.CI;
    delete process.env.E2E_ENV;
    try {
      const seen: string[] = [];
      const answer = (status: number) =>
        (async (url: RequestInfo) => {
          seen.push(String(url));
          return new Response(JSON.stringify({ translations: [{ text: 'Hello' }] }), { status });
        }) as typeof fetch;
      const batch = { items: [{ id: 'a', text: 'مرحبا', quran: [] }], context: [] } as never;
      const usage: never[] = [];
      await new DeepLTranslator('0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b:fx', {}, answer(200)).translate(batch, 'ar', 'en', {}, 'deepl-pro', usage);
      await new DeepLTranslator('0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b', {}, answer(200)).translate(batch, 'ar', 'en', {}, 'deepl-pro', usage);
      expect(seen).toEqual(['https://api-free.deepl.com/v2/translate', 'https://api.deepl.com/v2/translate']);
      await expect(new DeepLTranslator('k:fx', {}, answer(403)).translate(batch, 'ar', 'en', {}, 'deepl-pro', usage)).rejects.toMatchObject({ code: 'invalid', status: 403 });
      await expect(new DeepLTranslator('k:fx', {}, answer(456)).translate(batch, 'ar', 'en', {}, 'deepl-pro', usage)).rejects.toMatchObject({ code: 'quota', status: 456 });
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
