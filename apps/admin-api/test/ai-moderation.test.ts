/**
 * Epic 28: admin review of AI moderation signals against the real D1 schema
 * (migrations applied to node:sqlite) and an in-memory R2 bucket.
 */
import { MemoryR2 } from './r2-fake';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  getSignal,
  getSubjectContent,
  listSignals,
  readConfig,
  readUsage,
  reviewSignal,
  setCommentHidden,
  validateConfigPatch,
  writeConfig,
  type D1Like,
  type R2Like,
} from '../src/lib/aiModeration';

function sqliteD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(__dirname, '..', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const st: any = {
      bind: (...v: unknown[]) => ((params = v.map((x) => (x === undefined ? null : x))), st),
      first: async (col?: string) => {
        const row = raw.prepare(sql).get(...(params as any[])) as Record<string, unknown> | undefined;
        return row ? (col ? row[col] : { ...row }) : null;
      },
      all: async () => ({ results: raw.prepare(sql).all(...(params as any[])).map((r) => ({ ...r })) }),
      run: async () => raw.prepare(sql).run(...(params as any[])),
    };
    return st;
  };
  const db: D1Like & { raw: DatabaseSync } = { raw, prepare, batch: async (sts: any[]) => { for (const s of sts) await s.run(); return []; } } as any;
  return db;
}

class Bucket extends MemoryR2 implements R2Like {}

