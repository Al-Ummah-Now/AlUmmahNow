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
import { eraseTombstoneKey, reportOutcomeOptions } from '@al-ummah/shared-types';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sqliteD1 } from './d1-sqlite';
import { MemoryR2 } from './r2-fake';

interface VideosCall { method: string; path: string; body: any; actor: string | null }

const ITEMS: Record<string, any> = {
  'video:v_1': { found: true, title: 'Bad video', parentId: null, channelId: 'ch_1', channelName: 'Sunrise Channel', ownerId: 'usr_owner', isHidden: false, isDeleted: false },
  'live_chat:m_1': { found: true, title: 'rude message', parentId: 's_1', channelId: 'ch_1', channelName: 'Sunrise Channel', ownerId: 'usr_commenter', isHidden: false, isDeleted: false },
  'livestream:s_1': { found: true, title: 'Halqa', parentId: null, channelId: 'ch_1', channelName: 'Sunrise Channel', ownerId: 'usr_owner', isHidden: false, isDeleted: false },
  'comment:pc_1': { found: true, title: 'rude reply', parentId: 'p_1', parentType: 'post', channelId: 'ch_2', channelName: 'Other Channel', ownerId: 'usr_commenter', isHidden: false, isDeleted: false },
  'post:p_1': { found: true, title: 'bad post', parentId: null, channelId: 'ch_2', channelName: 'Other Channel', ownerId: 'usr_owner', isHidden: false, isDeleted: false },
  'comment:c_1': { found: true, title: 'rude words', parentId: 'v_9', parentType: 'video', channelId: 'ch_2', channelName: 'Other Channel', ownerId: 'usr_commenter', isHidden: false, isDeleted: false },
};
const USERS: Record<string, any> = {
  usr_owner: { displayName: 'Omar Owner', isBanned: false },
  usr_commenter: { displayName: 'Carl Commenter', isBanned: true },
  usr_r1: { displayName: 'Rana Reporter', isBanned: false },
  usr_r2: { displayName: 'Sami Reporter', isBanned: false },
  usr_r3: { displayName: 'Huda Reporter', isBanned: false },
  usr_mod: { displayName: 'Maryam Moderator', isBanned: false },
};

interface FakeOptions { users?: typeof USERS; banStatus?: number; live?: { status?: number; found?: boolean; changed?: boolean }; hold?: { status?: number; found?: boolean; changed?: boolean }; deleteStatus?: number; lookupDown?: boolean; revokeStatus?: number }

function fakeVideos(opts: FakeOptions = {}) {
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
      if (call.path === '/comment-moderation') {
        const { status, found = true, changed = true } = opts.hold ?? {};
        return status ? json(status, { success: false, code: 'boom', error: 'refused' }) : json(200, { success: true, result: { found, changed } });
      }
      if (call.method === 'DELETE' && /^\/(?:videos\/[^/]+\/comments|posts\/[^/]+)\/[^/]+$/.test(call.path)) {
        return opts.deleteStatus ? json(opts.deleteStatus, { success: false, code: 'boom', error: 'refused' }) : json(200, { success: true, result: { deleted: true } });
      }
      if (call.path === '/lookup' && opts.lookupDown) return json(503, { success: false, code: 'down', error: 'down' });
      if (call.path === '/lookup') {
        const items = call.body.items.map((i: { type: string; id: string }) => ({ type: i.type, id: i.id, ...(ITEMS[`${i.type}:${i.id}`] ?? { found: false, title: null, parentId: null, channelId: null, channelName: null, ownerId: null, isHidden: null, isDeleted: null }) }));
        const ids = [...new Set([...call.body.users, ...items.map((i: any) => i.ownerId).filter(Boolean)])] as string[];
        const users = ids.map((id) => {
          const user = (opts.users ?? USERS)[id];
          return { id, found: !!user, displayName: user?.displayName ?? null, userName: user?.userName ?? null, email: user?.email ?? null, isBanned: user?.isBanned ?? false };
        });
        return json(200, { success: true, result: { items, users } });
      }
      if (/^\/users\/[^/]+\/ban$/.test(call.path)) {
        if (opts.banStatus) return json(opts.banStatus, { success: false, code: 'boom', error: 'refused' });
        return json(200, { success: true, result: { ban: { userId: call.path.split('/')[2] }, job: { id: 'job_1' } } });
      }
      if (call.path === '/live-moderation') {
        const { status, found = true, changed = true } = opts.live ?? {};
        return status ? json(status, { success: false, code: 'boom', error: 'refused' }) : json(200, { success: true, result: { found, changed } });
      }
      if (/^\/videos\/[^/]+\/revoke-downloads$/.test(call.path)) {
        if (opts.revokeStatus) return json(opts.revokeStatus, { success: false, code: 'revoke_failed', error: 'failed' });
        return json(200, { success: true, result: { status: 'revoked', eventId: call.body?.eventId, videoId: call.path.split('/')[2], seq: 1, inserted: true, renditionsDeleted: 0 } });
      }
      return json(404, { success: false, code: 'not_found', error: 'no route' });
    },
  };
  return { fetcher, calls };
}

