/**
 * AI category suggestions: the pure rules (mapping, thresholds, never over a
 * person's choice) and the queued job against the real D1 schemas (SEARCH_DB
 * from api-videos, REPORTS_DB from admin-api, node:sqlite) with a MOCKED
 * Workers AI binding and an in-memory R2 bucket with etags.
 */
import { join } from 'path';
import { createLogger } from '@al-ummah/logger';
import {
  CATEGORY_MODEL,
  CATEGORY_TEST_HOOK_MODEL,
  MessageType,
  VideoCategory,
  buildCategoryText,
  draftSubjectId,
  categoryPatchForVideo,
  decideCategory,
  getCategorySuggestion,
  mapCategory,
  markCategorySuggestionPending,
  parseCategoryResponse,
  recordCategoryOutcome,
  adoptDraftSuggestion,
  resolveCategorizeConfig,
  testHookScores,
  toSuggestionView,
  vttToText,
  type SearchDb,
} from '@al-ummah/shared-types';
import { handleCategorySuggest, type CasBucket, type CategorizeEnv } from '../categorize/job';
import { processCategorizeMessages, retryDelaySeconds, sweepCategorySuggestions, STALE_PENDING_MS } from '../categorize/queue';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

const SEARCH_MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'api-videos', 'migrations', 'search');
const logger = createLogger('processor-test', { logLevel: 'error' });
const NOW = Date.parse('2026-11-09T12:00:00Z');

// ---------- pure rules ----------

describe('category mapping', () => {
  it('maps values, English and Arabic labels and common aliases', () => {
    expect(mapCategory('fiqh')).toBe(VideoCategory.FIQH);
    expect(mapCategory('Friday Sermon')).toBe(VideoCategory.KHUTBAH);
    expect(mapCategory('Hajj & Umrah')).toBe(VideoCategory.HAJJ_UMRAH);
    expect(mapCategory('تفسير القرآن')).toBe(VideoCategory.QURAN_TAFSIR);
    expect(mapCategory('العقيدة')).toBe(VideoCategory.AQEEDAH);
    expect(mapCategory('Tafseer')).toBe(VideoCategory.QURAN_TAFSIR);
    expect(mapCategory('quran-recitation')).toBe(VideoCategory.QURAN_RECITATION);
    expect(mapCategory('cooking')).toBeNull();
    expect(mapCategory(42)).toBeNull();
  });

  it('parses JSON answers: fenced, 0-100 scale, duplicates, unknown names dropped, best first', () => {
    const scores = parseCategoryResponse({
      response: '```json\n{"top":[{"category":"Hadith","confidence":40},{"category":"hadith_studies","confidence":0.7},{"category":"cooking","confidence":0.9},{"category":"fiqh","confidence":"0.2"}]}\n```',
    });
    expect(scores).toEqual([
      { category: VideoCategory.HADITH_STUDIES, confidence: 0.7 },
      { category: VideoCategory.FIQH, confidence: 0.2 },
    ]);
    expect(parseCategoryResponse({ response: { category: 'ramadan', confidence: 150 } })).toEqual([{ category: VideoCategory.RAMADAN, confidence: 1 }]);
    expect(parseCategoryResponse({ response: '{"top":[{"category":"ramadan","confidence":"85%"}]}' })[0].confidence).toBe(0.85);
  });

  it('refuses an answer with no known category (the job retries)', () => {
    expect(() => parseCategoryResponse({ response: '{"top":[{"category":"cooking","confidence":0.9}]}' })).toThrow(/no known category/);
    expect(() => parseCategoryResponse({ response: 'I think it is about fiqh' })).toThrow(/no JSON/);
  });
});

