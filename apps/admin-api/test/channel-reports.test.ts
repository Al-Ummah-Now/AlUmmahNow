/** GET /internal/channel-reports/:id over the real migrations: X-API-Key only, true only for a channel report being reviewed, indexed. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { channelReportsRouter } from '../src/routers/channelReports.router';
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