type Seed = { id: string; type?: string; entity: string; reporter: string; reason?: string; description?: string; status?: string; created: string; action?: string; moderator?: string; resolved?: string };

function setup(reports: Seed[], opts: FakeOptions = {}) {
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
    assert.match(q.page.sql, /ORDER BY [^)]*child_safety[^)]* DESC, report_count DESC/);
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
    assert.deepEqual(counts, { actionNeeded: 2, openReports: 4, openChildSafety: 0, history: 2, capped: false });
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

  it('uses a name or email for owners in the queue and in refreshed copies', async () => {
    const t = setup(BASE, { users: {
      ...USERS,
      usr_owner: { displayName: '  ', userName: '@legacy-owner', email: 'owner@example.com' },
      usr_commenter: { userName: '@legacy-commenter', isBanned: true },
    } });
    await syncReportMeta(t.env);
    assert.deepEqual(await t.rows("SELECT owner_name FROM reports WHERE id IN ('r1', 'r4') ORDER BY id"), [
      { owner_name: 'owner@example.com' }, { owner_name: null },
    ]);

    await t.db.prepare("UPDATE reports SET owner_name = '@old' WHERE owner_id = 'usr_owner'").run();
    const { body } = await t.call('/api/moderation/queue');
    assert.deepEqual(body.result.items.map((g: any) => g.item.owner), [
      { id: 'usr_owner', name: 'owner@example.com', isBanned: false },
      { id: 'usr_commenter', name: null, isBanned: true },
    ]);
    assert.deepEqual(await t.rows("SELECT owner_name FROM reports WHERE id = 'r1'"), [{ owner_name: 'owner@example.com' }]);

    await t.db.prepare("UPDATE reports SET owner_name = '@old' WHERE owner_id = 'usr_commenter'").run();
    (t.env as any).VIDEOS = { fetch: async () => new Response('down', { status: 503 }) };
    const offline = (await t.call('/api/moderation/queue')).body.result.items;
    assert.deepEqual(offline.map((g: any) => g.item.owner.name), ['owner@example.com', null]);
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
    assert.deepEqual((await get('entityType=comment')).counts, { actionNeeded: 1, openReports: 1, openChildSafety: 0, history: 0, capped: false });
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

  it('an item that is not there any more keeps its reports open, whatever its type and the outcome', async () => {
    const missing: Record<string, string[]> = {
      video: ['warning', 'removed', 'banned', 'deleted'],
      channel: ['warning', 'removed', 'banned', 'deleted'],
      playlist: ['warning', 'removed', 'banned', 'deleted'],
      livestream: ['warning', 'removed', 'banned', 'deleted'],
      live_chat: ['removed', 'banned', 'deleted'],
      comment: ['removed', 'banned', 'deleted'],
      post: ['banned', 'deleted'],
    };
    for (const [type, actions] of Object.entries(missing)) {
      for (const action of actions) {
        const t = setup([{ id: 'x1', type, entity: 'gone_1', reporter: 'usr_r1', created: '2026-11-01T00:00:00Z' }], { live: { found: false, changed: false } });
        const res = await t.call(`/api/moderation/queue/items/${type}/gone_1/action`, { method: 'POST', json: { action } });
        assert.deepEqual([res.status, res.body.code], [409, 'item_gone'], `${type} ${action}`);
        assert.deepEqual(await t.rows('SELECT status, action, moderator_id, resolved_at FROM reports'), [{ status: 'pending', action: null, moderator_id: null, resolved_at: null }], `${type} ${action}`);
        assert.equal(t.sent.length, 0, 'nobody is told it was resolved');
        assert.equal((await t.rows('SELECT COUNT(*) AS n FROM site_settings_log'))[0].n, 0, 'no audit row of something that did not happen');
        // It can still be dismissed
        assert.equal((await t.call(`/api/moderation/queue/items/${type}/gone_1/action`, { method: 'POST', json: { action: 'dismissed' } })).status, 200);
      }
    }
  });

  describe('comments and posts', () => {
    const report = (type: string, entity: string): Seed[] => [{ id: 'x1', type, entity, reporter: 'usr_r1', created: '2026-11-01T00:00:00Z' }];
    const act = (t: ReturnType<typeof setup>, type: string, id: string, action: string, roles = 'admin') => t.call(`/api/moderation/queue/items/${type}/${id}/action`, { method: 'POST', roles, json: { action, notes: 'why' } });
    const closed = async (t: ReturnType<typeof setup>) => (await t.rows('SELECT status, action FROM reports'))[0];
    const audit = async (t: ReturnType<typeof setup>) => (await t.rows('SELECT key, actor_id, new_value FROM site_settings_log')).map((r: any) => ({ key: r.key, by: r.actor_id, ...JSON.parse(r.new_value) }));

    for (const [id, on, parentId] of [['c_1', 'video', 'v_9'], ['pc_1', 'post', 'p_1']] as const) {
      it(`removed hides a comment on a ${on} (a moderator may), audited`, async () => {
        const t = setup(report('comment', id));
        const res = await act(t, 'comment', id, 'removed', 'moderator');
        assert.equal(res.status, 200);
        assert.equal(res.body.result.contentAction.performed, true);
        const call = t.calls.find((c) => c.path === '/comment-moderation')!;
        assert.deepEqual([call.body, call.actor], [{ on, parentId, commentId: id }, 'usr_mod']);
        assert.deepEqual(await closed(t), { status: 'resolved', action: 'removed' });
        assert.deepEqual(await audit(t), [{ key: `content:comment:${id}`, by: 'usr_mod', action: 'hide', details: { on, parentId, source: 'report', reportIds: ['x1'], reason: 'why' } }]);
      });
    }

    it('deleted deletes a video comment through the admin delete, audited and restorable', async () => {
      const t = setup(report('comment', 'c_1'));
      assert.equal((await act(t, 'comment', 'c_1', 'deleted')).status, 200);
      const call = t.calls.find((c) => c.method === 'DELETE')!;
      assert.deepEqual([call.path, call.body, call.actor], ['/videos/v_9/comments/c_1', { reason: 'why' }, 'usr_mod']);
      assert.deepEqual(await closed(t), { status: 'resolved', action: 'deleted' });
      const [row] = await audit(t);
      assert.deepEqual([row.key, row.action, row.details.videoId, row.details.soft], ['content:comment:c_1', 'delete', 'v_9', true]);
    });

    it('deleted and banned delete a post through the admin delete', async () => {
      const t = setup(report('post', 'p_1'));
      assert.equal((await act(t, 'post', 'p_1', 'deleted')).status, 200);
      assert.equal(t.calls.find((c) => c.method === 'DELETE')!.path, '/posts/ch_2/p_1');
      assert.deepEqual(await closed(t), { status: 'resolved', action: 'deleted' });
      const b = setup(report('post', 'p_1'));
      const res = await act(b, 'post', 'p_1', 'banned');
      assert.equal(res.body.result.contentAction.bannedUserId, 'usr_owner');
      assert.ok(b.calls.some((c) => c.method === 'DELETE' && c.path === '/posts/ch_2/p_1'));
    });

    it('banned bans the comment author (never the video owner) and hides the comment', async () => {
      const t = setup(report('comment', 'c_1'));
      const res = await act(t, 'comment', 'c_1', 'banned');
      assert.equal(res.body.result.contentAction.bannedUserId, 'usr_commenter');
      assert.deepEqual(t.calls.filter((c) => c.path.endsWith('/ban')).map((c) => c.path), ['/users/usr_commenter/ban']);
      assert.ok(t.calls.some((c) => c.path === '/comment-moderation'));
      assert.equal(t.videos.read('v_1').isHidden, undefined);
    });

    it('an outcome the type does not have is refused and the report stays open', async () => {
      for (const [type, id, action] of [['comment', 'c_1', 'warning'], ['comment', 'pc_1', 'deleted'], ['post', 'p_1', 'removed'], ['post', 'p_1', 'warning'], ['live_chat', 'm_1', 'warning']]) {
        const t = setup(report(type, id));
        const res = await act(t, type, id, action);
        assert.deepEqual([res.status, res.body.code], [409, 'outcome_not_available'], `${type} ${action}`);
        assert.deepEqual(await closed(t), { status: 'pending', action: null });
        const one = await t.call('/api/moderation/reports/x1/action', { method: 'POST', json: { action } });
        assert.deepEqual([one.status, one.body.code], [409, 'outcome_not_available'], `${type} ${action}, from the report page`);
        assert.equal(t.sent.length, 0);
      }
    });

    it('deleting needs content:delete, as on the content lists', async () => {
      for (const [type, id] of [['comment', 'c_1'], ['post', 'p_1']]) {
        const t = setup(report(type, id));
        assert.equal((await act(t, type, id, 'deleted', 'moderator')).status, 403);
        assert.deepEqual(await closed(t), { status: 'pending', action: null });
        assert.equal(t.calls.filter((c) => c.method === 'DELETE').length, 0);
      }
    });

    it('banning over a post needs content:delete too, checked before anyone is banned', () => {
      const may = (p: string) => p === 'users:manage';
      const banned = (type: 'post' | 'comment' | 'video', found = true) => reportOutcomeOptions({ type, item: { found }, ownerKnown: true, may }).find((o) => o.action === 'banned')!;
      assert.deepEqual(banned('post'), { action: 'banned', available: false, reason: 'permission' });
      assert.equal(banned('comment').available, true);
      assert.equal(banned('video').available, true);
      assert.equal(banned('post', false).available, true, 'a post that is gone leaves nothing to delete');
    });

    it('the person who made something that is gone can still be banned, when its reports say who', async () => {
      for (const [type, id] of [['comment', 'gone_c'], ['post', 'gone_p'], ['video', 'gone_v'], ['live_chat', 'gone_m']]) {
        const t = setup(report(type, id), { live: { found: false, changed: false } });
        await t.db.prepare("UPDATE reports SET owner_id = 'usr_commenter'").run();
        assert.equal((await act(t, type, id, 'removed')).status, 409);
        const res = await act(t, type, id, 'banned');
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.result.contentAction.bannedUserId, 'usr_commenter');
        assert.deepEqual(await closed(t), { status: 'resolved', action: 'banned' });
        // Not someone whose account was erased
        const e = setup(report(type, id), { live: { found: false, changed: false } });
        await e.db.prepare("UPDATE reports SET owner_id = 'deleted-user'").run();
        assert.equal((await act(e, type, id, 'banned')).body.code, 'item_gone');
        assert.equal(e.calls.filter((c) => c.path.endsWith('/ban')).length, 0);
        // Not when its reports name two people, or one was erased since, or an erasure has not reached them yet
        for (const [first, second, tombstone] of [['usr_owner', 'usr_commenter', null], ['deleted-user', 'usr_commenter', null], ['usr_commenter', 'usr_commenter', 'usr_commenter']] as const) {
          const u = setup([...report(type, id), { id: 'x2', type, entity: id, reporter: 'usr_r2', created: '2026-11-02T00:00:00Z' }], { live: { found: false, changed: false } });
          await u.db.prepare("UPDATE reports SET owner_id = CASE id WHEN 'x1' THEN ? ELSE ? END").bind(first, second).run();
          if (tombstone) await u.db.prepare('INSERT INTO erased_users (user_key, erased_at) VALUES (?, ?)').bind(await eraseTombstoneKey(tombstone), 1).run();
          const shown = await u.call(`/api/moderation/queue/items/${type}/${id}`);
          assert.equal(shown.body.result.outcomes.find((o: any) => o.action === 'banned').available, false, `${first} ${second}`);
          assert.equal((await act(u, type, id, 'banned')).body.code, 'item_gone', `${first} ${second}`);
          assert.equal(u.calls.filter((c) => c.path.endsWith('/ban')).length, 0);
        }
      }
    });

    it('a failed change reopens the report and leaves no audit row', async () => {
      for (const [type, id, action, opts] of [['comment', 'c_1', 'removed', { hold: { status: 500 } }], ['comment', 'c_1', 'deleted', { deleteStatus: 500 }], ['post', 'p_1', 'deleted', { deleteStatus: 500 }]] as const) {
        const t = setup(report(type, id), opts);
        assert.equal((await act(t, type, id, action)).status, 503);
        assert.deepEqual(await closed(t), { status: 'pending', action: null });
        assert.equal((await audit(t)).length, 0);
      }
    });

    it('gone between the read and the change: the report stays open; api-videos unreachable: too', async () => {
      const gone = setup(report('comment', 'c_1'), { hold: { found: false, changed: false } });
      assert.equal((await act(gone, 'comment', 'c_1', 'removed')).body.code, 'item_gone');
      assert.deepEqual(await closed(gone), { status: 'pending', action: null });
      assert.equal((await audit(gone)).length, 0);
      const deleted = setup(report('post', 'p_1'), { deleteStatus: 404 });
      assert.equal((await act(deleted, 'post', 'p_1', 'deleted')).body.code, 'item_gone');
      assert.deepEqual(await closed(deleted), { status: 'pending', action: null });
      const down = setup(report('comment', 'c_1'), { lookupDown: true });
      assert.equal((await act(down, 'comment', 'c_1', 'removed')).status, 503);
      assert.deepEqual(await closed(down), { status: 'pending', action: null });
      assert.equal((await act(down, 'comment', 'c_1', 'dismissed')).status, 200);
    });

    it('already hidden: the decision stands, with no second audit row', async () => {
      const t = setup(report('comment', 'c_1'), { hold: { found: true, changed: false } });
      const res = await act(t, 'comment', 'c_1', 'removed');
      assert.deepEqual([res.status, res.body.result.contentAction.performed], [200, false]);
      assert.equal((await audit(t)).length, 0);
    });

    it('the report page is told what may be chosen and why the rest may not', async () => {
      const options = async (type: string, id: string, roles = 'admin') => {
        const t = setup(report(type, id));
        const one = (await t.call('/api/moderation/reports/x1', { roles })).body.result.outcomes;
        assert.deepEqual((await t.call(`/api/moderation/queue/items/${type}/${id}`, { roles })).body.result.outcomes, one, 'the queue says the same');
        return Object.fromEntries(one.map((o: any) => [o.action, o.reason ?? 'ok']));
      };
      assert.deepEqual(await options('video', 'v_1'), { warning: 'ok', removed: 'ok', banned: 'ok', deleted: 'ok', dismissed: 'ok' });
      assert.deepEqual(await options('comment', 'c_1'), { warning: 'not_for_type', removed: 'ok', banned: 'ok', deleted: 'ok', dismissed: 'ok' });
      assert.deepEqual(await options('comment', 'c_1', 'moderator'), { warning: 'not_for_type', removed: 'ok', banned: 'permission', deleted: 'permission', dismissed: 'ok' });
      assert.deepEqual(await options('comment', 'pc_1'), { warning: 'not_for_type', removed: 'ok', banned: 'ok', deleted: 'not_for_post_comment', dismissed: 'ok' });
      assert.deepEqual(await options('post', 'p_1'), { warning: 'not_for_type', removed: 'not_for_type', banned: 'ok', deleted: 'ok', dismissed: 'ok' });
      for (const type of ['video', 'channel', 'playlist', 'livestream']) assert.deepEqual(await options(type, 'nope'), { warning: 'item_gone', removed: 'item_gone', banned: 'item_gone', deleted: 'item_gone', dismissed: 'ok' }, type);
      assert.deepEqual(await options('live_chat', 'nope'), { warning: 'not_for_type', removed: 'item_gone', banned: 'item_gone', deleted: 'item_gone', dismissed: 'ok' });
      assert.deepEqual(await options('post', 'p_1', 'moderator'), { warning: 'not_for_type', removed: 'not_for_type', banned: 'permission', deleted: 'permission', dismissed: 'ok' });
      assert.deepEqual(await options('comment', 'nope'), { warning: 'not_for_type', removed: 'item_gone', banned: 'item_gone', deleted: 'item_gone', dismissed: 'ok' });
    });
  });

  it('`deleted` removes permanently; an item without open reports answers 409; bad input 400', async () => {
    const t = setup(BASE);
    assert.equal((await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'deleted', notes: 'urgent takedown' } })).status, 200);
    assert.equal(t.videos.read('v_1').isDeleted, true);
    const revokeCalls = t.calls.filter((c) => c.path === '/videos/v_1/revoke-downloads');
    assert.equal(revokeCalls.length, 1, 'video deleted must trigger revoke-downloads');
    assert.equal(revokeCalls[0]!.actor, 'usr_mod');
    assert.match(revokeCalls[0]!.body.eventId, /^admin:report-[0-9a-f]{32}$/);
    assert.equal((await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'deleted' } })).status, 409);
    assert.equal((await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'nuke' } })).status, 400);
    assert.equal((await t.call('/api/moderation/queue/items/tweet/v_1')).status, 400);
  });

  it('download revocation hook (E14-S11a) fires only for video deleted, reopens on failure, and keeps deterministic eventId on retry', async () => {
    // 1) Non-deleted actions and non-video entities must NOT call /revoke-downloads.
    const tOther = setup(BASE);
    assert.equal((await tOther.call('/api/moderation/reports/r1/action', { method: 'POST', json: { action: 'removed' } })).status, 200);
    assert.equal((await tOther.call('/api/moderation/reports/r2/action', { method: 'POST', json: { action: 'warning' } })).status, 200);
    assert.equal((await tOther.call('/api/moderation/reports/r4/action', { method: 'POST', json: { action: 'deleted' } })).status, 200);
    assert.equal(tOther.calls.filter((c) => c.path.endsWith('/revoke-downloads')).length, 0);

    // 2) If /revoke-downloads fails, decide() returns 503 and reopens the reports; retrying the
    //    same decision reuses the exact same deterministic eventId.
    const tFail = setup(BASE, { revokeStatus: 500 });
    const first = await tFail.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'deleted' } });
    assert.equal(first.status, 503);
    assert.equal(first.body.code, 'not_applied');
    assert.equal((await tFail.rows("SELECT COUNT(*) AS n FROM reports WHERE entity_id = 'v_1' AND status IN ('pending', 'reviewing')"))[0].n, 3);

    const second = await tFail.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'deleted' } });
    assert.equal(second.status, 503);
    const revokeCalls = tFail.calls.filter((c) => c.path === '/videos/v_1/revoke-downloads');
    assert.equal(revokeCalls.length, 2);
    assert.equal(revokeCalls[0]!.body.eventId, revokeCalls[1]!.body.eventId, 'retry on same reopened reports must reuse eventId');
  });

  it('keeps reports open when the video service is unavailable for a permanent takedown', async () => {
    const t = setup(BASE);
    const binding = t.env.VIDEOS;
    Reflect.deleteProperty(t.env, 'VIDEOS');
    const rows = () => t.rows("SELECT id, status, action FROM reports WHERE id IN ('r1', 'r2', 'r3') ORDER BY id");
    const before = await rows();
    const decide = () => t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'deleted' } });

    const failed = await decide();
    assert.equal(failed.status, 503);
    assert.equal(failed.body.code, 'not_applied');
    assert.deepEqual(await rows(), before);
    assert.equal(t.sent.length, 0);
    assert.equal(t.videos.read('v_1').isHidden, true);

    t.env.VIDEOS = binding;
    assert.equal((await decide()).status, 200);
    assert.equal(t.calls.filter((call) => call.path === '/videos/v_1/revoke-downloads').length, 1);
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

  describe('erased people', () => {
    const AT = Date.parse('2026-11-20T00:00:00Z');
    const erase = async (t: ReturnType<typeof setup>, id: string) => void (await t.db.prepare('INSERT INTO erased_users (user_key, erased_at) VALUES (?, ?)').bind(await eraseTombstoneKey(id), AT).run());
    const copies = (t: ReturnType<typeof setup>, id: string) => t.rows('SELECT entity_title, channel_name, owner_id, owner_name FROM reports WHERE id = ?', id).then((r) => r[0]);

    it('a row not filled before the erasure is filled without them, while the index still has them', async () => {
      const t = setup(BASE);
      await erase(t, 'usr_owner');
      await erase(t, 'usr_commenter');
      await syncReportMeta(t.env as never);
      assert.deepEqual(await copies(t, 'r1'), { entity_title: null, channel_name: null, owner_id: 'deleted-user', owner_name: null });
      // A comment keeps the name of the channel it was written on
      assert.deepEqual(await copies(t, 'r4'), { entity_title: null, channel_name: 'Other Channel', owner_id: 'deleted-user', owner_name: null });
      assert.equal((await t.rows("SELECT COUNT(*) AS n FROM reports WHERE owner_id IN ('usr_owner', 'usr_commenter')"))[0].n, 0);
    });

    it('a refresh and the queue page never write them back, and the page does not show them', async () => {
      const t = setup(BASE);
      await syncReportMeta(t.env as never);
      await erase(t, 'usr_owner');
      await erase(t, 'usr_commenter');
      await erase(t, 'usr_r1');
      await t.db.prepare("UPDATE reports SET owner_id = 'deleted-user', owner_name = NULL, entity_title = NULL, channel_name = CASE WHEN entity_type = 'comment' THEN channel_name END WHERE owner_id IN ('usr_owner', 'usr_commenter')").run();
      await t.db.prepare('UPDATE reports SET meta_synced_at = NULL').run();
      const { body } = await t.call('/api/moderation/queue');
      for (const secret of ['Omar Owner', 'Carl Commenter', 'Bad video', 'rude words', 'usr_owner', 'usr_commenter', 'Rana Reporter']) assert.ok(!JSON.stringify(body).includes(secret), secret);
      await syncReportMeta(t.env as never);
      for (const id of ['r1', 'r4']) assert.deepEqual([(await copies(t, id)).owner_id, (await copies(t, id)).owner_name, (await copies(t, id)).entity_title], ['deleted-user', null, null]);
    });

    it('what they wrote never comes back, even after their tombstone is purged; other content may have a new owner', async () => {
      const t = setup(BASE);
      await t.db.prepare("UPDATE reports SET owner_id = 'deleted-user'").run();
      const { body } = await t.call('/api/moderation/queue');
      const item = (await t.call('/api/moderation/queue/items/comment/c_1')).body;
      for (const secret of ['rude words', 'usr_commenter', 'Carl Commenter']) for (const shown of [body, item]) assert.ok(!JSON.stringify(shown).includes(secret), secret);
      await syncReportMeta(t.env as never);
      assert.deepEqual(await copies(t, 'r4'), { entity_title: null, channel_name: 'Other Channel', owner_id: 'deleted-user', owner_name: null });
      assert.equal((await copies(t, 'r1')).owner_id, 'usr_owner');
      // Nor are they banned for it, and a new report about it does not learn who wrote it
      await t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason) VALUES ('r7', 'comment', 'c_1', 'usr_r2', 'spam')").run();
      await syncReportMeta(t.env as never);
      assert.equal((await copies(t, 'r7')).owner_id, 'deleted-user');
      assert.equal((await t.call('/api/moderation/queue/items/comment/c_1/action', { method: 'POST', json: { action: 'banned' } })).status, 200);
      assert.ok(!t.calls.some((c) => c.path.startsWith('/users/')));
    });

    it('nobody is banned for the content of an erased person', async () => {
      const t = setup(BASE);
      await erase(t, 'usr_owner');
      const res = await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'banned' } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok(!t.calls.some((c) => c.path.startsWith('/users/')));
      assert.deepEqual(await t.rows("SELECT DISTINCT banned_user_id FROM reports WHERE entity_id = 'v_1'"), [{ banned_user_id: null }]);
    });

    // The processor's order: the tombstone, then the clearing pass
    const eraseNow = async (t: ReturnType<typeof setup>, id: string) => {
      await erase(t, id);
      await t.db.prepare("UPDATE reports SET reporter_id = 'deleted-user', reporter_name = NULL WHERE reporter_id = ?").bind(id).run();
      await t.db.prepare("UPDATE reports SET owner_id = 'deleted-user', owner_name = NULL, entity_title = NULL, channel_name = NULL WHERE owner_id = ?").bind(id).run();
      await t.db.prepare("UPDATE reports SET banned_user_id = 'deleted-user' WHERE banned_user_id = ?").bind(id).run();
    };
    const everything = async (t: ReturnType<typeof setup>) => JSON.stringify(await t.rows('SELECT * FROM reports'));

    for (const [name, write] of [
      ['the fill', async (t: ReturnType<typeof setup>) => void (await syncReportMeta(t.env as never))],
      ['the queue page', async (t: ReturnType<typeof setup>) => void (await t.call('/api/moderation/queue/items/video/v_1'))],
    ] as const) {
      it(`an erasure between reading people and writing them: ${name} is refused, and the next run is without them`, async () => {
        const t = setup(BASE);
        const batch = t.db.batch.bind(t.db);
        let erasing = true;
        (t.env as any).REPORTS_DB = { prepare: t.db.prepare, batch: async (list: never) => { if (erasing) { erasing = false; for (const id of ['usr_owner', 'usr_commenter', 'usr_r1']) await eraseNow(t, id); } return batch(list); } };
        await write(t);
        assert.equal(erasing, false, 'the erasure ran inside the write');
        for (const secret of ['usr_owner', 'Omar Owner', 'usr_commenter', 'Carl Commenter', 'rude words', 'Rana Reporter']) assert.ok(!(await everything(t)).includes(secret), secret);
        await syncReportMeta(t.env as never);
        for (const secret of ['usr_owner', 'Omar Owner', 'usr_commenter', 'Carl Commenter', 'rude words', 'Rana Reporter']) assert.ok(!(await everything(t)).includes(secret), secret);
        // Nothing is held back by it: every row was filled
        assert.equal((await t.rows('SELECT COUNT(*) AS n FROM reports WHERE meta_synced_at IS NULL'))[0].n, 0);
      });
    }

    it('an erasure while the ban is being made leaves no id on the report', async () => {
      const t = setup(BASE);
      const fetch = t.env.VIDEOS.fetch;
      t.env.VIDEOS.fetch = async (input: string, init: RequestInit = {}) => { const res = await fetch(input, init); if (/\/ban$/.test(new URL(input).pathname)) await eraseNow(t, 'usr_owner'); return res; };
      assert.equal((await t.call('/api/moderation/queue/items/video/v_1/action', { method: 'POST', json: { action: 'banned' } })).status, 200);
      assert.ok(t.calls.some((c) => c.path === '/users/usr_owner/ban'));
      assert.deepEqual(await t.rows("SELECT DISTINCT banned_user_id FROM reports WHERE entity_id = 'v_1' AND action = 'banned'"), [{ banned_user_id: 'deleted-user' }]);
    });

    it('the guards use indexes', async () => {
      const t = setup(BASE);
      const seen: string[] = [];
      const prepare = t.db.prepare.bind(t.db);
      (t.env as any).REPORTS_DB = { batch: t.db.batch.bind(t.db), prepare: (sql: string) => (seen.push(sql), prepare(sql)) };
      await syncReportMeta(t.env as never);
      const guarded = seen.filter((sql) => /erased_users|owner_id = \?/.test(sql));
      assert.ok(guarded.length >= 3);
      assert.equal(guarded.filter((sql) => /owner_id = \?$/.test(sql.trim())).length, 1, 'the mark is read once for the page');
      for (const sql of guarded) {
        const n = sql.includes('?1') ? 12 : (sql.match(/\?/g) ?? []).length;
        const plan = ((await prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...Array(n).fill('[]')).all()).results as any[]).map((r) => r.detail);
        assert.ok(plan.length > 0, sql);
        assert.ok(!plan.some((d) => /idx_reports_owner/.test(d)), plan.join(' | '));
        if (/owner_id = \?$/.test(sql.trim())) assert.ok(plan.some((d) => /^SEARCH r USING INDEX idx_reports_entity \(entity_type=\? AND entity_id=\?\)/.test(d)), plan.join(' | '));
        assert.ok(!plan.some((d) => /^SCAN (reports|erased_users)/.test(d)), plan.join(' | '));
      }
    });

    it('while erased people cannot be read, nothing is read back', async () => {
      const t = setup(BASE);
      const prepare = t.db.prepare.bind(t.db);
      (t.env as any).REPORTS_DB = { ...t.db, batch: t.db.batch, prepare: (sql: string) => { if (/erased_users/.test(sql)) throw new Error('D1 is down'); return prepare(sql); } };
      assert.equal(await syncReportMeta(t.env as never), 0);
      assert.equal((await copies(t, 'r1')).owner_id, null);
    });
  });

  it('does nothing without api-videos', async () => {
    const t = setup(BASE);
    assert.equal(await syncReportMeta({ REPORTS_DB: t.db } as never), 0);
  });
});

