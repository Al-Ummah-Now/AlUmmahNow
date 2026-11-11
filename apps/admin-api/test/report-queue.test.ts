/**
 * The reports queue (/api/moderation/queue, lib/moderation/*) over the real
 * migrations (node:sqlite) and a fake api-videos: grouping per item, the
 * search copies and their fill, search and filters on both tabs, tab counts,
 * the `banned` outcome banning the owner through the user ban path (with its
 * permission and audit row), the per-report action, and the `report` suggest kind.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import reportQueueRouter from '../src/routers/reportQueue.router';
import suggestRouter from '../src/routers/suggest.router';
import moderationRouter from '../src/routers/moderation.router';
import { buildHistorySql, buildQueueSql, endOf, likeTerm, parseHistoryQuery, parseQueueQuery, QueueQueryError, sharedWhere } from '../src/lib/moderation/reportQueue';
import { syncReportMeta } from '../src/lib/moderation/reportMeta';
import { sqliteD1 } from './d1-sqlite';
import { MemoryR2 } from './r2-fake';

interface VideosCall { method: string; path: string; body: any; actor: string | null }

const ITEMS: Record<string, any> = {
  'video:v_1': { found: true, title: 'Bad video', parentId: null, channelId: 'ch_1', channelName: 'Sunrise Channel', ownerId: 'usr_owner', isHidden: false, isDeleted: false },
  'comment:c_1': { found: true, title: 'rude words', parentId: 'v_9', channelId: 'ch_2', channelName: 'Other Channel', ownerId: 'usr_commenter', isHidden: false, isDeleted: false },
};
const USERS: Record<string, any> = {
  usr_owner: { displayName: 'Omar Owner', isBanned: false },
  usr_commenter: { displayName: 'Carl Commenter', isBanned: true },
  usr_r1: { displayName: 'Rana Reporter', isBanned: false },
  usr_r2: { displayName: 'Sami Reporter', isBanned: false },
  usr_r3: { displayName: 'Huda Reporter', isBanned: false },
  usr_mod: { displayName: 'Maryam Moderator', isBanned: false },
};

function fakeVideos(opts: { banStatus?: number } = {}) {
  const calls: VideosCall[] = [];
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const url = new URL(input);
      const call: VideosCall = {
        method: init.method ?? 'GET',
        path: url.pathname.replace('/internal/admin', ''),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        actor: new Headers(init.headers).get('X-Admin-Actor'),
      };
      calls.push(call);
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (call.path === '/lookup') {
        const items = call.body.items.map((i: { type: string; id: string }) => ({ type: i.type, id: i.id, ...(ITEMS[`${i.type}:${i.id}`] ?? { found: false, title: null, parentId: null, channelId: null, channelName: null, ownerId: null, isHidden: null, isDeleted: null }) }));
        const ids = [...new Set([...call.body.users, ...items.map((i: any) => i.ownerId).filter(Boolean)])] as string[];
        const users = ids.map((id) => ({ id, found: !!USERS[id], displayName: USERS[id]?.displayName ?? null, userName: null, isBanned: USERS[id]?.isBanned ?? false }));
        return json(200, { success: true, result: { items, users } });
      }
      if (/^\/users\/[^/]+\/ban$/.test(call.path)) {
        if (opts.banStatus) return json(opts.banStatus, { success: false, code: 'boom', error: 'refused' });
        return json(200, { success: true, result: { ban: { userId: call.path.split('/')[2] }, job: { id: 'job_1' } } });
      }
      return json(404, { success: false, code: 'not_found', error: 'no route' });
    },
  };
  return { fetcher, calls };
}

type Seed = { id: string; type?: string; entity: string; reporter: string; reason?: string; description?: string; status?: string; created: string; action?: string; moderator?: string; resolved?: string };

function setup(reports: Seed[], opts: { banStatus?: number } = {}) {
  const db = sqliteD1();
  for (const r of reports) {
    db.prepare(
      `INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, description, status, created_at, action, moderator_id, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(r.id, r.type ?? 'video', r.entity, r.reporter, r.reason ?? 'spam', r.description ?? null, r.status ?? 'pending', r.created, r.action ?? null, r.moderator ?? null, r.resolved ?? null)
      .run();
  }
  const { fetcher, calls } = fakeVideos(opts);
  const videos = new MemoryR2();
  videos.set('v_1', { id: 'v_1', title: 'Bad video', userId: 'usr_owner' });
  const sent: unknown[] = [];
  const env = { REPORTS_DB: db, VIDEOS: fetcher, INTERNAL_API_KEY: 'k', videos, channels: new MemoryR2(), playlists: new MemoryR2(), queue: { send: async (m: unknown) => void sent.push(m) } };

  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles') ?? 'admin';
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'usr_mod', roles: roles.split(','), payload: {} } as never);
    await next();
  });
  app.route('/api/moderation/queue', reportQueueRouter as never);
  app.route('/api/suggest', suggestRouter as never);
  const openapi = fromHono(app);
  openapi.route('/api/moderation', moderationRouter);

  const call = async (path: string, init: { method?: string; roles?: string; json?: unknown } = {}) => {
    const headers: Record<string, string> = { 'x-test-roles': init.roles ?? 'admin' };
    if (init.json !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(path, { method: init.method ?? 'GET', headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  const rows = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).all().then((r: any) => (r.results as any[]).map((row) => ({ ...row })));
  return { db, env, call, calls, rows, sent, videos };
}

const BASE: Seed[] = [
  { id: 'r1', entity: 'v_1', reporter: 'usr_r1', reason: 'spam', description: 'buy now links', created: '2026-11-01T10:00:00Z' },
  { id: 'r2', entity: 'v_1', reporter: 'usr_r2', reason: 'harassment', description: 'targets a family', created: '2026-11-03T10:00:00Z' },
  { id: 'r3', entity: 'v_1', reporter: 'usr_r3', reason: 'spam', created: '2026-11-05T10:00:00Z', status: 'reviewing' },
  { id: 'r4', type: 'comment', entity: 'c_1', reporter: 'usr_r1', reason: 'inappropriate', description: 'swearing', created: '2026-11-02T10:00:00Z' },
  { id: 'r5', entity: 'v_2', reporter: 'usr_r2', reason: 'copyright', created: '2026-10-01T10:00:00Z', status: 'resolved', action: 'removed', moderator: 'usr_mod', resolved: '2026-10-02T10:00:00Z' },
  { id: 'r6', entity: 'v_1', reporter: 'usr_r3', reason: 'other', created: '2026-09-01T10:00:00Z', status: 'dismissed', action: 'dismissed', moderator: 'usr_mod', resolved: '2026-09-02T10:00:00Z' },
];

describe('reports queue: query building', () => {
  it('escapes LIKE wildcards and treats a bare `to` date as the end of that day', () => {
    assert.equal(likeTerm(' 100%_Off\\ '), '%100\\%\\_off\\\\%');
    assert.equal(endOf('2026-11-30'), '2026-12-01');
    assert.equal(endOf('2026-11-30T12:00:00Z'), '2026-11-30T12:00:00Z');
  });

  it('searches every named field and exact ids; History adds the moderator', () => {
    const shared = sharedWhere({ q: 'rana' }, 'm');
    for (const col of ['entity_title', 'channel_name', 'owner_name', 'reporter_name', 'reason', 'description']) assert.match(shared.sql[0], new RegExp(`lower\\(m\\.${col}\\) LIKE`));
    for (const col of ['entity_id', 'owner_id', 'channel_id', 'reporter_id']) assert.match(shared.sql[0], new RegExp(`m\\.${col} = \\?`));
    assert.doesNotMatch(shared.sql[0], /moderator_name/);
    assert.match(sharedWhere({ q: 'x' }, 'r', { history: true }).sql[0], /moderator_name.*moderator_notes/);
    assert.equal(shared.binds.length, 10);
  });

  it('groups match on any open report but count them all; binds line up with placeholders', () => {
    const q = buildQueueSql({ q: 'x', reason: 'spam', from: '2026-11-01', to: '2026-11-30', entityType: 'video', page: 2, pageSize: 10, sort: 'most_reports' });
    assert.match(q.page.sql, /\(r\.entity_type, r\.entity_id\) IN \(SELECT m\.entity_type, m\.entity_id FROM reports m WHERE m\.status IN/);
    assert.match(q.page.sql, /ORDER BY report_count DESC/);
    assert.equal((q.page.sql.match(/\?/g) ?? []).length, q.page.binds.length);
    assert.deepEqual(q.page.binds.slice(-2), [10, 10]);
    const h = buildHistorySql({ action: 'banned', moderatorId: 'usr_mod', page: 1, pageSize: 5, sort: 'oldest' });
    assert.match(h.page.sql, /r\.action = \? AND r\.moderator_id = \?/);
    assert.match(h.page.sql, /ORDER BY r\.resolved_at ASC/);
    assert.equal((h.page.sql.match(/\?/g) ?? []).length, h.page.binds.length);
  });

  it('rejects unknown enum values and bad dates with a clear message', () => {
    assert.throws(() => parseQueueQuery({ sort: 'loudest' }), QueueQueryError);
    assert.throws(() => parseQueueQuery({ entityType: 'tweet' }), QueueQueryError);
    assert.throws(() => parseHistoryQuery({ action: 'nuked' }), QueueQueryError);
    assert.throws(() => parseQueueQuery({ from: 'yesterday' }), QueueQueryError);
    assert.throws(() => parseQueueQuery({ page: '0' }), QueueQueryError);
    assert.equal(parseQueueQuery({ pageSize: '500' }).pageSize, 100);
    assert.equal(parseHistoryQuery({}).sort, 'newest');
  });
});

describe('reports queue: Action needed', () => {
  it('groups open reports per item, oldest first, with reasons, newest texts, names, owner ban state and AI signal', async () => {
    const t = setup(BASE);
    await t.db.prepare("INSERT INTO moderation_signals (id, subject_type, subject_id, surface, decision, top_category, top_score, review_status, created_at) VALUES ('sig_1', 'comment', 'c_1', 'video_comment', 'would_hide', 'S10', 0.91, 'pending', '2026-11-02T10:00:01Z')").run();
    const { status, body } = await t.call('/api/moderation/queue');
    assert.equal(status, 200);
    const { items, total, counts } = body.result;
    assert.equal(total, 2);
    assert.deepEqual(counts, { actionNeeded: 2, openReports: 4, history: 2 });
    assert.deepEqual(items.map((g: any) => g.key), ['video:v_1', 'comment:c_1']);
    const [video, comment] = items;
    assert.equal(video.reportCount, 3);
    assert.deepEqual(video.reasons, { spam: 2, harassment: 1 });
    assert.equal(video.firstReportedAt, '2026-11-01T10:00:00Z');
    assert.equal(video.lastReportedAt, '2026-11-05T10:00:00Z');
    assert.deepEqual(video.latest.map((r: any) => [r.reportId, r.reporter.name]), [['r3', 'Huda Reporter'], ['r2', 'Sami Reporter'], ['r1', 'Rana Reporter']]);
    assert.deepEqual(video.item.channel, { id: 'ch_1', name: 'Sunrise Channel' });
    assert.deepEqual(video.item.owner, { id: 'usr_owner', name: 'Omar Owner', isBanned: false });
    assert.equal(video.item.title, 'Bad video');
    assert.equal(video.ai, null);
    assert.equal(comment.item.owner.isBanned, true);
    assert.equal(comment.item.parentId, 'v_9');
    assert.deepEqual(comment.ai, { signalId: 'sig_1', decision: 'would_hide', topCategory: 'S10', topScore: 0.91, reviewStatus: 'pending', createdAt: '2026-11-02T10:00:01Z' });
    const lookups = t.calls.filter((c) => c.path === '/lookup');
    assert.ok(lookups.length <= 2, 'one lookup to fill copies, one for the page: no per-row calls');
  });

  it('fills the search copies, so search finds items by reporter, channel, uploader, title, reason and text', async () => {
    const t = setup(BASE);
    const keys = async (q: string, extra = '') => (await t.call(`/api/moderation/queue?q=${encodeURIComponent(q)}${extra}`)).body.result.items.map((g: any) => g.key);
    assert.deepEqual(await keys('rana'), ['video:v_1', 'comment:c_1'], 'reporter name');
    assert.deepEqual(await keys('SUNRISE'), ['video:v_1'], 'channel name, any case');
    assert.deepEqual(await keys('carl'), ['comment:c_1'], 'uploader name');
    assert.deepEqual(await keys('bad vid'), ['video:v_1'], 'title');
    assert.deepEqual(await keys('harass'), ['video:v_1'], 'reason');
    assert.deepEqual(await keys('swearing'), ['comment:c_1'], 'report text');
    assert.deepEqual(await keys('c_1'), ['comment:c_1'], 'exact id');
    // Matching one report shows the whole group
    const group = (await t.call('/api/moderation/queue?q=family')).body.result.items[0];
    assert.equal(group.reportCount, 3);
    const copies = await t.rows("SELECT reporter_name, channel_name, owner_name, meta_synced_at FROM reports WHERE id = 'r1'");
    assert.equal(copies[0].reporter_name, 'Rana Reporter');
    assert.equal(copies[0].channel_name, 'Sunrise Channel');
    assert.ok(copies[0].meta_synced_at);
  });

  it('filters by type, reason and date range, sorts, pages, and counts both tabs under the shared filters', async () => {
    const t = setup(BASE);
    const get = async (qs: string) => (await t.call(`/api/moderation/queue?${qs}`)).body.result;
    assert.deepEqual((await get('entityType=comment')).items.map((g: any) => g.key), ['comment:c_1']);
    assert.deepEqual((await get('reason=inappropriate')).items.map((g: any) => g.key), ['comment:c_1']);
    assert.deepEqual((await get('from=2026-11-04')).items.map((g: any) => g.key), ['video:v_1']);
    assert.deepEqual((await get('to=2026-11-01')).items.map((g: any) => g.key), ['video:v_1'], 'a bare date includes that whole day');
    assert.deepEqual((await get('sort=newest')).items.map((g: any) => g.key), ['video:v_1', 'comment:c_1']);
    assert.deepEqual((await get('sort=most_reports')).items.map((g: any) => g.key), ['video:v_1', 'comment:c_1']);
    const page2 = await get('pageSize=1&page=2');
    assert.deepEqual([page2.items.length, page2.total, page2.items[0].key], [1, 2, 'comment:c_1']);
    assert.deepEqual((await get('entityType=comment')).counts, { actionNeeded: 1, openReports: 1, history: 0 });
    assert.equal((await t.call('/api/moderation/queue?sort=loudest')).status, 400);
  });

  it('still lists from the stored copies when api-videos cannot be reached', async () => {
    const t = setup(BASE);
    await t.call('/api/moderation/queue');
    (t.env as any).VIDEOS = { fetch: async () => new Response('down', { status: 503 }) };
    const { status, body } = await t.call('/api/moderation/queue?q=sunrise');
    assert.equal(status, 200);
    const item = body.result.items[0].item;
    assert.equal(item.title, 'Bad video');
    assert.equal(item.found, null);
    assert.equal(item.owner.name, 'Omar Owner');
  });
});

describe('reports queue: History', () => {
  it('lists closed reports per report with who acted (by name), the action, notes and when; filters by action and moderator', async () => {
    const t = setup(BASE);
    const { body } = await t.call('/api/moderation/queue/history');
    assert.equal(body.result.total, 2);
    const [first, second] = body.result.items;
    assert.equal(first.reportId, 'r5', 'newest closed first');
    assert.deepEqual(first.moderator, { id: 'usr_mod', name: 'Maryam Moderator' });
    assert.equal(first.action, 'removed');
    assert.equal(first.closedAt, '2026-10-02T10:00:00Z');
    assert.equal(second.status, 'dismissed');
    assert.deepEqual((await t.call('/api/moderation/queue/history?action=dismissed')).body.result.items.map((r: any) => r.reportId), ['r6']);
    assert.equal((await t.call('/api/moderation/queue/history?moderatorId=usr_other')).body.result.total, 0);
    assert.deepEqual((await t.call('/api/moderation/queue/history?q=maryam&sort=oldest')).body.result.items.map((r: any) => r.reportId), ['r6', 'r5'], 'moderator name search');
  });
});

describe('reports queue: decisions', () => {
  it('`banned` bans the owner through the user ban path, hides the item, closes every open report and records the ban', async () => {
    const t = setup(BASE);
    const { status, body } = await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'banned', notes: 'repeat spammer' } });
    assert.equal(status, 200);
    assert.deepEqual(body.result.closed.sort(), ['r1', 'r2', 'r3']);
    assert.equal(body.result.contentAction.bannedUserId, 'usr_owner');
    const ban = t.calls.find((c) => c.method === 'POST' && c.path === '/users/usr_owner/ban');
    assert.ok(ban, 'api-videos /users/:id/ban was called');
    assert.deepEqual(ban!.body, { reason: 'repeat spammer' });
    assert.equal(ban!.actor, 'usr_mod');
    const audit = await t.rows("SELECT key, actor_id, new_value FROM site_settings_log WHERE key = 'content:user:usr_owner'");
    assert.equal(audit.length, 1);
    const value = JSON.parse(audit[0].new_value);
    assert.equal(value.action, 'ban');
    assert.deepEqual(value.details.reportIds.sort(), ['r1', 'r2', 'r3']);
    assert.equal(value.details.source, 'report');
    const reports = await t.rows("SELECT status, action, banned_user_id, moderator_notes FROM reports WHERE entity_id = 'v_1' AND id IN ('r1', 'r2', 'r3')");
    for (const r of reports) assert.deepEqual(r, { status: 'resolved', action: 'banned', banned_user_id: 'usr_owner', moderator_notes: 'repeat spammer' });
    assert.equal(t.videos.read('v_1').isHidden, true);
    assert.notEqual(t.videos.read('v_1').isDeleted, true, 'a ban hides, it does not delete');
    assert.equal(t.sent.length, 3, 'one ReportResolve per closed report');
  });

  it('a role without users:manage gets 403 for `banned`, and nothing changes', async () => {
    const t = setup(BASE);
    const res = await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', roles: 'moderator', json: { action: 'banned' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'forbidden');
    assert.equal(t.calls.filter((c) => c.path.endsWith('/ban')).length, 0);
    assert.equal((await t.rows("SELECT COUNT(*) AS n FROM reports WHERE entity_id = 'v_1' AND status IN ('pending', 'reviewing')"))[0].n, 3);
    assert.equal((await t.rows('SELECT COUNT(*) AS n FROM site_settings_log'))[0].n, 0);
    // Moderators keep every other outcome
    assert.equal((await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', roles: 'moderator', json: { action: 'removed' } })).status, 200);
  });

  it('a refused ban reopens the reports and leaves no audit row', async () => {
    const t = setup(BASE, { banStatus: 500 });
    const res = await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'banned' } });
    assert.equal(res.status, 503);
    assert.equal((await t.rows("SELECT COUNT(*) AS n FROM reports WHERE entity_id = 'v_1' AND status IN ('pending', 'reviewing')"))[0].n, 3);
    assert.equal((await t.rows('SELECT COUNT(*) AS n FROM site_settings_log'))[0].n, 0);
  });

  it('`banned` on an item whose owner cannot be found still closes the reports, banning nobody', async () => {
    const t = setup([{ id: 'x1', type: 'channel', entity: 'ch_fake', reporter: 'usr_r1', created: '2026-11-01T00:00:00Z' }]);
    const res = await t.call('/api/moderation/queue/items/channel/ch_fake/action', { method: 'POST', json: { action: 'banned' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.contentAction.bannedUserId, null);
    assert.equal(t.calls.filter((c) => c.path.endsWith('/ban')).length, 0);
  });

  it('`deleted` removes permanently; an item without open reports answers 409; bad input 400', async () => {
    const t = setup(BASE);
    assert.equal((await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'deleted' } })).status, 200);
    assert.equal(t.videos.read('v_1').isDeleted, true);
    assert.equal((await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'deleted' } })).status, 409);
    assert.equal((await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'nuke' } })).status, 400);
    assert.equal((await t.call('/api/moderation/queue/items/tweet/v_1')).status, 400);
  });

  it('the per-report action keeps its values and takes the same ban path and permission', async () => {
    const t = setup(BASE);
    const denied = await t.call('/api/moderation/reports/r1/action', { method: 'POST', roles: 'moderator', json: { action: 'banned' } });
    assert.equal(denied.status, 403);
    assert.equal((await t.rows("SELECT status FROM reports WHERE id = 'r1'"))[0].status, 'pending');
    const banned = await t.call('/api/moderation/reports/r1/action', { method: 'POST', json: { action: 'banned' } });
    assert.equal(banned.status, 200);
    assert.equal(banned.body.result.report.action, 'banned');
    assert.equal(banned.body.result.report.banned_user_id, 'usr_owner');
    assert.ok(t.calls.some((c) => c.path === '/users/usr_owner/ban'));
    assert.equal((await t.rows("SELECT status FROM reports WHERE id = 'r2'"))[0].status, 'pending', 'only that report closes');
    assert.equal((await t.call('/api/moderation/reports/r1/action', { method: 'POST', json: { action: 'banned' } })).status, 409, 'closed reports answer 409 before any permission check');
    for (const [id, action] of [['r2', 'warning'], ['r3', 'removed'], ['r4', 'dismissed']]) {
      const res = await t.call(`/api/moderation/reports/${id}/action`, { method: 'POST', roles: 'moderator', json: { action } });
      assert.equal(res.status, 200, action);
      assert.equal(res.body.result.report.action, action);
    }
  });
});

describe('reports queue: item and suggestions', () => {
  it('reads one item: group, open reports and its history', async () => {
    const t = setup(BASE);
    const { body } = await t.call('/api/moderation/queue/items/video/v_1');
    assert.equal(body.result.group.reportCount, 3);
    assert.deepEqual(body.result.open.map((r: any) => r.reportId), ['r1', 'r2', 'r3']);
    assert.deepEqual(body.result.history.map((r: any) => r.reportId), ['r6']);
    assert.equal(body.result.item.title, 'Bad video');
  });

  it('`report` suggestions are item groups (open first) that resolve by key', async () => {
    const t = setup(BASE);
    await t.call('/api/moderation/queue');
    const { body } = await t.call('/api/suggest/report?q=reporter');
    assert.deepEqual(body.result.items.map((s: any) => [s.id, s.count]), [['video:v_1', 3], ['comment:c_1', 1], ['video:v_2', 0]]);
    const first = body.result.items[0];
    assert.deepEqual([first.kind, first.label, first.secondary], ['report', 'Bad video', 'Sunrise Channel · Omar Owner']);
    const one = await t.call('/api/suggest/report/comment%3Ac_1');
    assert.equal(one.body.result.item.label, 'rude words');
    assert.equal((await t.call('/api/suggest/report/bogus')).body.result.item, null);
  });
});

describe('report copies fill', () => {
  it('is idempotent, keeps a removed item\'s title, and drops an erased reporter\'s name', async () => {
    const t = setup(BASE);
    assert.equal(await syncReportMeta(t.env as never), 6);
    assert.equal(await syncReportMeta(t.env as never), 0, 'nothing due on a second run');
    delete ITEMS['video:v_1'];
    try {
      await t.db.prepare("UPDATE reports SET meta_synced_at = NULL, reporter_id = 'deleted-user' WHERE id = 'r1'").run();
      await syncReportMeta(t.env as never);
      const [row] = await t.rows("SELECT entity_title, channel_name, reporter_name, owner_name FROM reports WHERE id = 'r1'");
      assert.deepEqual(row, { entity_title: 'Bad video', channel_name: 'Sunrise Channel', reporter_name: null, owner_name: 'Omar Owner' });
    } finally {
      ITEMS['video:v_1'] = { found: true, title: 'Bad video', parentId: null, channelId: 'ch_1', channelName: 'Sunrise Channel', ownerId: 'usr_owner', isHidden: false, isDeleted: false };
    }
  });

  it('does nothing without api-videos', async () => {
    const t = setup(BASE);
    assert.equal(await syncReportMeta({ REPORTS_DB: t.db } as never), 0);
  });
});
