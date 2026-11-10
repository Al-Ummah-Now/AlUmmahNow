/**
 * Admin review of AI category suggestions against the real schemas (SEARCH_DB
 * from api-videos, REPORTS_DB from this app; node:sqlite) and an in-memory R2
 * bucket with etags: review queues, bulk accept/change (index kept in sync,
 * owner changes win), retry, the idempotent backfill, settings and audit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  MessageType,
  getCategorySuggestion,
  markCategorySuggestionPending,
  recordCategorySuggestionResult,
  syncSearchDocument,
  type SearchDb,
} from '@al-ummah/shared-types';
import { MemoryR2 } from './r2-fake';
import { sqliteD1 } from './d1-sqlite';
import {
  applyAdminCategory,
  backfillPage,
  isVideoKey,
  listSuggestions,
  readCategorizeConfig,
  retrySuggestions,
  suggestionStats,
  writeCategorizeConfig,
  type D1Like,
} from '../src/lib/categorySuggestions';

const NOW = Date.parse('2026-11-09T12:00:00Z');

function searchD1(): SearchDb & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql) || /RETURNING/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true };
    stmt.run(...params);
    return { results: [], success: true };
  };
  const statement = (sql: string, args: unknown[] = []): any => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => (exec(sql, args).results[0] as unknown) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  return { raw, prepare: (sql: string) => statement(sql), batch: async (list: any[]) => list.map((s) => s._exec()) } as never;
}

const video = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Video ${id}`, userId: 'u1', channelId: 'c1', channelName: 'Mostafa Elbadry', isPublic: true, uploadStatus: 'ready', dateCreated: '2026-11-01T00:00:00Z', ...extra });

class Queue {
  messages: any[] = [];
  async send(m: unknown) { this.messages.push(m); }
  async sendBatch(list: Array<{ body: unknown }>) { this.messages.push(...list.map((x) => x.body)); }
}

async function setup() {
  const db = searchD1();
  const reports = sqliteD1() as unknown as D1Like;
  const videos = new MemoryR2();
  const queue = new Queue();
  // v-ai: backfilled by the AI (fiqh, 0.42); v-sure: AI 0.9; v-low: AI answered, wrote nothing; v-fail: failed; v-owner: owner changed it since
  const seed = async (id: string, data: Record<string, unknown>, row?: { status: string; category?: string; confidence?: number; applied?: boolean; reason?: string }) => {
    videos.set(id, video(id, data));
    await syncSearchDocument(db, 'video', id, video(id, data), { version: 1 });
    if (!row) return;
    await markCategorySuggestionPending(db, { subjectId: id, subjectType: 'video', reason: (row.reason ?? 'backfill') as never, now: NOW - 1000 });
    await recordCategorySuggestionResult(db, id, {
      status: row.status as never,
      scores: row.category ? [{ category: row.category as never, confidence: row.confidence ?? 0.5 }, { category: 'islamic_lectures' as never, confidence: 0.1 }] : undefined,
      model: row.category ? 'm' : undefined,
      applied: row.applied,
      error: row.status === 'failed' ? 'upstream 503' : undefined,
      now: NOW - 1000,
    });
  };
  await seed('v-ai', { category: 'fiqh', categorySource: 'ai' }, { status: 'done', category: 'fiqh', confidence: 0.42, applied: true });
  await seed('v-sure', { category: 'hadith_studies', categorySource: 'ai' }, { status: 'done', category: 'hadith_studies', confidence: 0.9, applied: true });
  await seed('v-low', {}, { status: 'done', category: 'dawah', confidence: 0.3, applied: false, reason: 'upload' });
  await seed('v-fail', {}, { status: 'failed' });
  await seed('v-owner', { category: 'ramadan', categorySource: 'uploader' }, { status: 'done', category: 'fiqh', confidence: 0.8, applied: true });
  await seed('v-none', {});
  videos.set('likes/v-ai', { id: 'x' });
  videos.set('index:recent-videos', { id: 'index:recent-videos' });
  return { db, reports, videos, queue };
}

describe('category suggestion review', () => {
  it('lists the review queue least-confident first, with the video; flagged and needs-category queues', async () => {
    const { db, videos } = await setup();
    const review = await listSuggestions(db, videos, { view: 'review' }, NOW);
    assert.deepEqual(review.items.map((i) => i.videoId), ['v-ai', 'v-owner', 'v-sure']);
    assert.deepEqual(review.items[0].video && { title: review.items[0].video.title, channel: review.items[0].video.channelName, source: review.items[0].video.categorySource }, { title: 'Video v-ai', channel: 'Mostafa Elbadry', source: 'ai' });
    assert.equal(review.items[0].options.length, 2);
    assert.deepEqual((await listSuggestions(db, videos, { view: 'flagged' }, NOW)).items.map((i) => [i.videoId, i.lastError]), [['v-fail', 'upstream 503']]);
    assert.deepEqual((await listSuggestions(db, videos, { view: 'needs_category' }, NOW)).items.map((i) => i.videoId), ['v-low']);
    assert.deepEqual((await listSuggestions(db, videos, { view: 'review', category: 'fiqh' }, NOW)).items.map((i) => i.videoId), ['v-ai', 'v-owner']);
    assert.deepEqual((await listSuggestions(db, videos, { view: 'all', videoId: 'v-sure' }, NOW)).items.map((i) => i.videoId), ['v-sure']);
  });

  it('a pending job untouched for an hour is flagged as stuck', async () => {
    const { db, videos } = await setup();
    await markCategorySuggestionPending(db, { subjectId: 'v-none', subjectType: 'video', reason: 'upload', now: NOW - 2 * 3600_000 });
    assert.ok((await listSuggestions(db, videos, { view: 'flagged' }, NOW)).items.some((i) => i.videoId === 'v-none'));
  });

  it('accept keeps the AI category as the admin\'s, records the outcome and audits; an owner\'s later change wins', async () => {
    const { db, reports, videos } = await setup();
    const results = await applyAdminCategory({ db, reports, videos }, ['v-ai', 'v-owner', 'v-none'], { kind: 'accept' }, 'admin-1', NOW);
    assert.deepEqual(results.map((r) => [r.videoId, r.ok, r.error ?? null]), [['v-ai', true, null], ['v-owner', false, 'changed_since'], ['v-none', false, 'no_suggestion']]);
    assert.deepEqual({ c: videos.read('v-ai').category, s: videos.read('v-ai').categorySource }, { c: 'fiqh', s: 'admin' });
    assert.deepEqual({ c: videos.read('v-owner').category, s: videos.read('v-owner').categorySource }, { c: 'ramadan', s: 'uploader' });
    assert.deepEqual(await getCategorySuggestion(db, 'v-ai').then((r) => [r!.outcome, r!.final_category, r!.reviewed_by]), ['accepted', 'fiqh', 'admin-1']);
    const auditRow = await reports.prepare("SELECT action, actor_id, subject_id, category FROM moderation_actions WHERE action = 'category_accept'").first<Record<string, unknown>>();
    assert.deepEqual({ ...auditRow }, { action: 'category_accept', actor_id: 'admin-1', subject_id: 'v-ai', category: 'fiqh' });
  });

  it('set changes the category on each video and keeps the search index in sync', async () => {
    const { db, reports, videos } = await setup();
    const results = await applyAdminCategory({ db, reports, videos }, ['v-sure', 'v-low'], { kind: 'set', category: 'quran_tafsir' }, 'admin-1', NOW);
    assert.ok(results.every((r) => r.ok));
    for (const id of ['v-sure', 'v-low']) {
      assert.deepEqual({ c: videos.read(id).category, s: videos.read(id).categorySource, title: videos.read(id).title }, { c: 'quran_tafsir', s: 'admin', title: `Video ${id}` });
      assert.deepEqual({ ...(db.raw.prepare('SELECT category FROM search_videos WHERE id = ?').get(id) as object) }, { category: 'quran_tafsir' });
    }
    assert.equal((await getCategorySuggestion(db, 'v-sure'))!.outcome, 'changed');
    const stats = await suggestionStats(db, NOW);
    assert.deepEqual(stats.byCategory.find((c) => c.category === 'quran_tafsir'), { category: 'quran_tafsir', videos: 2, aiUnreviewed: 0 });
    assert.equal(stats.views.reviewed, 2);
  });

  it('retry re-queues flagged suggestions, keeping their reason', async () => {
    const { db, reports, queue } = await setup();
    await retrySuggestions({ db, reports, queue }, ['v-fail'], 'admin-1', NOW);
    assert.deepEqual(queue.messages.map((m) => [m.type, m.payload.subjectId, m.payload.reason]), [[MessageType.CategorySuggest, 'v-fail', 'retry']]);
    assert.deepEqual(await getCategorySuggestion(db, 'v-fail').then((r) => [r!.status, r!.reason, r!.attempts, r!.last_error]), ['pending', 'backfill', 0, null]);
  });

  it('backfill: dry run only counts; the real run queues each uncategorised video once; a re-run queues nothing', async () => {
    const { db, reports, videos, queue } = await setup();
    const dry = await backfillPage({ db, reports, videos, queue }, { dryRun: true }, 'admin-1', NOW);
    assert.deepEqual({ scanned: dry.scanned, candidates: dry.candidates, alreadyHandled: dry.alreadyHandled, withCategory: dry.withCategory, queued: dry.queued, done: dry.done }, { scanned: 6, candidates: 3, alreadyHandled: 2, withCategory: 3, queued: 0, done: true });
    assert.equal(queue.messages.length, 0);

    const run = await backfillPage({ db, reports, videos, queue }, { dryRun: false }, 'admin-1', NOW);
    assert.equal(run.queued, 1);
    assert.deepEqual(queue.messages.map((m) => [m.payload.subjectId, m.payload.reason]), [['v-none', 'backfill']]);
    assert.equal((await getCategorySuggestion(db, 'v-none'))!.reason, 'backfill');

    const again = await backfillPage({ db, reports, videos, queue }, { dryRun: false }, 'admin-1', NOW);
    assert.equal(again.queued, 0);
    assert.equal(queue.messages.length, 1);
    const audits = await reports.prepare("SELECT COUNT(*) AS n FROM moderation_actions WHERE action LIKE 'category_backfill%'").first<{ n: number }>();
    assert.equal(Number(audits!.n), 3);
    assert.equal(isVideoKey('likes/v1'), false);
    assert.equal(isVideoKey('index:recent-videos'), false);
  });

  it('settings: validated, merged, audited', async () => {
    const { reports } = await setup();
    assert.deepEqual(await readCategorizeConfig(reports).then(({ enabled, dailyNeuronCap, threshold }) => ({ enabled, dailyNeuronCap, threshold })), { enabled: true, dailyNeuronCap: 20000, threshold: 0.6 });
    assert.match((await writeCategorizeConfig(reports, { threshold: 0.1 }, 'admin-1'))!, /threshold/);
    assert.equal(await writeCategorizeConfig(reports, { dailyNeuronCap: 5000 }, 'admin-1'), null);
    assert.equal(await writeCategorizeConfig(reports, { threshold: 0.7 }, 'admin-1'), null);
    const config = await readCategorizeConfig(reports);
    assert.deepEqual({ cap: config.dailyNeuronCap, threshold: config.threshold, by: config.updatedBy }, { cap: 5000, threshold: 0.7, by: 'admin-1' });
  });
});