describe('live streams and live chat (wiki E17 §5.2)', () => {
  const LIVE: Seed[] = [
    { id: 'm1', type: 'live_chat', entity: 'm_1', reporter: 'usr_r1', created: '2026-11-20T10:00:00Z' },
    { id: 'm2', type: 'live_chat', entity: 'm_1', reporter: 'usr_r2', created: '2026-11-20T10:01:00Z' },
    { id: 's1', type: 'livestream', entity: 's_1', reporter: 'usr_r1', created: '2026-11-20T10:02:00Z' },
  ];
  const act = (t: ReturnType<typeof setup>, item: string, action: string) => t.call(`/api/moderation/queue/items/${item}/action`, { method: 'POST', json: { action, notes: 'reason' } });
  const sentOf = (t: ReturnType<typeof setup>) => t.calls.filter((c) => c.path === '/live-moderation').map((c) => [c.body.entityType, c.body.entityId, c.body.action, c.body.notes, c.actor]);

  it('a decision is sent to api-videos, which owns the record, and closes every report of the item', async () => {
    const t = setup(LIVE);
    const done = await act(t, 'live_chat/m_1', 'removed');
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual(sentOf(t), [['live_chat', 'm_1', 'removed', 'reason', 'usr_mod']]);
    assert.deepEqual((await t.rows("SELECT id, status FROM reports WHERE entity_type = 'live_chat' ORDER BY id")).map((r: any) => [r.id, r.status]), [['m1', 'resolved'], ['m2', 'resolved']]);
    assert.equal((await act(t, 'livestream/s_1', 'removed')).status, 200);
    assert.deepEqual(sentOf(t)[1], ['livestream', 's_1', 'removed', 'reason', 'usr_mod']);
  });

  it('a decision api-videos refuses opens the reports again', async () => {
    const t = setup(LIVE, { live: { status: 500 } });
    assert.equal((await act(t, 'live_chat/m_1', 'removed')).status, 503);
    assert.deepEqual((await t.rows("SELECT status FROM reports WHERE entity_type = 'live_chat'")).map((r: any) => r.status), ['pending', 'pending']);
  });

  it('a dismissal changes nothing, and a message that is gone keeps its reports open until they are dismissed', async () => {
    const t = setup(LIVE, { live: { found: false, changed: false } });
    assert.equal((await act(t, 'livestream/s_1', 'dismissed')).status, 200);
    assert.deepEqual(sentOf(t), []);
    const gone = await act(t, 'live_chat/m_1', 'removed');
    assert.deepEqual([gone.status, gone.body.code], [409, 'item_gone']);
    assert.equal((await t.rows("SELECT status FROM reports WHERE id = 'm1'"))[0].status, 'pending');
    assert.equal((await act(t, 'live_chat/m_1', 'dismissed')).status, 200);
  });

  it('`banned` bans the author of the message and removes it', async () => {
    const t = setup(LIVE);
    const r = await act(t, 'live_chat/m_1', 'banned');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(t.calls.some((c) => c.path === '/users/usr_commenter/ban'));
    assert.deepEqual(sentOf(t).map((c) => c[2]), ['banned']);
  });

  it('migration 0051 keeps every report, takes live_chat, refuses unknown types and keeps the indexes', async () => {
    const files = readdirSync(join(process.cwd(), 'migrations')).filter((f) => f.endsWith('.sql') && f < '0052').sort();
    const indexesOf = async (db: D1Database) => ((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reports' AND name LIKE 'idx%' ORDER BY name").all()).results as any[]).map((r) => r.name);
    const before = files.slice(0, files.findIndex((f) => f.startsWith('0051_reports_live_chat')));
    const put = "INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, created_at, moderator_notes) VALUES ('old', 'comment', 'c', 'u', 'spam', '2026-11-01', 'kept')";
    const db = sqliteD1(files, (file, sql) => { if (file.startsWith('0051_reports_live_chat')) sql(put); });
    const kept = (await db.prepare("SELECT entity_type, reporter_id, moderator_notes FROM reports WHERE id = 'old'").first()) as any;
    assert.deepEqual({ ...kept }, { entity_type: 'comment', reporter_id: 'u', moderator_notes: 'kept' });
    assert.deepEqual(await indexesOf(db), await indexesOf(sqliteD1(before)));
    await db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason) VALUES ('new', 'live_chat', 'm', 'u', 'spam')").run();
    await assert.rejects(async () => db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason) VALUES ('bad', 'tweet', 'm', 'u', 'spam')").run());
  });
});
