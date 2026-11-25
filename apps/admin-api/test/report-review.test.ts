/** Start review (#2015) over the real migrations: pending ↔ reviewing, audited, and what a channel move asks. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import moderationRouter from '../src/routers/moderation.router';
import { channelReportsRouter } from '../src/routers/channelReports.router';
import { setReportReview } from '../src/lib/moderation/reportReview';
import { sqliteD1 } from './d1-sqlite';

async function setup(extra: Record<string, string> = {}) {
  const db = sqliteD1();
  const report = (id: string, type: string, entity: string, status = 'pending') =>
    db.prepare(`INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at, moderator_name, meta_synced_at) VALUES (?, ?, ?, 'usr_r', 'spam', ?, '2026-11-01T10:00:00Z', 'Old name', 'x')`).bind(id, type, entity, status).run();
  await report('r1', 'channel', 'ch_1');
  await report('r2', 'channel', 'ch_1');
  await report('done', 'channel', 'ch_2', 'dismissed');
  await report('chat', 'live_chat', 'm_1');
  const env = { REPORTS_DB: db, INTERNAL_API_KEY: 'k', ...extra };
  const sql: string[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = ((q: string) => (sql.push(q), prepare(q))) as typeof db.prepare;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'usr_mod', roles: [c.req.header('x-test-role') ?? 'moderator'], payload: {} } as never);
    await next();
  });
  app.route('/internal/channel-reports', channelReportsRouter as never);
  fromHono(app).route('/api/moderation', moderationRouter);
  const background: Promise<unknown>[] = [];
  const review = async (id: string, json: unknown, user = 'usr_mod', role = 'moderator') => {
    const res = await app.request(`/api/moderation/reports/${id}/review`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': user, 'x-test-role': role }, body: JSON.stringify(json) }, env, { waitUntil: (p: Promise<unknown>) => void background.push(p), passThroughOnException: () => undefined, props: {} } as never);
    const body = (await res.json()) as any;
    return { status: res.status, code: body.code, report: body.result?.report };
  };
  const underReview = async (id: string) => ((await (await app.request(`/internal/channel-reports/${id}`, { headers: { 'X-API-Key': 'k' } }, env)).json()) as any).result.underReview;
  const log = async () => ((await db.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log ORDER BY rowid').all<any>()).results ?? []).map((r: any) => [r.key, JSON.parse(r.new_value).action, JSON.parse(r.new_value).details.reportId, JSON.parse(r.old_value).status, r.actor_id]);
  return { db, review, underReview, log, sql, background };
}

describe('start review', () => {
  it('a moderator starts it and puts it back, audited on the item, and a channel move is told', async () => {
    const { review, underReview, log } = await setup();
    assert.equal(await underReview('ch_1'), false, 'a pending report blocks nothing');
    const started = await review('r1', { reviewing: true });
    assert.deepEqual([started.status, started.report.status, started.report.moderator_id, started.report.moderator_name, started.report.meta_synced_at], [200, 'reviewing', 'usr_mod', null, null]);
    assert.ok(started.report.updated_at && !started.report.resolved_at);
    assert.equal(await underReview('ch_1'), true);
    const stopped = await review('r1', { reviewing: false }, 'usr_other');
    assert.deepEqual([stopped.status, stopped.report.status, stopped.report.moderator_id], [200, 'pending', null]);
    assert.equal(await underReview('ch_1'), false);
    assert.equal((await review('chat', { reviewing: true })).status, 200);
    assert.deepEqual(await log(), [
      ['content:channel:ch_1', 'report-review-start', 'r1', 'pending', 'usr_mod'],
      ['content:channel:ch_1', 'report-review-stop', 'r1', 'reviewing', 'usr_other'],
      ['content:live-stream:m_1', 'report-review-start', 'chat', 'pending', 'usr_mod'],
    ]);
  });

  it('other open admin pages are told of a status that changed, and of nothing else', async () => {
    const { review, background } = await setup({ WEBSOCKET_URL: 'wss://realtime.test/ws' });
    const sent: unknown[] = [];
    const fetched = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const item = JSON.parse(String(init.body)).items[0];
      sent.push([url, item.channel, item.message.data.events]);
      return new Response('{}');
    }) as never;
    const told = async (id: string, reviewing: boolean) => {
      sent.length = 0;
      const { status } = await review(id, { reviewing });
      await Promise.all(background.splice(0));
      return [status, ...sent];
    };
    const broadcast = ['https://realtime.test/broadcast', 'admin:moderation', [{ kind: 'changed', key: 'reports', queue: 'reports' }]];
    try {
      assert.deepEqual(await told('r1', true), [200, broadcast]);
      assert.deepEqual(await told('r1', true), [200], 'started again');
      assert.deepEqual(await told('r1', false), [200, broadcast]);
      assert.deepEqual(await told('r1', false), [200], 'stopped again');
      assert.deepEqual(await told('done', true), [409]);
    } finally {
      globalThis.fetch = fetched;
    }
  });

  it('asked for what it already is, it changes and records nothing', async () => {
    const { review, log } = await setup();
    assert.equal((await review('r1', { reviewing: false })).status, 200);
    assert.equal((await review('r1', { reviewing: true })).status, 200);
    const again = await review('r1', { reviewing: true }, 'usr_other');
    assert.deepEqual([again.status, again.report.moderator_id], [200, 'usr_mod'], 'the first moderator keeps it');
    assert.equal((await log()).length, 1);
  });

  it('a closed report, an unknown one and a malformed body are refused, nothing recorded', async () => {
    const { review, log, sql } = await setup();
    for (const reviewing of [true, false]) {
      const closed = await review('done', { reviewing });
      assert.deepEqual([closed.status, closed.code], [409, 'already_closed']);
    }
    assert.ok(!sql.some((q) => /^INSERT|^DELETE/i.test(q.trim())), 'no audit row is written, even for a moment');
    const none = await review('nope', { reviewing: true });
    assert.deepEqual([none.status, none.code], [404, 'not_found']);
    for (const body of [{}, { reviewing: 'yes' }]) assert.equal((await review('r1', body)).status, 400);
    assert.deepEqual(await log(), []);
  });

  it('under a takedown, only a super admin reviews it; nobody else learns of it here', async () => {
    const { db, review, log } = await setup();
    await db.prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, detected_at, created_by, created_at, updated_at, item_type, item_id) VALUES ('case-1', 'u', 'k', 'paste', 'contained', 'x', 'a', 'x', 'x', 'channel', 'ch_1')").run();
    for (const reviewing of [true, false]) {
      const refused = await review('r1', { reviewing });
      assert.deepEqual([refused.status, refused.code, refused.report], [403, 'forbidden', undefined]);
    }
    assert.deepEqual(await log(), []);
    assert.equal((await review('r1', { reviewing: true }, 'usr_super', 'super_admin')).status, 200);
    assert.equal((await log()).length, 1);
  });

  it('closed, or started, by another moderator in the same moment: theirs stands, and only theirs is recorded', async () => {
    for (const [winner, expected] of [['dismissed', 'already_closed'], ['reviewing', null]] as const) {
      const { db, log } = await setup();
      const raced = { ...db, prepare: (sql: string) => {
        if (sql.startsWith('UPDATE reports')) db.prepare(`UPDATE reports SET status = '${winner}', moderator_id = 'usr_other' WHERE id = 'r1'`).bind().run();
        return db.prepare(sql);
      } };
      const done = setReportReview(raced as never, 'r1', true, 'usr_mod');
      if (expected) await assert.rejects(done, { code: expected });
      else {
        const { report, changed } = await done;
        assert.deepEqual([report.moderator_id, changed], ['usr_other', false]);
      }
      assert.deepEqual(await log(), []);
    }
  });

  it('a failed write leaves no audit row', async () => {
    const { db, log } = await setup();
    const broken = { ...db, prepare: (sql: string) => { if (sql.startsWith('UPDATE reports')) throw new Error('down'); return db.prepare(sql); } };
    await assert.rejects(setReportReview(broken as never, 'r1', true, 'usr_mod'), /down/);
    assert.deepEqual(await log(), []);
  });
});