describe('thresholds and the write rule', () => {
  const confident = [{ category: VideoCategory.FIQH, confidence: 0.82 }, { category: VideoCategory.ISLAMIC_LECTURES, confidence: 0.1 }];
  const unsure = [{ category: VideoCategory.DAWAH, confidence: 0.45 }, { category: VideoCategory.ISLAMIC_LECTURES, confidence: 0.3 }, { category: VideoCategory.FIQH, confidence: 0.1 }];

  it('preselects at or above the threshold, otherwise offers the top options', () => {
    expect(decideCategory(confident)).toEqual({ preselect: VideoCategory.FIQH, options: confident, lowConfidence: false });
    expect(decideCategory(unsure)).toEqual({ preselect: null, options: unsure, lowConfidence: true });
    expect(decideCategory([{ category: VideoCategory.FIQH, confidence: 0.6 }]).preselect).toBe(VideoCategory.FIQH);
    expect(decideCategory(unsure, 0.4).preselect).toBe(VideoCategory.DAWAH);
  });

  it('never overrides the uploader, an admin, or a category set before sources were recorded', () => {
    expect(categoryPatchForVideo({ category: 'ramadan', categorySource: 'uploader' }, confident, 'backfill')).toBeNull();
    expect(categoryPatchForVideo({ category: 'ramadan', categorySource: 'admin' }, confident, 'upload')).toBeNull();
    expect(categoryPatchForVideo({ category: 'ramadan' }, confident, 'backfill')).toBeNull();
    expect(categoryPatchForVideo({ categorySource: 'uploader' }, confident, 'backfill')).toBeNull();
  });

  it('upload writes only a confident suggestion and clears a stale AI category; backfill writes the top choice', () => {
    expect(categoryPatchForVideo({}, confident, 'upload')).toEqual({ category: VideoCategory.FIQH, categorySource: 'ai' });
    expect(categoryPatchForVideo({}, unsure, 'upload')).toBeNull();
    expect(categoryPatchForVideo({ category: 'fiqh', categorySource: 'ai' }, unsure, 'upload')).toEqual({ category: null, categorySource: null });
    expect(categoryPatchForVideo({}, unsure, 'backfill')).toEqual({ category: VideoCategory.DAWAH, categorySource: 'ai' });
    expect(categoryPatchForVideo({ category: 'fiqh', categorySource: 'ai' }, confident, 'upload')).toBeNull();
  });

  it('config: on by default, env kill switch, admin cap and threshold override env', () => {
    expect(resolveCategorizeConfig(undefined, {})).toEqual({ enabled: true, dailyNeuronCap: 20000, threshold: 0.6, envEnabled: true });
    expect(resolveCategorizeConfig({ enabled: false, dailyNeuronCap: 5, threshold: 0.7 }, { enabled: 'false', cap: '99' })).toEqual({ enabled: false, dailyNeuronCap: 5, threshold: 0.7, envEnabled: false });
    expect(resolveCategorizeConfig({}, { cap: '1234' }).dailyNeuronCap).toBe(1234);
  });

  it('builds labelled, clipped, de-duplicated text and strips WebVTT', () => {
    const text = buildCategoryText({ title: 'شرح حديث', titleLocalized: { ar: 'شرح حديث', en: 'Hadith explained' }, description: '  ', tags: ['hadith', ' '], transcript: 'x'.repeat(5000) });
    expect(text).toContain('Title: شرح حديث');
    expect(text).toContain('Title (en): Hadith explained');
    expect(text).not.toContain('Title (ar)');
    expect(text).toContain('Tags: hadith');
    expect(text.length).toBeLessThan(3200);
    expect(buildCategoryText({ title: ' ', tags: [] })).toBe('');
    // Only Arabic and English are read, and the whole text is bounded whatever is sent
    const many = buildCategoryText({ titleLocalized: { fr: 'Titre', ar: 'عنوان' } as Record<string, string>, descriptionLocalized: { en: 'd'.repeat(9000), de: 'x' } as Record<string, string>, tags: Array.from({ length: 80 }, (_, i) => `${i}-${'t'.repeat(200)}`), transcript: 'y'.repeat(9000) });
    expect(many).toContain('Title (ar): عنوان');
    expect(many).not.toContain('Titre');
    expect(many).not.toContain('(de)');
    expect(many.length).toBeLessThanOrEqual(8000);
    expect(vttToText('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v Speaker>بسم الله</v>\n\nNOTE x\n')).toBe('بسم الله');
  });

  it('test hook: [e2e-category:<value>] and [e2e-category:low]', () => {
    expect(testHookScores('Title: lecture [e2e-category:fiqh]')?.[0]).toEqual({ category: VideoCategory.FIQH, confidence: 0.95 });
    expect(decideCategory(testHookScores('[e2e-category:low]')!).lowConfidence).toBe(true);
    expect(testHookScores('no marker')).toBeNull();
  });
});

// ---------- the job ----------

