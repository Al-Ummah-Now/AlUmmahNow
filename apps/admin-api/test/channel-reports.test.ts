/** GET /internal/channel-reports/:id over the real migrations: X-API-Key only, true only for a channel report being reviewed, indexed. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { channelReportsRouter, reportOutcomesRouter } from '../src/routers/channelReports.router';
import { sqliteD1 } from './d1-sqlite';

describe('internal channel report status', () => {
  it('answers only with the key, and only a report under review counts', async () => {
    const db = sqliteD1();
    const report = (id: string, type: string, entity: string, status: string) =>
      db.prepare(`INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, 'usr_r', 'spam', ?, '2026-11-01T10:00:00Z')`).bind(id, type, entity, status).run();
    await report('r1', 'channel', 'ch_pending', 'pending');
    await report('r2', 'channel', 'ch_review', 'reviewing');
    await report('r3', 'channel', 'ch_done', 'resolved');
    await report('r4', 'video', 'ch_video', 'reviewing');
    const app = new Hono();
    app.route('/internal/channel-reports', channelReportsRouter as never);
    const ask = (id: string, key?: string) => app.request(`/internal/channel-reports/${id}`, { headers: key ? { 'X-API-Key': key } : {} }, { REPORTS_DB: db, INTERNAL_API_KEY: 'k' });
    assert.equal((await ask('ch_review')).status, 401);
    assert.equal((await ask('ch_review', 'x')).status, 401);
    const answer = await ask('ch_review', 'k');
    assert.deepEqual(await answer.json(), { success: true, result: { underReview: true } }, 'no reporter, reason or report id');
    assert.equal(answer.headers.get('Cache-Control'), 'no-store');
    const underReview = async (id: string) => ((await (await ask(id, 'k')).json()) as { result: { underReview: boolean } }).result.underReview;
    assert.equal(await underReview('ch_review'), true);
    for (const id of ['ch_pending', 'ch_done', 'ch_video', 'ch_none']) assert.equal(await underReview(id), false, id);
    const { results } = await db.prepare(`EXPLAIN QUERY PLAN SELECT 1 AS found FROM reports WHERE status = 'reviewing' AND entity_type = 'channel' AND entity_id = 'x' LIMIT 1`).bind().all();
    assert.match((results as Array<{ detail: string }>).map((r) => r.detail).join(' | '), /USING (COVERING )?INDEX idx_reports/);
  });

  it('no key configured answers nobody', async () => {
    const app = new Hono();
    app.route('/internal/channel-reports', channelReportsRouter as never);
    assert.equal((await app.request('/internal/channel-reports/ch_1', { headers: { 'X-API-Key': '' } }, { REPORTS_DB: sqliteD1() })).status, 401);
  });
});

describe('what became of a person’s own reports', () => {
  const app = new Hono();
  app.route('/internal/report-outcomes', reportOutcomesRouter as never);
  const ask = (db: unknown, body: unknown, key = 'k') =>
    app.request('/internal/report-outcomes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, body: JSON.stringify(body) }, { REPORTS_DB: db, INTERNAL_API_KEY: 'k' });

  it('answers only with the key, and gives the outcome and its date of that person’s reports only', async () => {
    const db = sqliteD1();
    const report = (id: string, status: string, action: string | null, resolved: string | null, reporter = 'usr_r') =>
      db
        .prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, action, resolved_at, created_at, moderator_id, moderator_name, moderator_notes, owner_id, owner_name) VALUES (?, 'video', ?, ?, 'spam', ?, ?, ?, '2026-11-01T10:00:00Z', 'usr_mod', 'Moderator', 'my notes', 'usr_o', 'Owner')")
        .bind(id, `v_${id}`, reporter, status, action, resolved)
        .run();
    const at = '2026-11-20T10:00:00Z';
    await report('pending', 'pending', null, null);
    await report('reviewing', 'reviewing', null, null);
    await report('dismissed', 'dismissed', 'dismissed', at);
    for (const action of ['warning', 'removed', 'deleted', 'banned']) await report(action, 'resolved', action, at);
    await report('kept', 'resolved', null, at);
    await report('theirs', 'resolved', 'banned', at, 'usr_other');
    const ids = ['pending', 'reviewing', 'dismissed', 'warning', 'removed', 'deleted', 'banned', 'kept', 'theirs', 'none'];
    assert.equal((await ask(db, { reporterId: 'usr_r', ids }, 'x')).status, 401);
    const answer = await ask(db, { reporterId: 'usr_r', ids });
    assert.equal(answer.headers.get('Cache-Control'), 'no-store');
    const { result } = (await answer.json()) as { result: { outcomes: Array<{ id: string; outcome: string; decidedAt: string | null }> } };
    assert.deepEqual(result.outcomes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)), [
      { id: 'pending', outcome: 'open', decidedAt: null },
      { id: 'reviewing', outcome: 'open', decidedAt: null },
      { id: 'dismissed', outcome: 'dismissed', decidedAt: at },
      { id: 'warning', outcome: 'action_taken', decidedAt: at },
      { id: 'removed', outcome: 'action_taken', decidedAt: at },
      { id: 'deleted', outcome: 'action_taken', decidedAt: at },
      { id: 'banned', outcome: 'action_taken', decidedAt: at },
      { id: 'kept', outcome: 'kept', decidedAt: at },
    ]);
    const { results } = await db.prepare('EXPLAIN QUERY PLAN SELECT r.id, r.status, r.action, r.resolved_at FROM json_each(?) j CROSS JOIN reports r ON r.id = j.value WHERE r.reporter_id = ?').bind('[]', 'x').all();
    assert.match((results as Array<{ detail: string }>).map((r) => r.detail).join(' | '), /SEARCH r USING INDEX sqlite_autoindex_reports_1 \(id=\?\)/);
  });

  it('refuses what is not a list of ids', async () => {
    const db = sqliteD1();
    for (const body of [null, {}, { reporterId: '', ids: [] }, { reporterId: 'usr_r', ids: 'r1' }, { reporterId: 'usr_r', ids: [1] }, { reporterId: 'usr_r', ids: Array(501).fill('r') }]) {
      assert.equal((await ask(db, body)).status, 400, JSON.stringify(body)?.slice(0, 60));
    }
  });
});
