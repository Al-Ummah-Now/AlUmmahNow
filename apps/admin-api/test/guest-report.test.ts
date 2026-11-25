/**
 * Reports of people who are not signed in (POST /internal/guest-reports), their limits, the child safety alerts and
 * kept records they set off, and the moderation page's list: the real migrations and a fake api-videos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { guestReportSubmit, parseGuestReport } from '../src/endpoints/moderation/GuestReportSubmit';
import { allowGuestReport, guestReportLimitsFor, networkPrefix, purgeGuestReportLimits } from '../src/lib/guest-report-limits';
import { childSafetyAlertStatement, closeChildSafety, deliverAlerts, deliverChildSafety, EVIDENCE_FLAG_AFTER, keepEvidence, OWN_FLAGS_PER_HOUR } from '../src/lib/moderation/childSafety';
import { reportIntakeUrl } from '../src/lib/moderation/intakeUrl';
import { COUNT_CAP, listReports, listSql } from '../src/lib/moderation/reportList';
import { purgeGuestReports, purgeKeptRecords } from '../src/lib/moderation/retention';
import { itemOfCase } from '../src/lib/csam';
import { hiddenFrom } from '../src/lib/moderation/takedown';
import reportQueueRouter from '../src/routers/reportQueue.router';
import { syncReportMeta } from '../src/lib/moderation/reportMeta';
import moderationRouter from '../src/routers/moderation.router';
import errorsRouter from '../src/routers/errors.router';
import suggestRouter from '../src/routers/suggest.router';
import contentRouter from '../src/routers/content.router';
import { resolveNames } from '../src/lib/audit/names';
import { isChildSafetyErrorKey } from '@al-ummah/shared-types';
import { sqliteD1 } from './d1-sqlite';

type Json = Record<string, any>;
const KEY = { 'X-API-Key': 'internal-key' };
const body = (over: Json = {}) => ({ entityType: 'video', entityId: 'vid_1', reason: 'spam', details: 'Advertising', website: '', ...over });

function setup(environment = 'production', opts: { evidence?: (b: Json) => number | Json; lookup?: Record<string, Json>; extra?: Json } = {}) {
  const db = sqliteD1();
  const calls: Array<{ path: string; body: Json }> = [];
  const VIDEOS = {
    async fetch(input: string, init: RequestInit = {}) {
      const path = new URL(input).pathname;
      const sent = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      calls.push({ path, body: sent });
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
      if ((init.method ?? 'GET') === 'DELETE' && path.startsWith('/internal/csam/report-evidence/')) return opts.extra?.evidenceDown ? json(503, { success: false, code: 'down', error: 'down' }) : json(200, { success: true, result: { deleted: 1 } });
      if (path === '/internal/csam/report-evidence') {
        const out = opts.evidence?.(sent) ?? { kept: true };
        return typeof out === 'number' ? json(out, { success: false, code: 'down', error: 'down' }) : json(200, { success: true, result: out });
      }
      if (path === '/internal/admin/lookup') {
        const items = sent.items.map((i: Json) => ({ type: i.type, id: i.id, found: false, title: null, parentId: null, channelId: null, channelName: null, ownerId: null, isHidden: null, isDeleted: null, ...opts.lookup?.[`${i.type}:${i.id}`] }));
        return json(200, { success: true, result: { items, users: sent.users.map((id: string) => ({ id, found: false, displayName: null, userName: null, isBanned: false })) } });
      }
      if (path === '/internal/admin/videos') return json(200, { success: true, result: { items: [{ id: 'vid-synth-01', title: 'the title' }, { id: 'vid-synth-02', title: 'Another' }], total: 2, page: 1, pageSize: 20, indexComplete: true } });
      if (path === '/internal/admin/videos/vid-synth-01') return json(200, { success: true, result: { id: 'vid-synth-01', title: 'the title', ownerId: 'usr_o' } });
      const lists: Json = {
        '/internal/admin/channels': [{ id: 'ch_taken', name: 'taken name' }, { id: 'ch_2', name: 'Another' }],
        '/internal/admin/deletions': [{ kind: 'video', id: 'vid-synth-01', title: 'the title' }, { kind: 'user', id: 'vid-synth-01', title: 'A person' }],
        '/internal/admin/live/sessions': [{ id: 's1', stream_id: 'live_taken', title: 'taken stream' }, { id: 's2', stream_id: 'live_2' }],
      };
      if (lists[path]) return json(200, { success: true, result: { items: lists[path], total: 2, page: 1, pageSize: 20, indexComplete: true, nextCursor: null, lastRun: null } });
      return json(404, {});
    },
  };
  const env: Json = { INTERNAL_API_KEY: 'internal-key', REPORTS_DB: db, ENVIRONMENT: environment, VIDEOS, VIDEOS_WEB_URL: 'https://videos.alummahnow.net', ...opts.extra };
  const app = new Hono();
  app.post('/internal/guest-reports', (c) => guestReportSubmit(c as never));
  app.use('/api/*', async (c, next) => {
    c.set('auth' as never, { userId: 'usr_mod', roles: (c.req.header('x-test-roles') ?? 'moderator').split(','), payload: {} } as never);
    await next();
  });
  app.route('/api/moderation/queue', reportQueueRouter as never);
  app.route('/api/suggest', suggestRouter as never);
  app.route('/api/content', contentRouter as never);
  const openapi = fromHono(app);
  openapi.route('/api/moderation', moderationRouter);
  openapi.route('/api/errors', errorsRouter);
  const post = async (b: unknown, headers: Json = {}) => {
    const res = await app.request('/internal/guest-reports', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b), headers: { 'Content-Type': 'application/json', 'X-Client-IP': '198.51.100.7', ...KEY, ...headers } }, env);
    return { status: res.status, body: (await res.json()) as Json };
  };
  const get = async (path: string, roles = 'moderator', init: RequestInit = {}) => {
    const res = await app.request(path, { ...init, headers: { 'x-test-roles': roles, 'content-type': 'application/json' } }, env);
    return { status: res.status, body: (await res.json()) as Json };
  };
  const rows = async (sql: string, ...args: unknown[]) => ((await db.prepare(sql).bind(...args).all()).results as Json[]).map((r) => ({ ...r }));
  return { db, env, post, get, rows, calls };
}

describe('a report of someone not signed in', () => {
  it('needs the internal key', async () => {
    const t = setup();
    assert.equal((await t.post(body(), { 'X-API-Key': 'wrong' })).status, 401);
    assert.equal((await t.rows('SELECT * FROM reports')).length, 0);
  });

  it('is stored with nothing about the person, and answers the same whatever it is about', async () => {
    const t = setup('production', { lookup: { 'video:vid_1': { found: true, title: 'Private', ownerId: 'usr_owner' } } });
    const answers = [];
    for (const entityId of ['vid_1', 'vid_missing', 'draft-1', 'deleted_2']) answers.push(await t.post(body({ entityId, name: 'A Person', email: 'person@example.org', entityParentId: 'ch_1' })));
    for (const a of answers) assert.deepEqual(a, { status: 201, body: { success: true } });
    assert.ok(!t.calls.some((c) => c.path.includes('lookup')), 'nothing is looked up for the answer');
    const reports = await t.rows('SELECT * FROM reports ORDER BY created_at');
    assert.equal(reports.length, 4);
    for (const r of reports) assert.deepEqual([r.reporter_id, r.reporter_name, r.entity_title, r.owner_id, r.status], ['guest', null, null, null, 'pending']);
    assert.ok(!JSON.stringify([reports, await t.rows('SELECT * FROM guest_report_limits')]).match(/Person|example\.org|198\.51/));
  });

  it('a body longer than any report takes is refused unread', async () => {
    const t = setup();
    assert.equal((await t.post(body({ details: 'ن'.repeat(4000) }))).status, 201, 'the longest text in any script fits');
    const long = await t.post(JSON.stringify(body()) + ' '.repeat(32 * 1024));
    assert.deepEqual([long.status, long.body.code], [413, 'payload_too_large']);
    assert.equal((await t.post('{"entityType"')).status, 400);
    assert.equal((await t.rows('SELECT id FROM reports')).length, 1);
  });

  it('two people behind one address make two reports', async () => {
    const t = setup();
    await t.post(body({ details: 'first' }));
    await t.post(body({ reason: 'harassment', details: 'second' }));
    const reports = await t.rows('SELECT reason, description FROM reports ORDER BY rowid');
    assert.deepEqual(reports, [{ reason: 'spam', description: 'first' }, { reason: 'harassment', description: 'second' }]);
  });

  it('refuses what is malformed', () => {
    for (const bad of [null, [], 'x', body({ entityType: 'playlist' }), body({ entityId: '' }), body({ entityId: 'index:recent-videos' }), body({ entityId: 'livestream:x' }), body({ entityId: '../x' }), body({ entityId: 'a'.repeat(81) }), body({ entityId: '@handle' }), body({ reason: 'toString' }), body({ reason: '' }), body({ details: 'x'.repeat(4001) }), body({ website: 'x' })]) assert.ok('errors' in parseGuestReport(bad), JSON.stringify(bad));
    assert.deepEqual(parseGuestReport(body({ entityType: 'live', reason: 'violence', details: ' x ' })), { value: { entityType: 'livestream', entityId: 'vid_1', parentId: null, reason: 'inappropriate', description: '[violence]\nx' } });
    assert.ok('value' in parseGuestReport(body({ entityType: 'channel', entityId: '@handle' })));
  });

  it('every attempt counts, per network and per target; other people are not locked out', async () => {
    const t = setup();
    const limits = guestReportLimitsFor('production');
    const statuses = [];
    for (let i = 0; i < limits.prefixHour + 2; i++) statuses.push((await t.post(body({ entityId: `vid_${i}` }))).status);
    assert.deepEqual(statuses, [...Array(limits.prefixHour).fill(201), 429, 429]);
    assert.equal((await t.post(body(), { 'X-Client-IP': '198.51.100.8' })).status, 201);
    // A target's own limit, from many networks; child safety reports have their own
    const db = sqliteD1();
    const at = new Date('2026-11-24T12:00:00Z');
    const try_ = (n: number, childSafety = false, entityId = 'v') => allowGuestReport(db as never, 'k', limits, { ip: `203.0.${n >> 8}.${n & 255}`, entityType: 'video', entityId, childSafety }, at);
    let ok = 0;
    for (let n = 0; n < limits.targetDay + 5; n++) if (await try_(n)) ok++;
    assert.equal(ok, limits.targetDay);
    assert.equal(await try_(5000), false);
    assert.equal(await try_(5001, true), true);
    assert.equal(await try_(5002, false, 'other'), true);
    // One /48 is bounded whatever its /64s
    let wide = 0;
    for (let n = 0; n < 60; n++) if (await allowGuestReport(db as never, 'k', limits, { ip: `2001:db8:1:${n.toString(16)}::1`, entityType: 'video', entityId: `w${n}`, childSafety: false }, at)) wide++;
    assert.equal(wide, limits.wideHour);
    const kept = (await db.prepare('SELECT COUNT(*) AS n FROM guest_report_limits').first()) as any;
    await purgeGuestReportLimits(db as never, new Date(at.getTime() + 86_400_000));
    assert.equal(((await db.prepare('SELECT COUNT(*) AS n FROM guest_report_limits').first()) as any).n, kept.n);
    await purgeGuestReportLimits(db as never, new Date(at.getTime() + 2 * 86_400_000));
    assert.equal(((await db.prepare('SELECT COUNT(*) AS n FROM guest_report_limits').first()) as any).n, 0);
  });

  it('the prefix of an address', () => {
    assert.deepEqual(networkPrefix('203.0.113.5:8080'), { narrow: '203.0.113.5', wide: '203.0.113.5' });
    assert.deepEqual(networkPrefix('::ffff:203.0.113.5'), { narrow: '203.0.113.5', wide: '203.0.113.5' });
    assert.deepEqual(networkPrefix('[2001:db8:1:2:3:4:5:6]:443'), { narrow: '2001:db8:1:2::/64', wide: '2001:db8:1::/48' });
    for (const bad of [null, '', 'unknown', '999.1.1.1', '1::2::3', 'x']) assert.equal(networkPrefix(bad).narrow, 'unknown');
  });

  it('the edge limiter comes first: no write and no human check', async () => {
    const t = setup('production', { extra: { GUEST_REPORT_LIMITER: { limit: async () => ({ success: false }) } } });
    assert.equal((await t.post(body())).status, 429);
    assert.equal((await t.rows('SELECT * FROM guest_report_limits')).length, 0);
  });
});

describe('a child safety report', () => {
  const groups = (t: ReturnType<typeof setup>) => t.rows("SELECT action_key AS k, status, title, message, context FROM error_groups WHERE kind = 'action' ORDER BY action_key");

  it('is stored with its alert, raises one Errors item and keeps the records', async () => {
    const t = setup();
    assert.equal((await t.post(body({ reason: 'child_safety', details: 'my words' }))).status, 201);
    await t.post(body({ reason: 'child_safety', entityId: 'vid_1' }));
    const [alert, ...more] = await t.rows('SELECT * FROM child_safety_alerts');
    assert.equal(more.length, 0, 'one per item');
    assert.equal(alert.evidence, 'kept');
    assert.ok(alert.alerted_at && alert.flag_key === 'child-safety-report:video:vid_1');
    assert.deepEqual(t.calls.filter((c) => c.path === '/internal/csam/report-evidence').map((c) => c.body), [{ entityType: 'video', entityId: 'vid_1', publicOnly: true, reportedText: null }]);
    assert.ok(!JSON.stringify(await t.rows('SELECT * FROM error_groups')).includes('my words'));
  });

  it('an alert that could not be raised is raised by a later run, once', async () => {
    const t = setup();
    const down = { ...t.env, REPORTS_DB: t.db, VIDEOS: t.env.VIDEOS } as Json;
    await t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at) VALUES ('r1', 'video', 'v', 'guest', 'child_safety', 'pending', '2026-11-24T00:00:00Z')").run();
    await childSafetyAlertStatement(t.db as never, 'video', 'v', '2026-11-24T00:00:00Z').run();
    const prepare = t.db.prepare.bind(t.db);
    (t.db as any).prepare = (sql: string) => {
      if (/INTO error_groups|INTO error_events/i.test(sql)) throw new Error('D1 is down');
      return prepare(sql);
    };
    await deliverChildSafety(down as never);
    assert.equal((await t.rows('SELECT alerted_at FROM child_safety_alerts'))[0].alerted_at, null, 'still due');
    (t.db as any).prepare = prepare;
    assert.equal(await deliverAlerts(t.env as never), 1);
    assert.equal(await deliverAlerts(t.env as never), 0);
  });

  it('a flood shares one item an hour and never loses an alert', async () => {
    const t = setup();
    for (let n = 0; n < OWN_FLAGS_PER_HOUR + 20; n++) await childSafetyAlertStatement(t.db as never, 'video', `v${n}`, `2026-11-24T00:00:${String(n).padStart(2, '0')}Z`).run();
    assert.equal(await deliverAlerts(t.env as never, new Date('2026-11-24T01:00:00Z')), OWN_FLAGS_PER_HOUR + 20);
    const keys = await t.rows('SELECT flag_key, COUNT(*) AS n FROM child_safety_alerts GROUP BY flag_key ORDER BY n DESC');
    assert.equal(keys.length, OWN_FLAGS_PER_HOUR + 1);
    assert.deepEqual(keys[0], { flag_key: 'child-safety-reports:2026-11-24T01', n: 20 });
    // The next hour has room again
    await childSafetyAlertStatement(t.db as never, 'video', 'later', '2026-11-24T02:30:00Z').run();
    await deliverAlerts(t.env as never, new Date('2026-11-24T02:30:00Z'));
    assert.equal((await t.rows("SELECT flag_key FROM child_safety_alerts WHERE entity_id = 'later'"))[0].flag_key, 'child-safety-report:video:later');
  });

  it('a copy that fails is retried, and flagged when it keeps failing', async () => {
    let down = true;
    const t = setup('production', { evidence: () => (down ? 503 : { kept: true }) });
    await childSafetyAlertStatement(t.db as never, 'post', 'p_1', '2026-11-24T00:00:00Z').run();
    for (let n = 0; n < EVIDENCE_FLAG_AFTER; n++) await keepEvidence(t.env as never);
    assert.deepEqual((await t.rows('SELECT evidence, evidence_attempts FROM child_safety_alerts'))[0], { evidence: null, evidence_attempts: EVIDENCE_FLAG_AFTER });
    const flag = async () => (await t.rows("SELECT status FROM error_actions WHERE item_key = 'child-safety-evidence:post:p_1'"))[0]?.status;
    assert.equal(await flag(), 'open');
    down = false;
    assert.equal(await keepEvidence(t.env as never), 1);
    assert.equal(await keepEvidence(t.env as never), 0);
    assert.equal(await flag(), 'resolved', 'the copy worked');
  });

  it('a decision takes the failing copy’s Errors item with it too', async () => {
    const t = setup('production', { evidence: () => 503 });
    await childSafetyAlertStatement(t.db as never, 'post', 'p_1', '2026-11-24T00:00:00Z').run();
    await deliverAlerts(t.env as never);
    for (let n = 0; n < EVIDENCE_FLAG_AFTER; n++) await keepEvidence(t.env as never);
    await closeChildSafety(t.env as never, 'post', 'p_1');
    assert.deepEqual((await t.rows('SELECT item_key, status FROM error_actions ORDER BY item_key')).map((r) => [r.item_key, r.status]), [['child-safety-evidence:post:p_1', 'resolved'], ['child-safety-report:post:p_1', 'resolved']]);
  });

  it('what a signed-in reporter saw is kept with it; a guest alone keeps only what anyone can read', async () => {
    const t = setup();
    await t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at, entity_title) VALUES ('r1', 'live_chat', 'm_1', 'usr_r', 'child_safety', 'pending', '2026-11-24T00:00:00Z', 'the message')").run();
    await childSafetyAlertStatement(t.db as never, 'live_chat', 'm_1', '2026-11-24T00:00:00Z').run();
    await keepEvidence(t.env as never);
    assert.deepEqual(t.calls.at(-1)!.body, { entityType: 'live_chat', entityId: 'm_1', publicOnly: false, reportedText: 'the message' });
  });

  it('closes with the last open report of the item, and starts again with a new one', async () => {
    const t = setup();
    await t.post(body({ reason: 'child_safety' }));
    await t.post(body({ reason: 'child_safety' }));
    const close = async (n: number) => {
      await t.db.prepare("UPDATE reports SET status = 'dismissed' WHERE id IN (SELECT id FROM reports WHERE status = 'pending' LIMIT ?)").bind(n).run();
      await closeChildSafety(t.env as never, 'video', 'vid_1');
      return (await t.rows('SELECT closed_at FROM child_safety_alerts'))[0].closed_at;
    };
    assert.equal(await close(1), null);
    assert.ok(await close(1));
    await t.post(body({ reason: 'child_safety' }), { 'X-Client-IP': '198.51.100.9' });
    const [alert] = await t.rows('SELECT * FROM child_safety_alerts');
    assert.equal(alert.closed_at, null);
    assert.ok(alert.alerted_at, 'alerted again');
  });

  it('a channel reported by its handle moves to its id, with its alert', async () => {
    const t = setup('production', { lookup: { 'channel:@synthetic': { found: true, canonicalId: 'ch_1', title: 'Synthetic', ownerId: 'usr_owner' } } });
    await t.post(body({ entityType: 'channel', entityId: '@synthetic', reason: 'child_safety' }));
    assert.equal(t.calls.filter((c) => c.path === '/internal/csam/report-evidence').length, 0);
    await syncReportMeta(t.env as never);
    assert.equal((await t.rows('SELECT entity_id FROM reports'))[0].entity_id, 'ch_1');
    assert.deepEqual(await t.rows('SELECT entity_id, evidence FROM child_safety_alerts'), [{ entity_id: 'ch_1', evidence: null }]);
    await keepEvidence(t.env as never);
    assert.equal((await t.rows('SELECT evidence FROM child_safety_alerts'))[0].evidence, 'kept');
    // Raised again under the id, with its link; the handle's Errors item is resolved
    await deliverAlerts(t.env as never);
    assert.deepEqual(await t.rows('SELECT item_key, status, item_url FROM error_actions ORDER BY item_key'), [
      { item_key: 'child-safety-report:channel:@synthetic', status: 'resolved', item_url: '/moderation?entity_type=channel&entity_id=%40synthetic' },
      { item_key: 'child-safety-report:channel:ch_1', status: 'open', item_url: '/moderation?entity_type=channel&entity_id=ch_1' },
    ]);
    await t.db.prepare("UPDATE reports SET status = 'dismissed'").run();
    await closeChildSafety(t.env as never, 'channel', 'ch_1');
    assert.ok((await t.rows('SELECT status FROM error_actions')).every((r) => r.status === 'resolved'));
  });

  describe('joining the alert its channel has already', () => {
    const insert = (t: ReturnType<typeof setup>, id: string, o: Json) =>
      t.db.prepare("INSERT INTO child_safety_alerts (entity_type, entity_id, created_at, alerted_at, flag_key, own_flag, evidence, closed_at) VALUES ('channel', ?, ?, ?, ?, 1, ?, ?)").bind(id, o.created, o.alerted ?? null, o.alerted ? `child-safety-report:channel:${id}` : null, o.evidence ?? null, o.closed ?? null).run();
    const join = async (handle: Json, own: Json) => {
      const t = setup('production', { lookup: { 'channel:@synthetic': { found: true, canonicalId: 'ch_1', title: 'Synthetic', ownerId: 'usr_owner' } } });
      const open = handle.closed ? 'dismissed' : 'pending';
      await t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at) VALUES ('r1', 'channel', '@synthetic', 'guest', 'child_safety', ?, '2026-11-24T00:00:00Z')").bind(open).run();
      await insert(t, 'ch_1', own);
      await insert(t, '@synthetic', handle);
      await syncReportMeta(t.env as never);
      const [row, ...more] = await t.rows('SELECT entity_id, created_at, alerted_at, flag_key, evidence, closed_at FROM child_safety_alerts');
      assert.equal(more.length, 0);
      assert.equal(row.entity_id, 'ch_1');
      return { t, row };
    };
    const OLD = '2026-01-01T00:00:00Z';
    const NEW = '2026-11-24T00:00:00Z';

    it('a decided one is open again: the new alert is raised under the id, and its records kept', async () => {
      const { t, row } = await join({ created: NEW, alerted: NEW }, { created: OLD, alerted: OLD, evidence: 'kept', closed: '2026-02-01T00:00:00Z' });
      assert.deepEqual(row, { entity_id: 'ch_1', created_at: NEW, alerted_at: null, flag_key: null, evidence: null, closed_at: null });
      assert.equal(await deliverAlerts(t.env as never), 1);
      assert.equal((await t.rows('SELECT flag_key FROM child_safety_alerts'))[0].flag_key, 'child-safety-report:channel:ch_1');
      assert.equal(await keepEvidence(t.env as never), 1);
    });

    it('an open one takes it in: newest time, its own Errors item, records kept again', async () => {
      const { t, row } = await join({ created: NEW, alerted: NEW }, { created: OLD, alerted: OLD, evidence: 'kept' });
      assert.deepEqual(row, { entity_id: 'ch_1', created_at: NEW, alerted_at: OLD, flag_key: 'child-safety-report:channel:ch_1', evidence: null, closed_at: null });
      assert.equal(await deliverAlerts(t.env as never), 0, 'not a second item for one channel');
    });

    it('a decided handle leaves an open or decided one as it is', async () => {
      const open = await join({ created: NEW, alerted: NEW, closed: NEW }, { created: OLD, alerted: OLD, evidence: 'kept' });
      assert.deepEqual([open.row.closed_at, open.row.evidence, open.row.alerted_at], [null, 'kept', OLD]);
      const decided = await join({ created: NEW, alerted: NEW, closed: NEW }, { created: OLD, alerted: OLD, evidence: 'kept', closed: OLD });
      assert.deepEqual([decided.row.closed_at, decided.row.evidence], [NEW, 'kept'], 'kept a year from the later decision');
    });
  });

  it('a handle nobody has is not tried for ever', async () => {
    const t = setup();
    await t.post(body({ entityType: 'channel', entityId: '@nobody', reason: 'child_safety' }));
    for (let n = 0; n < 5; n++) await keepEvidence(t.env as never);
    assert.equal((await t.rows('SELECT evidence FROM child_safety_alerts'))[0].evidence, 'none');
  });
});

describe('how long reports stay', () => {
  const DAY = 86_400_000;
  const now = new Date('2028-01-01T00:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const seed = (t: ReturnType<typeof setup>, id: string, over: Json = {}) => {
    const r = { reporter: 'guest', reason: 'spam', status: 'resolved', resolved: ago(400), entity: 'vid_1', ...over };
    return t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at, resolved_at) VALUES (?, 'video', ?, ?, ?, ?, '2026-01-01', ?)").bind(id, r.entity, r.reporter, r.reason, r.status, r.resolved).run();
  };
  const ids = async (t: ReturnType<typeof setup>) => (await t.rows('SELECT id FROM reports ORDER BY id')).map((r) => r.id);

  it('a report sent without an account goes a year after its decision, and no other', async () => {
    const t = setup();
    await seed(t, 'old');
    await seed(t, 'dismissed', { status: 'dismissed' });
    await seed(t, 'recent', { resolved: ago(364) });
    await seed(t, 'open', { status: 'pending', resolved: null });
    await seed(t, 'signed_in', { reporter: 'usr_r' });
    await seed(t, 'child_safety', { reason: 'child_safety' });
    assert.equal(await purgeGuestReports(t.db as never, now), 2);
    assert.deepEqual(await ids(t), ['child_safety', 'open', 'recent', 'signed_in']);
    const plan = (await t.rows("EXPLAIN QUERY PLAN SELECT id FROM reports INDEXED BY idx_reports_guest_closed WHERE reporter_id = 'guest' AND status IN ('resolved', 'dismissed') AND resolved_at < 'x' AND +reason <> 'child_safety' ORDER BY resolved_at LIMIT 5")).map((r) => r.detail);
    assert.deepEqual(plan.length, 1, plan.join(' | '));
  });

  const alert = (t: ReturnType<typeof setup>, id: string, closed: string | null) => t.db.prepare("INSERT INTO child_safety_alerts (entity_type, entity_id, created_at, alerted_at, evidence, closed_at) VALUES ('video', ?, '2026-01-01', '2026-01-01', 'kept', ?)").bind(id, closed).run();
  const caseOf = (t: ReturnType<typeof setup>, id: string, status: string) => t.db.prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, detected_at, created_by, created_at, updated_at, item_type, item_id) VALUES (?, 'u', ?, 'paste', ?, 'x', 'a', 'x', 'x', 'video', ?)").bind(`case-${id}-${status}`, `${id}-${status}`, status, id).run();

  it('a kept record stays at least a year, and while a case about the item is open', async () => {
    const t = setup();
    for (const [id, closed] of [['due', ago(366)], ['recent', ago(364)], ['open', null], ['in_case', ago(900)], ['case_over', ago(900)]] as const) {
      await alert(t, id, closed);
      await seed(t, `g_${id}`, { entity: id, reason: 'child_safety', status: closed ? 'resolved' : 'pending' });
    }
    await seed(t, 's_due', { entity: 'due', reason: 'child_safety', reporter: 'usr_r' });
    await caseOf(t, 'in_case', 'contained');
    await caseOf(t, 'case_over', 'closed');
    assert.deepEqual(await purgeKeptRecords(t.env as never, now), { deleted: 2, failed: 0 });
    assert.deepEqual(t.calls.filter((c) => c.path.startsWith('/internal/csam/report-evidence/')).map((c) => c.path.split('/').pop()), ['case_over', 'due']);
    assert.deepEqual((await t.rows('SELECT entity_id FROM child_safety_alerts ORDER BY entity_id')).map((r) => r.entity_id), ['in_case', 'open', 'recent']);
    assert.deepEqual(await ids(t), ['g_in_case', 'g_open', 'g_recent', 's_due'], 'the signed-in report stays');
    assert.equal((await t.rows("SELECT COUNT(*) AS n FROM csam_access_log WHERE action = 'evidence.deleted'"))[0].n, 2);
    // A longer setting for case evidence holds here too
    await t.db.prepare("INSERT INTO csam_settings (key, value, updated_by, updated_at) VALUES ('retention_days', '730', 'a', 'x')").run();
    await alert(t, 'later', ago(400));
    assert.equal((await purgeKeptRecords(t.env as never, now)).deleted, 0);
  });

  it('one that cannot be deleted is due again', async () => {
    const t = setup('production', { extra: { evidenceDown: true } });
    await alert(t, 'due', ago(366));
    assert.deepEqual(await purgeKeptRecords(t.env as never, now), { deleted: 0, failed: 1 });
    assert.equal((await t.rows("SELECT closed_at, evidence FROM child_safety_alerts WHERE entity_id = 'due'"))[0].evidence, 'kept');
  });
});

describe('an item under a takedown', () => {
  const lookup = { 'video:vid-synth-01': { found: true, title: 'the title', channelId: 'ch_1', channelName: 'Channel', ownerId: 'usr_o', isHidden: true, isDeleted: false } };
  async function taken() {
    const t = setup('production', { lookup });
    await t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at, entity_title, owner_id, owner_name, channel_name, description) VALUES ('r1', 'video', 'vid-synth-01', 'usr_r', 'spam', 'pending', '2026-11-24T00:00:00Z', 'the title', 'usr_o', 'Owner', 'Channel', 'what they wrote'), ('r2', 'video', 'vid-synth-01', 'usr_r2', 'spam', 'resolved', '2026-11-23T00:00:00Z', 'the title', 'usr_o', 'Owner', 'Channel', 'what they wrote')").run();
    await t.db.prepare("UPDATE reports SET moderator_notes = 'my notes', banned_user_id = 'usr_o', meta_synced_at = '2099-01-01', resolved_at = '2026-11-23T01:00:00Z', action = 'banned' WHERE id = 'r2'").run();
    await t.db.prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, detected_at, created_by, created_at, updated_at, item_type, item_id) VALUES ('case-1', 'u', 'k', 'paste', 'contained', 'x', 'a', 'x', 'x', 'video', 'vid-synth-01')").run();
    return t;
  }
  const PATHS = ['/api/moderation/reports/r1', '/api/moderation/reports/r2', '/api/moderation/reports', '/api/moderation/queue', '/api/moderation/queue/history', '/api/moderation/queue/items/video/vid-synth-01', '/api/suggest/report', '/api/suggest/report/video:vid-synth-01', '/api/suggest/video', '/api/content/videos'];

  it('is shown to super admins only, in every list and page of the reports', async () => {
    const t = await taken();
    for (const path of PATHS) {
      for (const roles of ['moderator', 'admin']) {
        const seen = await t.get(path, roles);
        assert.equal(seen.status, 200, path);
        assert.ok(!/the title|usr_o|Owner"|"Channel"|what they wrote|my notes/.test(JSON.stringify(seen.body)), `${path} ${roles}: ${JSON.stringify(seen.body)}`);
      }
      const full = JSON.stringify((await t.get(path, 'super_admin')).body);
      assert.ok(full.includes('the title'), `${path}: ${full}`);
    }
    const page = (await t.get(PATHS[0])).body.result;
    assert.equal(page.item.takenDown, true);
    assert.deepEqual(page.outcomes.map((o: Json) => [o.action, o.reason]), [['warning', 'taken_down'], ['removed', 'taken_down'], ['banned', 'taken_down'], ['deleted', 'taken_down'], ['dismissed', null]]);
    assert.ok((await t.get(PATHS[0], 'super_admin')).body.result.outcomes.some((o: Json) => o.action === 'removed' && o.available));
  });

  it('is said to be so where there is a row', async () => {
    const t = await taken();
    const [row] = (await t.get('/api/moderation/reports')).body.result.reports;
    assert.deepEqual([row.taken_down, row.description, row.reason], [true, null, 'spam']);
    assert.equal((await t.get('/api/moderation/reports', 'super_admin')).body.result.reports[0].taken_down, undefined);
  });

  it('is found by its id, never by what it or its reports say', async () => {
    const t = await taken();
    for (const base of ['/api/moderation/queue', '/api/moderation/queue/history']) {
      for (const q of ['the title', 'what they', 'usr_o', 'Channel']) {
        assert.equal((await t.get(`${base}?q=${encodeURIComponent(q)}`, 'admin')).body.result.items.length, 0, `${base} ${q}`);
        assert.equal((await t.get(`${base}?q=${encodeURIComponent(q)}`, 'super_admin')).body.result.items.length, 1, `${base} ${q}`);
      }
      assert.equal((await t.get(`${base}?q=vid-synth-01`, 'admin')).body.result.items.length, 1);
    }
    assert.equal((await t.get('/api/suggest/report?q=title', 'admin')).body.result.items.length, 0);
  });

  it('has no page, no change and no name for anyone else', async () => {
    const t = await taken();
    for (const [method, path] of [['GET', '/api/content/videos/vid-synth-01'], ['PATCH', '/api/content/videos/vid-synth-01'], ['DELETE', '/api/content/videos/vid-synth-01'], ['POST', '/api/content/videos/vid-synth-01/thumbnail']]) {
      const refused = await t.get(path, 'admin', { method, ...(method === 'GET' ? {} : { body: '{}' }) });
      assert.deepEqual([refused.status, refused.body.code], [403, 'forbidden'], `${method} ${path}`);
    }
    assert.deepEqual((await t.get('/api/content/videos', 'admin')).body.result.items.map((v: Json) => v.id), ['vid-synth-02']);
    assert.equal((await t.get('/api/content/videos', 'super_admin')).body.result.items.length, 2);
    const ask = { users: [], items: [{ kind: 'video' as const, id: 'vid-synth-01' }] };
    assert.equal((await resolveNames(t.env as never, ask, true, ['admin'])).items['video:vid-synth-01'].title, null);
    assert.equal((await resolveNames(t.env as never, ask, true, ['super_admin'])).items['video:vid-synth-01'].title, 'the title');
  });

  it('a channel, a stream and a deleted item under one are kept from the other lists, pickers and routes too', async () => {
    const t = await taken();
    await t.db.prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, detected_at, created_by, created_at, updated_at, item_type, item_id) VALUES ('case-2', 'u', 'k2', 'paste', 'contained', 'x', 'a', 'x', 'x', 'channel', 'ch_taken'), ('case-3', 'u', 'k3', 'paste', 'contained', 'x', 'a', 'x', 'x', 'livestream', 'live_taken')").run();
    const ids = async (path: string, roles: string) => (await t.get(path, roles)).body.result.items.map((i: Json) => `${i.kind === 'user' ? 'user ' : ''}${i.id}`);
    for (const [path, kept, all] of [
      ['/api/content/channels', ['ch_2'], ['ch_taken', 'ch_2']],
      ['/api/suggest/channel', ['ch_2'], ['ch_taken', 'ch_2']],
      ['/api/content/deletions', ['user vid-synth-01'], ['vid-synth-01', 'user vid-synth-01']],
      ['/api/content/live/sessions', ['s2'], ['s1', 's2']],
    ] as const) {
      assert.deepEqual(await ids(path, 'admin'), kept, path);
      assert.deepEqual(await ids(path, 'super_admin'), all, path);
    }
    for (const [method, path] of [['GET', '/channels/ch_taken'], ['PATCH', '/channels/ch_taken'], ['GET', '/channels/ch_taken/move-offers'], ['POST', '/channels/ch_taken/suspend'], ['POST', '/deletions/video/vid-synth-01/restore'], ['POST', '/deletions/video/vid-synth-01/purge'], ['POST', '/live/streams/live_taken/move']]) {
      const refused = await t.get(`/api/content${path}`, 'admin', { method, ...(method === 'GET' ? {} : { body: '{}' }) });
      assert.deepEqual([refused.status, refused.body.error], [403, 'Under review by the child safety team; only super admins can open it'], `${method} ${path}`);
    }
  });

  it('stays so after its case is closed; a channel only while the case is open', async () => {
    const t = await taken();
    const seen = async () => ({
      channels: (await t.get('/api/content/channels', 'admin')).body.result.items.map((c: Json) => c.id),
      videos: (await t.get('/api/content/videos', 'admin')).body.result.items.map((v: Json) => v.id),
      named: (await t.get('/api/moderation/queue?q=taken%20name', 'admin')).body.result.items.length,
      report: (await t.get('/api/moderation/reports/rc', 'admin')).body.result.item.takenDown ?? false,
    });
    await t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at, entity_title, meta_synced_at) VALUES ('rc', 'channel', 'ch_taken', 'usr_r', 'spam', 'pending', '2026-11-24T00:00:00Z', 'taken name', '2099-01-01')").run();
    await t.db.prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, detected_at, created_by, created_at, updated_at, item_type, item_id) VALUES ('case-2', 'u', 'k2', 'paste', 'reported', 'x', 'a', 'x', 'x', 'channel', 'ch_taken')").run();
    assert.deepEqual(await seen(), { channels: ['ch_2'], videos: ['vid-synth-02'], named: 0, report: true });
    assert.equal((await t.get('/api/content/channels/ch_taken', 'admin')).status, 403);
    await t.db.prepare("UPDATE csam_cases SET status = 'closed'").run();
    assert.deepEqual(await seen(), { channels: ['ch_taken', 'ch_2'], videos: ['vid-synth-02'], named: 1, report: false });
    assert.notEqual((await t.get('/api/content/channels/ch_taken', 'admin')).status, 403);
    // A second case about it that is open
    await t.db.prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, detected_at, created_by, created_at, updated_at, item_type, item_id) VALUES ('case-3', 'u', 'k3', 'paste', 'containing', 'x', 'a', 'x', 'x', 'channel', 'ch_taken')").run();
    assert.equal((await seen()).report, true);
  });

  it('its AI moderation flags are super admins’: not listed, counted, found, opened or acted on', async () => {
    const t = await taken();
    const signal = (id: string, type: string, subject: string, parent: string | null) =>
      t.db.prepare("INSERT INTO moderation_signals (id, subject_type, subject_id, parent_id, surface, author_id, decision, review_status, translation, top_category, created_at) VALUES (?, ?, ?, ?, 'comment', 'usr_o', 'flag', 'pending', 'its translation', 'spam', '2026-11-24T00:00:00Z')").bind(id, type, subject, parent).run();
    await t.db.prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, detected_at, created_by, created_at, updated_at, item_type, item_id) VALUES ('case-2', 'u', 'k2', 'paste', 'closed', 'x', 'a', 'x', 'x', 'comment', 'cmt-synth-01'), ('case-3', 'u', 'k3', 'paste', 'contained', 'x', 'a', 'x', 'x', 'livestream', 'live_taken')").run();
    for (const [id, type, subject, parent] of [['sig_video', 'video', 'vid-synth-01', null], ['sig_on_it', 'comment', 'cmt-2', 'vid-synth-01'], ['sig_post_comment', 'post_comment', 'cmt-synth-01', 'post-1'], ['sig_chat', 'live_chat', 'msg-1', 'live_taken'], ['sig_other', 'comment', 'cmt-3', 'vid-synth-02']] as const) await signal(id, type, subject, parent);
    for (const path of ['/api/moderation/ai/signals', '/api/moderation/ai/queue?tab=action', '/api/moderation/ai/queue?tab=action&q=vid-synth-01', '/api/moderation/ai/queue?tab=action&q=usr_o']) {
      const read = async (roles: string) => {
        const r = (await t.get(path, roles)).body.result;
        return { ids: (r.signals ?? r.items).map((s: Json) => s.id).sort(), total: r.total, action: r.counts?.action };
      };
      const own = path.includes('q=vid') ? [] : ['sig_other'];
      for (const roles of ['moderator', 'admin']) {
        const seen = await read(roles);
        assert.deepEqual([seen.ids, seen.total, seen.action ?? own.length], [own, own.length, own.length], `${path} ${roles}`);
      }
      assert.equal((await read('super_admin')).total, path.includes('q=vid') ? 1 : 5, path);
    }
    for (const id of ['sig_video', 'sig_on_it', 'sig_post_comment', 'sig_chat']) {
      for (const [method, path, sent] of [['GET', '', null], ['POST', '/review', { verdict: 'agree' }], ['POST', '/visibility', { hidden: true }]] as const) {
        const refused = await t.get(`/api/moderation/ai/signals/${id}${path}`, 'admin', { method, ...(sent ? { body: JSON.stringify(sent) } : {}) });
        assert.equal(refused.status, 404, `${method} ${id}${path}`);
        assert.ok(!JSON.stringify(refused.body).includes('translation'));
      }
      assert.equal((await t.get(`/api/moderation/ai/signals/${id}`, 'super_admin')).body.result.signal.translation, 'its translation');
    }
    assert.equal((await t.get('/api/moderation/ai/signals/sig_other', 'admin')).status, 200);
  });

  it('and one that is not is read through its index', async () => {
    const t = await taken();
    assert.equal((await hiddenFrom(t.db as never, ['moderator'], [{ type: 'video', id: 'other' }])).size, 0);
    const plan = (await t.rows("EXPLAIN QUERY PLAN SELECT DISTINCT c.item_type, c.item_id FROM json_each('[]') j CROSS JOIN csam_cases c INDEXED BY idx_csam_cases_item ON c.item_id IS NOT NULL AND c.item_type = json_extract(j.value, '$[0]') AND c.item_id = json_extract(j.value, '$[1]')")).map((r) => String(r.detail));
    assert.ok(plan.some((d) => /SEARCH c USING (?:COVERING )?INDEX idx_csam_cases_item/.test(d)), plan.join(' | '));
  });

  it('is named from the case as reports name it', () => {
    const r = (o: Json) => itemOfCase({ uploaderId: null, ...o } as never);
    assert.deepEqual(r({ kind: 'video_thumbnail', videoId: 'v' }), { type: 'video', id: 'v' });
    assert.deepEqual(r({ kind: 'post_image', postId: 'p', channelId: 'c' }), { type: 'post', id: 'p' });
    assert.deepEqual(r({ kind: 'comment', commentId: 'c', commentParentId: 'v' }), { type: 'comment', id: 'c' });
    assert.deepEqual(r({ kind: 'live_stream', streamId: 's', channelId: 'c' }), { type: 'livestream', id: 's' });
    assert.deepEqual(r({ kind: 'channel_image', channelId: 'c' }), { type: 'channel', id: 'c' });
    assert.equal(r({ kind: 'profile_image' }), null);
  });
});

describe('the Errors page items of child safety reports and cases', () => {
  it('only super admins see, find and act on them', async () => {
    const t = setup();
    await t.post(body({ reason: 'child_safety' }));
    const [item] = await t.rows('SELECT * FROM error_actions');
    assert.ok(isChildSafetyErrorKey(item.item_key));
    const [{ ref }] = await t.rows('SELECT ref FROM error_refs');
    const list = async (path: string, roles: string) => (await t.get(path, roles)).body.result;
    for (const [path, read] of [['/api/errors/groups', (r: Json) => r.groups.length], ['/api/errors/queue', (r: Json) => r.items.length], ['/api/errors/counts', (r: Json) => r.openActions], ['/api/suggest/error', (r: Json) => r.items.length], ['/api/suggest/error?q=child', (r: Json) => r.items.length]] as Array<[string, (r: Json) => number]>) {
      assert.equal(read(await list(path, 'admin')), 0, path);
      assert.equal(read(await list(path, 'super_admin')), 1, path);
    }
    assert.equal((await list('/api/errors/counts', 'admin')).new, 0);
    assert.equal((await list('/api/errors/queue', 'admin')).counts.action, 0);
    const acts: Array<[string, string, Json | null]> = [
      ['GET', `/api/errors/groups/${item.group_id}`, null],
      ['GET', `/api/errors/refs/${ref}`, null],
      ['PATCH', `/api/errors/groups/${item.group_id}`, { status: 'acknowledged' }],
      ['POST', `/api/errors/groups/${item.group_id}/notes`, { body: 'a note' }],
      ['POST', `/api/errors/actions/${item.id}/retry`, {}],
      ['PATCH', `/api/errors/actions/${item.id}`, { status: 'dismissed' }],
    ];
    for (const [method, path, sent] of acts) {
      const call = (roles: string) => t.get(path, roles, { method, ...(sent ? { body: JSON.stringify(sent) } : {}) });
      assert.equal((await call('admin')).status, 404, `${method} ${path}`);
      assert.notEqual((await call('super_admin')).status, 404, `${method} ${path}`);
    }
    assert.equal((await t.get(`/api/suggest/error/${item.group_id}`, 'admin')).body.result.item, null);
  });
});

describe('the moderation page', () => {
  const seed = async (t: ReturnType<typeof setup>, id: string, reason: string, status: string, at: string, entity = id) =>
    t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at) VALUES (?, 'video', ?, 'usr_r', ?, ?, ?)").bind(id, entity, reason, status, at).run();

  it('open child safety reports come first, newest first, then the rest, across pages', async () => {
    const t = setup();
    for (let n = 0; n < 6; n++) await seed(t, `s${n}`, 'spam', 'pending', `2026-11-2${n}T00:00:00Z`);
    await seed(t, 'c1', 'child_safety', 'pending', '2026-11-01T00:00:00Z');
    await seed(t, 'c2', 'child_safety', 'reviewing', '2026-11-02T00:00:00Z');
    await seed(t, 'c3', 'child_safety', 'dismissed', '2026-11-23T12:00:00Z');
    const page = async (offset: number, query = '') => (await t.get(`/api/moderation/reports?limit=3&offset=${offset}${query}`)).body.result;
    assert.deepEqual((await page(0)).reports.map((r: Json) => r.id), ['c2', 'c1', 's5']);
    assert.deepEqual((await page(3)).reports.map((r: Json) => r.id), ['s4', 'c3', 's3']);
    assert.deepEqual((await page(6)).reports.map((r: Json) => r.id), ['s2', 's1', 's0']);
    assert.deepEqual([(await page(0)).total, (await page(0)).totalCapped, (await page(0)).openChildSafety], [9, false, 2]);
    assert.deepEqual((await page(0, '&reason=child_safety')).reports.map((r: Json) => r.id), ['c2', 'c1', 'c3']);
    assert.deepEqual((await page(0, '&reason=spam&status=pending')).reports.map((r: Json) => r.id), ['s5', 's4', 's3']);
  });

  it('never reads or sorts the whole table, whatever the filter', async () => {
    const t = setup();
    for (let n = 0; n < 40; n++) await seed(t, `s${n}`, n % 2 ? 'spam' : 'child_safety', n % 3 ? 'resolved' : 'pending', '2026-11-20T00:00:00Z');
    await t.db.prepare('ANALYZE').run();
    for (const f of [{}, { status: 'pending' }, { reason: 'spam' }, { entity_type: 'video' }, { entity_id: 's1' }, { reporter_id: 'usr_r' }, { status: 'pending', reason: 'spam', entity_type: 'video' }] as Json[]) {
      const sql = listSql(f);
      for (const [name, text] of Object.entries(sql).filter(([, v]) => typeof v === 'string') as Array<[string, string]>) {
        const binds = name === 'openChildSafety' ? [] : sql.binds;
        const page = /OFFSET \?$/.test(text) ? [20, 0] : [];
        const plan = (await t.rows(`EXPLAIN QUERY PLAN ${text}`, ...binds, ...page)).map((r) => String(r.detail));
        assert.ok(!plan.some((d) => /^SCAN reports$/.test(d)), `${JSON.stringify(f)} ${name}: ${plan.join(' | ')}`);
        assert.ok(!plan.some((d) => d.includes('TEMP B-TREE')), `${JSON.stringify(f)} ${name}: ${plan.join(' | ')}`);
        if (['first', 'firstCount', 'openChildSafety'].includes(name)) assert.ok(plan.some((d) => d.includes('idx_reports_child_safety_open')), `${name}: ${plan.join(' | ')}`);
      }
    }
  });

  it('counts stop at the cap', async () => {
    const t = setup();
    await t.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${COUNT_CAP + 50}) INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at) SELECT 'r' || i, 'video', 'v', 'u', 'spam', 'pending', '2026-11-20T00:00:00Z' FROM n`).run().catch(() => undefined);
    if (!(await t.rows('SELECT 1 FROM reports LIMIT 1')).length) for (let n = 0; n < COUNT_CAP + 5; n++) await seed(t, `r${n}`, 'spam', 'pending', '2026-11-20T00:00:00Z', 'v');
    const page = await listReports(t.db as never, {}, 20, 0);
    assert.deepEqual([page.total, page.totalCapped], [COUNT_CAP, true]);
    const queue = (await t.get('/api/moderation/queue')).body.result;
    assert.deepEqual(queue.counts, { actionNeeded: 1, openReports: COUNT_CAP, openChildSafety: 0, history: 0, capped: true });
    assert.equal(queue.items[0].reportCount, COUNT_CAP + (await t.rows('SELECT COUNT(*) AS n FROM reports'))[0].n - COUNT_CAP, 'an item’s own count is whole');
    await t.db.prepare("UPDATE reports SET status = 'resolved', resolved_at = '2026-11-21T00:00:00Z'").run();
    const history = (await t.get('/api/moderation/queue/history')).body.result;
    assert.deepEqual([history.total, history.counts.history, history.counts.capped], [COUNT_CAP, COUNT_CAP, true]);
  });
});

describe('the report page', () => {
  it('shows what a post or comment report is about, and the intake only to super admins', async () => {
    const t = setup('production', { lookup: { 'comment:cmt-synth-01': { found: true, title: 'the text', parentId: 'post-synth-01', parentType: 'post', channelId: 'ch_1', channelName: 'Channel', ownerId: 'usr_o', isHidden: false, isDeleted: false } } });
    await t.db.prepare("INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, created_at) VALUES ('r1', 'comment', 'cmt-synth-01', 'guest', 'child_safety', 'pending', '2026-11-24T00:00:00Z')").run();
    const seen = (await t.get('/api/moderation/reports/r1')).body.result;
    assert.deepEqual([seen.item.title, seen.item.parentType, seen.item.owner.id, seen.item.channel.name], ['the text', 'post', 'usr_o', 'Channel']);
    assert.equal(seen.intake, null);
    const superAdmin = (await t.get('/api/moderation/reports/r1', 'super_admin')).body.result;
    assert.deepEqual(superAdmin.intake, { url: 'https://videos.alummahnow.net/en/post/post-synth-01?comment=cmt-synth-01', evidence: false });
  });

  it('the intake page is for exactly that item, or not offered', () => {
    const o = 'https://videos.qa.alummahnow.net';
    const live = (over: Json) => ({ found: true, parentId: null, parentType: null, ...over }) as never;
    assert.equal(reportIntakeUrl(o, { type: 'video', id: 'vid-synth-01', live: null }), `${o}/en/video/vid-synth-01`);
    assert.equal(reportIntakeUrl(o, { type: 'post', id: 'post-synth-01', live: null }), `${o}/en/post/post-synth-01`);
    assert.equal(reportIntakeUrl(o, { type: 'livestream', id: 'live-synth-01', live: null }), `${o}/en/live/live-synth-01`);
    assert.equal(reportIntakeUrl(o, { type: 'comment', id: 'cmt-synth-01', live: live({ parentId: 'vid-synth-01', parentType: 'video' }) }), `${o}/en/video/vid-synth-01?comment=cmt-synth-01`);
    for (const item of [{ type: 'comment', id: 'cmt-synth-01', live: null }, { type: 'comment', id: 'x', live: live({ parentId: 'vid-synth-01', parentType: 'video' }) }, { type: 'live_chat', id: 'msg-synth-01', live: null }, { type: 'channel', id: 'chan-synth-01', live: null }, { type: 'video', id: 'x', live: null }]) assert.equal(reportIntakeUrl(o, item as never), null, JSON.stringify(item));
    assert.equal(reportIntakeUrl(null, { type: 'video', id: 'vid-synth-01', live: null }), null);
    assert.equal(reportIntakeUrl('https://evil.example', { type: 'video', id: 'vid-synth-01', live: null }), null);
  });
});