function memoryBucket(initial: Record<string, unknown> = {}) {
  const store = new Map<string, { body: string; etag: string; uploaded: Date }>();
  let n = 0;
  const put = (key: string, body: string) => {
    const entry = { body, etag: `e${++n}`, uploaded: new Date(NOW + n) };
    store.set(key, entry);
    return entry;
  };
  for (const [key, value] of Object.entries(initial)) put(key, typeof value === 'string' ? value : JSON.stringify(value));
  const bucket: CasBucket & { store: typeof store; json(key: string): Record<string, unknown>; puts: number } = {
    store,
    puts: 0,
    json: (key) => JSON.parse(store.get(key)!.body),
    async get(key) {
      const entry = store.get(key);
      return entry ? { etag: entry.etag, uploaded: entry.uploaded, text: async () => entry.body } : null;
    },
    async put(key, value, options) {
      const current = store.get(key);
      if (options?.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
      bucket.puts++;
      return { uploaded: put(key, value).uploaded };
    },
  };
  return bucket;
}

function mockAi(response: unknown = { response: '{"top":[{"category":"hadith_studies","confidence":0.88},{"category":"islamic_lectures","confidence":0.08}]}', usage: { prompt_tokens: 900, completion_tokens: 40 } }) {
  return {
    run: jest.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  };
}

const VIDEO = { id: 'v1', title: 'شرح حديث إنما الأعمال بالنيات', description: 'درس في شرح الأربعين النووية', tags: ['حديث'], isPublic: true, uploadStatus: 'ready', userId: 'u1', channelId: 'c1', dateCreated: '2026-11-01T00:00:00Z' };

function setup(opts: { videos?: Record<string, unknown>; ai?: ReturnType<typeof mockAi> | null; cap?: number; config?: Record<string, unknown>; env?: Partial<CategorizeEnv> } = {}) {
  const reports = createSqliteD1(REPORTS_MIGRATIONS_DIR);
  const search = createSqliteD1(SEARCH_MIGRATIONS_DIR);
  const config = { ...(opts.config ?? {}), ...(opts.cap !== undefined ? { dailyNeuronCap: opts.cap } : {}) };
  if (Object.keys(config).length) {
    reports.raw.prepare('INSERT INTO moderation_config (key, value, updated_at) VALUES (?, ?, ?)').run('categorize', JSON.stringify(config), 'now');
  }
  const videos = memoryBucket(opts.videos ?? { v1: VIDEO });
  const subtitles = memoryBucket({});
  const ai = opts.ai === null ? undefined : opts.ai ?? mockAi();
  const env: CategorizeEnv = { REPORTS_DB: reports, SEARCH_DB: search, videos, subtitles, AI: ai, AI_CATEGORIZE_ENABLED: 'true', ...opts.env };
  const db = search as unknown as SearchDb;
  return { reports, search, db, videos, subtitles, ai, env };
}

const videoJob = (subjectId = 'v1', reason: 'upload' | 'backfill' | 'edit' | 'retry' = 'upload') => ({ subjectId, subjectType: 'video' as const, reason });

describe('category suggestion job', () => {
  it('suggests, writes a confident category onto the video, indexes it and records usage', async () => {
    const { db, env, videos, search, reports, ai } = setup();
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', userId: 'u1', now: NOW });

    const outcome = await handleCategorySuggest(videoJob(), env, logger, { lastAttempt: false, now: NOW });
    expect(outcome).toMatchObject({ status: 'done', result: 'model', category: 'hadith_studies', applied: true });
    expect(ai!.run).toHaveBeenCalledWith(CATEGORY_MODEL, expect.objectContaining({ temperature: 0 }), undefined);
    const prompt = (ai!.run.mock.calls[0] as unknown[])[1] as { messages: Array<{ content: string }> };
    expect(prompt.messages[0].content).toContain('hadith_studies: Hadith Studies / دراسات الحديث');
    expect(prompt.messages[1].content).toContain('<video>');

    expect(videos.json('v1')).toMatchObject({ category: 'hadith_studies', categorySource: 'ai', title: VIDEO.title });
    const indexed = search.raw.prepare('SELECT category FROM search_videos WHERE id = ?').get('v1');
    expect(indexed).toEqual({ category: 'hadith_studies' });

    const row = (await getCategorySuggestion(db, 'v1'))!;
    expect(row).toMatchObject({ status: 'done', category: 'hadith_studies', confidence: 0.88, model: CATEGORY_MODEL, applied: 1, previous_category: null, threshold: 0.6 });
    expect(toSuggestionView(row)).toMatchObject({ preselect: 'hadith_studies', lowConfidence: false });

    const usage = reports.raw.prepare("SELECT feature, calls FROM ai_usage_daily WHERE feature = 'categorize'").get();
    expect(usage).toEqual({ feature: 'categorize', calls: 1 });
    const budget = reports.raw.prepare("SELECT reserved FROM ai_budget_daily WHERE feature = 'categorize'").get() as { reserved: number };
    expect(budget.reserved).toBeGreaterThan(0);
  });

  it('includes Arabic/English captions in the text', async () => {
    const { db, env, subtitles, ai } = setup({ videos: { v1: { ...VIDEO, subtitles: [{ language: 'ar', isDefault: true, status: 'ready' }] } } });
    await subtitles.put('v1/ar.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nقال رسول الله صلى الله عليه وسلم');
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    await handleCategorySuggest(videoJob(), env, logger, { lastAttempt: false, now: NOW });
    const prompt = (ai!.run.mock.calls[0] as unknown[])[1] as { messages: Array<{ content: string }> };
    expect(prompt.messages[1].content).toContain('Captions excerpt: قال رسول الله');
  });

  it('upload: low confidence writes nothing and offers the top options', async () => {
    const { db, env, videos } = setup({ ai: mockAi({ response: '{"top":[{"category":"dawah","confidence":0.4},{"category":"islamic_lectures","confidence":0.35},{"category":"fiqh","confidence":0.1}]}' }) });
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    const outcome = await handleCategorySuggest(videoJob(), env, logger, { lastAttempt: false, now: NOW });
    expect(outcome).toMatchObject({ status: 'done', applied: false });
    expect(videos.json('v1').category).toBeUndefined();
    const view = toSuggestionView((await getCategorySuggestion(db, 'v1'))!);
    expect(view).toMatchObject({ preselect: null, lowConfidence: true });
    expect(view.options.map((o) => o.category)).toEqual(['dawah', 'islamic_lectures', 'fiqh']);
  });

  it('never overwrites the uploader\'s category', async () => {
    const { db, env, videos } = setup({ videos: { v1: { ...VIDEO, category: 'ramadan', categorySource: 'uploader' } } });
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'backfill', now: NOW });
    await handleCategorySuggest(videoJob('v1', 'backfill'), env, logger, { lastAttempt: false, now: NOW });
    expect(videos.json('v1')).toMatchObject({ category: 'ramadan', categorySource: 'uploader' });
    expect((await getCategorySuggestion(db, 'v1'))!.applied).toBe(0);
  });

  it('backfill is idempotent: a re-run and identical text reuse the stored answer (one model call)', async () => {
    const { db, env, videos, ai } = setup({
      videos: { v1: VIDEO, v2: { ...VIDEO, id: 'v2' } },
      ai: mockAi({ response: '{"top":[{"category":"hadith_studies","confidence":0.45}]}' }),
    });
    expect(await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'backfill', now: NOW }, { onlyIfAbsent: true })).toBe(true);
    expect(await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'backfill', now: NOW }, { onlyIfAbsent: true })).toBe(false);
    await markCategorySuggestionPending(db, { subjectId: 'v2', subjectType: 'video', reason: 'backfill', now: NOW }, { onlyIfAbsent: true });

    await handleCategorySuggest(videoJob('v1', 'backfill'), env, logger, { lastAttempt: false, now: NOW });
    const putsAfterFirst = videos.puts;
    // Low confidence, but a backfill writes the top choice as a reviewable suggestion
    expect(videos.json('v1')).toMatchObject({ category: 'hadith_studies', categorySource: 'ai' });

    const again = await handleCategorySuggest(videoJob('v1', 'backfill'), env, logger, { lastAttempt: false, now: NOW + 1 });
    expect(again).toMatchObject({ status: 'done', result: 'stored', applied: true });
    expect(videos.puts).toBe(putsAfterFirst);

    const twin = await handleCategorySuggest(videoJob('v2', 'backfill'), env, logger, { lastAttempt: false, now: NOW + 2 });
    expect(twin).toMatchObject({ status: 'done', result: 'cached' });
    expect(ai!.run).toHaveBeenCalledTimes(1);
  });

  it('keeps fields another writer stored meanwhile (conditional write re-reads)', async () => {
    const { db, env, videos } = setup();
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    const realPut = videos.put.bind(videos);
    let raced = false;
    videos.put = async (key, value, options) => {
      if (!raced) {
        raced = true;
        // Another worker (e.g. the legacy-channel migration) moves the video first
        await realPut(key, JSON.stringify({ ...videos.json('v1'), channelId: 'c-new' }));
      }
      return realPut(key, value, options);
    };
    await handleCategorySuggest(videoJob(), env, logger, { lastAttempt: false, now: NOW });
    expect(videos.json('v1')).toMatchObject({ channelId: 'c-new', category: 'hadith_studies', categorySource: 'ai' });
  });

  it('budget cap: no model call; the row is flagged `budget` for admin', async () => {
    const { db, env, ai, videos } = setup({ cap: 0 });
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    const outcome = await handleCategorySuggest(videoJob(), env, logger, { lastAttempt: false, now: NOW });
    expect(outcome).toEqual({ status: 'done', result: 'budget' });
    expect(ai!.run).not.toHaveBeenCalled();
    expect(videos.json('v1').category).toBeUndefined();
    expect((await getCategorySuggestion(db, 'v1'))).toMatchObject({ status: 'budget', last_error: 'daily_budget_reached' });
  });

  it('budget cap: the reservation that crosses the cap is the last one that day', async () => {
    const { db, env, ai } = setup({ cap: 1, videos: { v1: VIDEO, v2: { ...VIDEO, id: 'v2', title: 'other text' } } });
    for (const id of ['v1', 'v2']) await markCategorySuggestionPending(db, { subjectId: id, subjectType: 'video', reason: 'upload', now: NOW });
    expect(await handleCategorySuggest(videoJob('v1'), env, logger, { lastAttempt: false, now: NOW })).toMatchObject({ status: 'done', result: 'model' });
    expect(await handleCategorySuggest(videoJob('v2'), env, logger, { lastAttempt: false, now: NOW })).toEqual({ status: 'done', result: 'budget' });
    expect(ai!.run).toHaveBeenCalledTimes(1);
  });

  it('form suggestions stop at their share of the cap; uploads keep the rest', async () => {
    const { db, env, ai } = setup({ cap: 1 });
    const draftId = draftSubjectId('u1', 'form-key-123');
    await markCategorySuggestionPending(db, { subjectId: draftId, subjectType: 'draft', reason: 'draft', userId: 'u1', now: NOW });
    expect(await handleCategorySuggest({ subjectId: draftId, subjectType: 'draft', reason: 'draft', text: { title: 'Fiqh of zakat' } }, env, logger, { lastAttempt: false, now: NOW })).toEqual({ status: 'done', result: 'budget' });
    expect((await getCategorySuggestion(db, draftId))).toMatchObject({ status: 'budget', last_error: 'draft_budget_share_reached' });
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    expect(await handleCategorySuggest(videoJob('v1'), env, logger, { lastAttempt: false, now: NOW })).toMatchObject({ status: 'done', result: 'model' });
    expect(ai!.run).toHaveBeenCalledTimes(1);
  });

  it('switched off by admin: no model call, flagged `disabled`', async () => {
    const { db, env, ai } = setup({ config: { enabled: false } });
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    expect(await handleCategorySuggest(videoJob(), env, logger, { lastAttempt: false, now: NOW })).toEqual({ status: 'done', result: 'disabled' });
    expect(ai!.run).not.toHaveBeenCalled();
  });

  it('model failure: retried, then flagged `failed` on the last attempt; the video is untouched', async () => {
    const { db, env, videos } = setup({ ai: mockAi(new Error('upstream 503')) });
    await markCategorySuggestionPending(db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    expect(await handleCategorySuggest(videoJob(), env, logger, { lastAttempt: false, now: NOW })).toEqual({ status: 'retry', error: 'upstream 503' });
    expect(await getCategorySuggestion(db, 'v1')).toMatchObject({ status: 'pending', attempts: 1, last_error: 'upstream 503' });
    expect(await handleCategorySuggest(videoJob(), env, logger, { lastAttempt: true, now: NOW })).toEqual({ status: 'failed', error: 'upstream 503' });
    expect(await getCategorySuggestion(db, 'v1')).toMatchObject({ status: 'failed', attempts: 2 });
    expect(videos.json('v1').category).toBeUndefined();
  });

  it('test hook answers only when the env flag is on', async () => {
    const hooked = { v1: { ...VIDEO, title: 'Release E2E [e2e-category:fiqh]' } };
    const on = setup({ videos: hooked, env: { CATEGORY_AI_TEST_HOOK: 'true' } });
    await markCategorySuggestionPending(on.db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    expect(await handleCategorySuggest(videoJob(), on.env, logger, { lastAttempt: false, now: NOW })).toMatchObject({ result: 'test-hook', category: 'fiqh' });
    expect(on.ai!.run).not.toHaveBeenCalled();
    expect((await getCategorySuggestion(on.db, 'v1'))!.model).toBe(CATEGORY_TEST_HOOK_MODEL);

    const off = setup({ videos: hooked });
    await markCategorySuggestionPending(off.db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    expect(await handleCategorySuggest(videoJob(), off.env, logger, { lastAttempt: false, now: NOW })).toMatchObject({ result: 'model' });
  });

  it('drafts: classifies the message text; the video created from it adopts the suggestion; outcome recorded', async () => {
    const { db, env, ai } = setup({ videos: {} });
    const draftId = 'draft:u1:k1';
    await markCategorySuggestionPending(db, { subjectId: draftId, subjectType: 'draft', reason: 'draft', userId: 'u1', now: NOW });
    const outcome = await handleCategorySuggest({ subjectId: draftId, subjectType: 'draft', reason: 'draft', text: { title: 'شرح حديث', tags: ['حديث'] } }, env, logger, { lastAttempt: false, now: NOW });
    expect(outcome).toMatchObject({ status: 'done', category: 'hadith_studies' });
    expect(ai!.run).toHaveBeenCalledTimes(1);

    expect(await adoptDraftSuggestion(db, draftId, 'v9', 'other-user', 'c1', NOW)).toBe(false);
    expect(await adoptDraftSuggestion(db, draftId, 'v9', 'u1', 'c1', NOW)).toBe(true);
    expect(await recordCategoryOutcome(db, 'v9', 'ramadan', 'u1', NOW)).toBe('changed');
    expect(await getCategorySuggestion(db, 'v9')).toMatchObject({ subject_type: 'video', category: 'hadith_studies', outcome: 'changed', final_category: 'ramadan', reviewed_by: 'u1' });
  });
});

describe('queue handling and sweeps', () => {
  const message = (payload: unknown, attempts = 1) => ({
    body: { id: 'm1', type: MessageType.CategorySuggest, payload },
    attempts,
    ack: jest.fn(),
    retry: jest.fn(),
  });

  it('backs off on retry, hands a final failure to the DLQ, acks the rest', async () => {
    expect([1, 2, 3, 6].map(retryDelaySeconds)).toEqual([30, 60, 120, 600]);
    const failing = setup({ ai: mockAi(new Error('boom')) });
    await markCategorySuggestionPending(failing.db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    const first = message(videoJob(), 2);
    const last = message(videoJob(), 4);
    const invalid = message({ subjectId: '', subjectType: 'video', reason: 'upload' });
    await processCategorizeMessages([first, last, invalid], failing.env, logger);
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(last.retry).toHaveBeenCalledWith();
    expect(last.ack).not.toHaveBeenCalled();
    expect(invalid.ack).toHaveBeenCalled();

    const ok = setup();
    await markCategorySuggestionPending(ok.db, { subjectId: 'v1', subjectType: 'video', reason: 'upload', now: NOW });
    const good = message(videoJob());
    await processCategorizeMessages([good], ok.env, logger);
    expect(good.ack).toHaveBeenCalled();
  });

  it('hourly sweep re-sends stale pending videos; daily sweep re-sends budget rows and purges old drafts', async () => {
    const { db, search } = setup();
    await markCategorySuggestionPending(db, { subjectId: 'stale', subjectType: 'video', reason: 'upload', now: NOW - STALE_PENDING_MS - 1 });
    await markCategorySuggestionPending(db, { subjectId: 'fresh', subjectType: 'video', reason: 'upload', now: NOW });
    await markCategorySuggestionPending(db, { subjectId: 'capped', subjectType: 'video', reason: 'backfill', now: NOW - 5 });
    search.raw.prepare("UPDATE category_suggestions SET status = 'budget' WHERE subject_id = 'capped'").run();
    await markCategorySuggestionPending(db, { subjectId: 'draft:u:old', subjectType: 'draft', reason: 'draft', now: NOW - 8 * 86_400_000 });

    const queue = { send: jest.fn(), sendBatch: jest.fn() };
    expect(await sweepCategorySuggestions(db, queue, logger, { budget: false, now: NOW })).toEqual({ requeued: 1, draftsPurged: 0 });
    expect(queue.sendBatch.mock.calls[0][0][0].body).toMatchObject({ type: MessageType.CategorySuggest, payload: { subjectId: 'stale', reason: 'retry' } });

    expect(await sweepCategorySuggestions(db, queue, logger, { budget: true, now: NOW })).toEqual({ requeued: 1, draftsPurged: 1 });
    expect(await getCategorySuggestion(db, 'capped')).toMatchObject({ status: 'pending', reason: 'backfill' });
    expect(await getCategorySuggestion(db, 'draft:u:old')).toBeNull();
  });
});