function insertSignal(db: ReturnType<typeof sqliteD1>, row: Record<string, unknown>) {
  const base = {
    id: 's1', subject_type: 'comment', subject_id: 'c1', parent_id: 'v1', surface: 'video_comment', author_id: 'u1', channel_id: 'ch1',
    language: 'ar', categories_json: '{"S10":1}', top_category: 'S10', top_score: 1, models: 'm', prompt_version: 'mod-v1',
    decision: 'would_flag', priority: 60, review_status: 'pending', translation: 'english', created_at: '2026-11-08T10:00:00.000Z',
    ...row,
  };
  const keys = Object.keys(base);
  db.raw.prepare(`INSERT INTO moderation_signals (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...(Object.values(base) as any[]));
}

describe('AI moderation review (admin-api)', () => {
  let db: ReturnType<typeof sqliteD1>;
  let videos: Bucket;
  beforeEach(() => {
    db = sqliteD1();
    videos = new Bucket();
    videos.data.set('v1', JSON.stringify({ id: 'v1', title: 'T', comments: [{ id: 'top', text: 'hi', replies: [{ id: 'c1', text: 'reply text' }] }] }));
  });

  it('lists by priority with filters and parses categories', async () => {
    insertSignal(db, {});
    insertSignal(db, { id: 's2', priority: 100, top_category: 'S4', review_status: 'pending' });
    insertSignal(db, { id: 's3', decision: 'none', review_status: 'n/a', priority: 0 });
    const all = await listSignals(db, {});
    assert.deepEqual(all.signals.map((s) => s.id), ['s2', 's1', 's3']);
    assert.deepEqual(all.signals[1].categories, { S10: 1 });
    const pending = await listSignals(db, { review_status: 'pending', category: 'S10' });
    assert.deepEqual(pending.signals.map((s) => s.id), ['s1']);
    assert.equal(pending.total, 1);
  });

  it('agree/disagree sets the label and writes an audit row with the reviewer', async () => {
    insertSignal(db, {});
    assert.deepEqual(await reviewSignal(db, 's1', 'disagree', 'mod-1', 'scripture quote'), { id: 's1', review_status: 'disagreed' });
    const found = await getSignal(db, 's1');
    assert.equal(found!.signal.review_status, 'disagreed');
    assert.equal(found!.signal.reviewer_id, 'mod-1');
    assert.equal((found!.actions[0] as any).action, 'disagree');
    assert.equal((found!.actions[0] as any).actor_id, 'mod-1');
    assert.equal(await reviewSignal(db, 'missing', 'agree', 'mod-1'), null);
  });

  it('reads the subject text live from R2 (never from D1)', async () => {
    insertSignal(db, {});
    const content = await getSubjectContent({ videos }, { subject_type: 'comment', subject_id: 'c1', parent_id: 'v1', channel_id: 'ch1' });
    assert.deepEqual(content, { available: true, text: 'reply text', hidden: false, hiddenByModeration: false, canHide: true });
    const posts = new Bucket();
    posts.data.set('posts/ch1/p1.json', JSON.stringify({ content: 'post body' }));
    assert.equal((await getSubjectContent({ videos, community_posts: posts }, { subject_type: 'post', subject_id: 'p1', parent_id: null, channel_id: 'ch1' })).text, 'post body');
  });

  it('hide is reversible and restore only undoes moderation holds; both audited', async () => {
    insertSignal(db, {});
    assert.deepEqual(await setCommentHidden(db, videos, 's1', true, 'mod-1', 'harassment'), { ok: true, changed: true });
    let reply = JSON.parse(videos.data.get('v1')!).comments[0].replies[0];
    assert.equal(reply.status, 'held');
    assert.equal(reply.heldBy, 'moderation');
    assert.equal(reply.text, 'reply text'); // never deleted

    assert.deepEqual(await setCommentHidden(db, videos, 's1', false, 'mod-2'), { ok: true, changed: true });
    reply = JSON.parse(videos.data.get('v1')!).comments[0].replies[0];
    assert.equal(reply.status, undefined);

    // A creator's own hold is not cleared by restore
    const v = JSON.parse(videos.data.get('v1')!);
    v.comments[0].replies[0].status = 'held';
    videos.data.set('v1', JSON.stringify(v));
    assert.deepEqual(await setCommentHidden(db, videos, 's1', false, 'mod-2'), { ok: true, changed: false });
    assert.equal(JSON.parse(videos.data.get('v1')!).comments[0].replies[0].status, 'held');

    const actions = db.raw.prepare('SELECT action, actor_id FROM moderation_actions ORDER BY rowid').all();
    assert.deepEqual(actions.map((a: any) => [a.action, a.actor_id]), [['hide', 'mod-1'], ['restore', 'mod-2'], ['restore', 'mod-2']]);
  });

  it('hide refuses non-comment subjects and missing signals', async () => {
    insertSignal(db, { id: 'sv', subject_type: 'video', subject_id: 'v1', parent_id: null, surface: 'video_metadata' });
    assert.deepEqual(await setCommentHidden(db, videos, 'sv', true, 'mod-1'), { ok: false, error: 'unsupported' });
    assert.deepEqual(await setCommentHidden(db, videos, 'nope', true, 'mod-1'), { ok: false, error: 'not_found' });
  });

  it('config: validation refuses hide outside spam/scam; writes merge and are audited', async () => {
    assert.match(validateConfigPatch({ policies: { S10: { action: 'hide' } } })!, /only spam and charity_scam/);
    assert.match(validateConfigPatch({ policies: { made_up: { mode: 'enforce' } } })!, /Unknown category/);
    assert.match(validateConfigPatch({ dailyNeuronCap: -1 })!, /dailyNeuronCap/);
    assert.equal(validateConfigPatch({ enabled: true, policies: { spam: { action: 'hide', mode: 'enforce', threshold: 0.95 } } }), null);

    assert.equal((await readConfig(db, '100000')).enabled, false); // no row = off
    assert.equal((await readConfig(db, '100000')).dailyNeuronCap, 100000);
    await writeConfig(db, { enabled: true, dailyNeuronCap: 5000, policies: { spam: { mode: 'enforce' } } }, 'admin-1');
    await writeConfig(db, { policies: { spam: { threshold: 0.95 } } }, 'admin-1');
    const config = await readConfig(db);
    assert.equal(config.enabled, true);
    assert.equal(config.dailyNeuronCap, 5000);
    assert.deepEqual(config.policies.spam, { mode: 'enforce', threshold: 0.95 });
    assert.equal(config.updatedBy, 'admin-1');
    const audit = db.raw.prepare("SELECT COUNT(*) AS n FROM moderation_actions WHERE action = 'config_change'").get() as any;
    assert.equal(audit.n, 2);
  });

  it('usage: per day × model and today total', async () => {
    db.raw.prepare("INSERT INTO ai_usage_daily (day, model, calls, neurons, usd) VALUES ('2026-11-08', 'guard', 3, 60, 0.00066), ('2026-11-08', 'm2m', 1, 7, 0.00008), ('2026-09-01', 'guard', 1, 1, 0)").run();
    const usage = await readUsage(db, 30, new Date('2026-11-08T12:00:00Z'));
    assert.equal(usage.rows.length, 2);
    assert.equal(usage.today.neurons, 67);
  });
});
