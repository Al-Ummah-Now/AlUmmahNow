/**
 * CSAM cases (lib/csam.ts, routers/csam.router.ts; docs/specs/CSAM-RESPONSE.md): super admins
 * only, intake and mapping, the freeze, the report, the legal hold, retention, the append-only
 * access log and the signed Cloudflare webhook. Real migrations on node:sqlite and a fake
 * api-videos. Synthetic URLs only: no real hash, image or match.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import csamRouter from '../src/routers/csam.router';
import contentRouter from '../src/routers/content.router';
import { generateWebhookSecret, handleCloudflareWebhook, runCsamRetention, webhookUrlFor } from '../src/lib/csam';
import { STEP_UP_ROUTES } from '../src/middleware/step-up-routes';
import { sqliteD1 } from './d1-sqlite';

const DAY = 86_400_000;
const VIDEO_URL = 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg';
const AVATAR_URL = 'https://images.alummahnow.net/synthetic-placeholder_avatar.jpeg';

interface Call { method: string; path: string; body: any; actor: string | null }

/** api-videos: /internal/csam/* and the admin reads the report facts use. */
function fakeVideos(account: { email: string; deleted: boolean } | null | 'down' = { email: 'uploader@example.test', deleted: false }) {
  const calls: Call[] = [];
  let jobStatus = 'running';
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      const call: Call = { method: init.method ?? 'GET', path: url.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : null, actor: headers.get('X-Admin-Actor') };
      calls.push(call);
      const reply = (result: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, result } : { success: false, code: result }), { status, headers: { 'content-type': 'application/json' } });
      const p = call.path;
      if (p === '/internal/csam/accounts' && !call.body.ids.includes('usr_uploader')) {
        const known: Record<string, { email: string; deleted: boolean }> = { usr_same: { email: 'same@example.test', deleted: false }, usr_differs: { email: 'account@example.test', deleted: false }, usr_deleted: { email: 'deleted@example.test', deleted: true }, usr_erased: { email: 'erased@example.test', deleted: false } };
        return reply({ accounts: Object.fromEntries(Object.entries(known).filter(([id]) => call.body.ids.includes(id))) });
      }
      if (p === '/internal/csam/accounts') return account === 'down' ? reply('auth_unavailable', 503) : reply({ accounts: account && call.body.ids.includes('usr_uploader') ? { usr_uploader: account } : {} });
      if (p === '/internal/csam/resolve') {
        const host = new URL(call.body.url).hostname;
        if (host === 'media.alummahnow.net') return reply({ ok: true, resolution: { kind: 'video_thumbnail', videoId: 'vid-synth-01', channelId: 'chan-synth-01', uploaderId: 'usr_uploader' } });
        if (host === 'images.alummahnow.net') return reply({ ok: false, reason: 'not_found', target: { kind: 'image', path: '/x' } });
        return reply({ ok: false, reason: 'not_ours' });
      }
      if (p === '/internal/csam/resolve-by-hand') return reply({ kind: 'profile_image', imageField: 'avatarUrl', imagePath: '/synthetic-placeholder_avatar.jpeg', channelId: null, uploaderId: call.body.id === 'usr_erased' ? null : call.body.id });
      if (p === '/internal/csam/contain') return reply({ job: { id: `job-${call.body.caseId}` }, hide: { hidden: true, cdn: 'purged' }, ...(call.body.resolution.kind === 'profile_image' && !call.body.resolution.uploaderId ? { account: 'usr_erased' } : {}) });
      if (p === '/internal/csam/retry') return reply({ retried: true });
      if (/^\/internal\/csam\/cases\/[^/]+\/job$/.test(p)) return reply({ job: { id: 'job-x', status: jobStatus, attempts: 1, lastError: null, result: { phase: 'ban' } } });
      if (/^\/internal\/csam\/cases\/[^/]+\/manifest$/.test(p)) return reply({ v: 1, caseId: 'x', matchedUrl: VIDEO_URL, resolution: {}, files: [{ name: '01-matched.jpg', source: 'MEDIA/pub/x', contentType: 'image/jpeg', bytes: 12, chunkSha256: ['a'], chunkBytes: 8, keyVersion: 1, copiedAt: 't' }], missing: [], createdAt: 't', completedAt: 't' });
      if (/^\/internal\/csam\/cases\/[^/]+\/files\//.test(p)) return new Response('SYNTHETIC', { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="x"', 'content-length': '9' } });
      if (/^\/internal\/csam\/cases\/[^/]+\/evidence$/.test(p)) return reply({ deleted: 3 });
      if (p === '/internal/admin/users/usr_uploader') return reply({ id: 'usr_uploader', email: 'profile.copy@example.test', emailSource: 'auth', displayName: 'Synthetic Uploader', userName: 'synthetic' });
      if (p === '/internal/admin/channels/chan-synth-01') return reply({ id: 'chan-synth-01', name: 'Synthetic channel' });
      if (p === '/internal/admin/videos/vid-synth-01') return reply({ id: 'vid-synth-01', createdAt: '2026-11-01T00:00:00.000Z' });
      if (/^\/internal\/admin\/users\/[^/]+\/ban$/.test(p)) return reply({ ban: {} });
      if (p === '/internal/admin/jobs') return reply({ items: [{ id: 'j1', kind: 'csam.contain', targetKind: 'video', targetId: 'v', params: { caseId: 'c', matchedUrl: VIDEO_URL }, status: 'failed', attempts: 6, lastError: 'boom', result: { phase: 'plan' } }, { id: 'j2', kind: 'video.purge', targetKind: 'video', targetId: 'v', params: { userId: 'u' }, status: 'succeeded', attempts: 1, lastError: null, result: null }] });
      if (p === '/internal/admin/jobs/j1') return reply({ id: 'j1', kind: 'csam.contain', targetKind: 'video', targetId: 'v', params: { caseId: 'c' }, status: 'failed', attempts: 6, lastError: 'boom', result: null });
      return reply('not_found', 404);
    },
  };
  return { fetcher, calls, setJob: (s: string) => { jobStatus = s; } };
}

function setup(account?: Parameters<typeof fakeVideos>[0]) {
  const db = sqliteD1();
  const videos = fakeVideos(account);
  const queued: unknown[] = [];
  const errors: any[] = [];
  const env = {
    REPORTS_DB: db,
    VIDEOS: videos.fetcher,
    INTERNAL_API_KEY: 'internal-key',
    ENVIRONMENT: 'production',
    ADMIN_WEB_URL: 'https://admin.alummahnow.net',
    AUTH_REQUESTS_QUEUE: { send: async (m: unknown) => { queued.push(m); } },
    ERRORS_QUEUE: { send: async (m: unknown) => { errors.push(m); } },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-roles') ?? 'super_admin';
    c.set('auth' as never, { userId: c.req.header('x-user') ?? 'usr_super', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/csam', csamRouter as never);
  app.route('/api/content', contentRouter);
  const call = (path: string, init: { method?: string; json?: unknown; roles?: string } = {}) =>
    app.request(path, { method: init.method ?? 'GET', headers: { 'x-roles': init.roles ?? 'super_admin', ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) }, env);
  const json = async (path: string, init: Parameters<typeof call>[1] = {}) => {
    const res = await call(path, init);
    return { status: res.status, body: (await res.json()) as any };
  };
  const log = async (caseId: string) => (await db.prepare('SELECT action FROM csam_access_log WHERE case_id = ? ORDER BY created_at, rowid').bind(caseId).all<{ action: string }>()).results.map((r) => r.action);
  const flags = () => errors.flatMap((m: any) => (m.events ?? []).map((e: any) => e.action?.key)).filter(Boolean);
  const resolved = () => errors.flatMap((m: any) => m.resolved ?? []);
  return { db, env, videos, queued, call, json, log, flags, resolved };
}

describe('who may use it', () => {
  it('only super admins, on every route, whatever other role they hold', async () => {
    const t = setup();
    for (const roles of ['admin', 'moderator', 'admin,moderator', '']) {
      for (const [method, path] of [['GET', '/api/csam'], ['POST', '/api/csam/intake'], ['GET', '/api/csam/settings'], ['GET', '/api/csam/00000000-0000-0000-0000-000000000000'], ['GET', '/api/csam/x/files/y']]) {
        assert.equal((await t.call(path, { method, roles, json: method === 'POST' ? { text: VIDEO_URL } : undefined })).status, 403, `${roles} ${method} ${path}`);
      }
    }
    assert.equal(t.videos.calls.length, 0);
  });

  it('intake, mapping, retry, the report, evidence, holds, retention and the webhook secret need a step-up', () => {
    const paths = STEP_UP_ROUTES.map((r) => `${r.method} ${r.path}`);
    for (const p of ['POST /api/csam/intake', 'POST /api/csam/:id/map', 'POST /api/csam/:id/retry', 'POST /api/csam/:id/reported', 'GET /api/csam/:id/files/:name', 'POST /api/csam/:id/hold', 'PUT /api/csam/settings', 'POST /api/csam/settings/webhook-secret']) assert.ok(paths.includes(p), p);
  });

  it('other admins never see a CSAM job\'s details, and cannot retry one', async () => {
    const t = setup();
    const listed = (await t.json('/api/content/jobs', { roles: 'admin' })).body.result.items;
    assert.deepEqual(listed[0].params, {});
    assert.equal(listed[0].result, null);
    assert.equal(listed[0].lastError, 'hidden');
    assert.deepEqual(listed[1].params, { userId: 'u' });
    assert.equal((await t.json('/api/content/jobs', { roles: 'super_admin' })).body.result.items[0].params.caseId, 'c');
    assert.equal((await t.call('/api/content/jobs/j1/retry', { method: 'POST', roles: 'admin' })).status, 403);
  });
});

describe('case emails', () => {
  it('lists the cases whose captured email is not the uploader account email, pages by id and logs the read', async () => {
    const t = setup();
    const add = (id: string, uploader: string | null, email: string | null) =>
      t.db
        .prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, uploader_id, facts, detected_at, created_by, created_at, updated_at) VALUES (?, 'u', ?, 'paste', 'reported', ?, ?, '2026-11-01', 'a', '2026-11-01', '2026-11-01')")
        .bind(id, id, uploader, JSON.stringify({ uploader: { userId: uploader, email } }))
        .run();
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    await add(id(1), 'usr_same', 'Same@Example.test');
    await add(id(2), 'usr_differs', 'copy@example.test');
    await add(id(3), 'usr_noacct', 'copy2@example.test');
    await add(id(4), 'usr_differs', null);
    await add(id(5), null, null);
    // Deleted, not purged: still compared
    await add(id(6), 'usr_deleted', 'deleted@example.test');
    const page = (await t.json('/api/csam/email-check')).body.result;
    assert.deepEqual(page, {
      checked: 6,
      items: [
        { caseId: id(2), userId: 'usr_differs', captured: 'copy@example.test', account: 'account@example.test' },
        { caseId: id(3), userId: 'usr_noacct', captured: 'copy2@example.test', account: null },
      ],
      next: null,
    });
    const log = (await t.json('/api/csam/log')).body.result.items;
    assert.deepEqual(log.map((l: any) => [l.action, l.detail]), [['cases.email_checked', { checked: 6, found: 2 }]]);

    for (let n = 7; n <= 52; n++) await add(id(n), 'usr_same', 'same@example.test');
    const first = (await t.json('/api/csam/email-check')).body.result;
    assert.deepEqual([first.checked, first.next], [50, id(50)]);
    const second = (await t.json(`/api/csam/email-check?after=${first.next}`)).body.result;
    assert.deepEqual([second.checked, second.next], [2, null]);
    assert.equal((await t.json('/api/csam/email-check?after=%27')).status, 400);
    for (const roles of ['admin', 'moderator', '']) assert.equal((await t.call('/api/csam/email-check', { roles })).status, 403);
    const plan = (await t.db.prepare('EXPLAIN QUERY PLAN SELECT id, uploader_id, facts FROM csam_cases WHERE id > ? ORDER BY id LIMIT ?').bind('', 50).all<{ detail: string }>()).results;
    assert.ok(plan.every((p) => /^SEARCH csam_cases USING INDEX sqlite_autoindex_csam_cases_1 \(id>\?\)/.test(p.detail)), JSON.stringify(plan));
  });
});

describe('intake', () => {
  it('opens one case per matched URL, takes mapped ones down at once and freezes the uploader', async () => {
    const t = setup();
    const out = (await t.json('/api/csam/intake', { method: 'POST', json: { text: `Synthetic alert:\n${VIDEO_URL}\n${AVATAR_URL}\nhttps://example.com/not-ours.jpg` } })).body.result;
    assert.equal(out.cases.length, 2);
    const [video, avatar] = out.cases;
    assert.equal(video.status, 'containing');
    assert.equal(video.uploaderId, 'usr_uploader');
    assert.equal(avatar.status, 'unmapped');
    // The takedown, the videos ban and two Auth requests (idempotent per case)
    const contain = t.videos.calls.find((c) => c.path === '/internal/csam/contain')!;
    assert.equal(contain.body.caseId, video.id);
    assert.equal(contain.actor, 'usr_super');
    assert.ok(t.videos.calls.some((c) => c.path === '/internal/admin/users/usr_uploader/ban' && c.method === 'POST'));
    const requests = (await t.db.prepare('SELECT action, reason_category, reason, evidence FROM auth_moderation_requests ORDER BY action').all<any>()).results;
    assert.deepEqual(requests.map((r) => r.action), ['revoke_sessions', 'suspend_account']);
    // Never a link to the matched content in what goes to Auth, and the reasons (read by moderators
    // who cannot open CSAM cases) never say CSAM
    for (const r of requests) assert.equal(r.evidence.includes('alummahnow.net/pub'), false);
    const ban = t.videos.calls.find((c) => c.path === '/internal/admin/users/usr_uploader/ban')!;
    for (const reason of [ban.body.reason, ...requests.map((r) => r.reason)]) {
      assert.equal(reason, `Trust and safety action (ref ${video.id})`);
    }
    assert.equal(t.queued.length, 2);
    // Each case is flagged for the report
    assert.deepEqual(t.flags().filter((k: string) => k.startsWith('csam:')).sort(), [`csam:${avatar.id}`, `csam:${video.id}`].sort());
    assert.deepEqual(await t.log(video.id), ['case.opened']);
    // The same URLs again join the open cases
    const again = (await t.json('/api/csam/intake', { method: 'POST', json: { text: `${VIDEO_URL}?x=1 and ${AVATAR_URL}` } })).body.result;
    assert.equal(again.cases.length, 0);
    assert.deepEqual(again.existing.sort(), [avatar.id, video.id].sort());
  });

  it('an erased profile: the account alone is frozen, the case names no uploader, and a retry still knows whose it was', async () => {
    for (const fails of [false, true]) {
      const t = setup();
      const [avatar] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: AVATAR_URL } })).body.result.cases;
      const breaks = t.db.prepare.bind(t.db);
      if (fails) (t.db as any).prepare = (sql: string) => { if (/INTO\s+auth_moderation_requests/.test(sql)) throw new Error('D1 down'); return breaks(sql); };
      const mapped = (await t.json(`/api/csam/${avatar.id}/map`, { method: 'POST', json: { kind: 'profile_image', id: 'usr_erased', field: 'avatarUrl' } })).body.result;
      assert.equal(mapped.uploaderId, null);
      const requests = async () => (await t.db.prepare('SELECT subject_user_id, action, reason FROM auth_moderation_requests ORDER BY action').all<any>()).results;
      if (fails) {
        assert.equal((await requests()).length, 0);
        assert.ok(t.flags().includes(`csam-freeze:${avatar.id}`));
        (t.db as any).prepare = breaks;
        await t.json(`/api/csam/${avatar.id}/retry`, { method: 'POST' });
      }
      assert.deepEqual((await requests()).map((r) => [r.subject_user_id, r.action, r.reason]), ['revoke_sessions', 'suspend_account'].map((action) => ['usr_erased', action, `Trust and safety action (ref ${avatar.id})`]), `fails ${fails}`);
      const row = (await t.db.prepare('SELECT uploader_id, resolution, freeze FROM csam_cases WHERE id = ?').bind(avatar.id).first<any>())!;
      assert.equal(row.uploader_id, null);
      assert.ok(!row.resolution.includes('usr_erased'));
      const freeze = JSON.parse(row.freeze);
      assert.deepEqual([freeze.ban, freeze.account, freeze.error], ['no_uploader', 'usr_erased', undefined]);
      // The report facts carry the account, from the freeze record only
      const facts = (await t.json(`/api/csam/${avatar.id}`)).body.result.facts.uploader;
      assert.deepEqual([facts.userId, facts.email, facts.emailSource], ['usr_erased', 'erased@example.test', 'auth']);
      const columns = (await t.db.prepare('SELECT * FROM csam_cases WHERE id = ?').bind(avatar.id).first<Record<string, unknown>>())!;
      for (const [name, value] of Object.entries(columns)) if (name !== 'freeze') assert.ok(!/usr_erased|erased@example/.test(String(value)), name);
      // Nothing is written about it on videos
      assert.deepEqual(t.videos.calls.filter((c) => c.path.includes('usr_erased')), []);
    }
  });

  it('a hand mapping takes an unmapped case down', async () => {
    const t = setup();
    const [avatar] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: AVATAR_URL } })).body.result.cases;
    const mapped = (await t.json(`/api/csam/${avatar.id}/map`, { method: 'POST', json: { kind: 'profile_image', id: 'usr_uploader', field: 'avatarUrl' } })).body.result;
    assert.equal(mapped.status, 'containing');
    assert.deepEqual(await t.log(avatar.id), ['case.opened', 'case.mapped']);
    // The log keeps what was chosen: nothing can check a hand mapping against the URL
    const entry = await t.db.prepare("SELECT detail FROM csam_access_log WHERE case_id = ? AND action = 'case.mapped'").bind(avatar.id).first<{ detail: string }>();
    assert.equal(JSON.parse(entry!.detail).uploaderId, 'usr_uploader');
    assert.equal((await t.json(`/api/csam/${avatar.id}/map`, { method: 'POST', json: { kind: 'profile_image', id: 'usr_uploader', field: 'avatarUrl' } })).body.code, 'already_mapped');
  });
});

describe('the case', () => {
  it("the report facts keep only the sign-in account's email, and say where it is from", async () => {
    const facts = async (account: Parameters<typeof setup>[0]) => {
      const t = setup(account);
      const [c] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: VIDEO_URL } })).body.result.cases;
      const { email, emailSource } = (await t.json(`/api/csam/${c.id}`)).body.result.facts.uploader;
      return { email, emailSource };
    };
    assert.deepEqual(await facts({ email: 'account@example.test', deleted: false }), { email: 'account@example.test', emailSource: 'auth' });
    // Deleted before the capture, not purged yet: still identified
    assert.deepEqual(await facts({ email: 'account@example.test', deleted: true }), { email: 'account@example.test', emailSource: 'deleted_account' });
    // Purged, or never had one
    assert.deepEqual(await facts(null), { email: null, emailSource: 'none' });
    assert.deepEqual(await facts('down'), { email: null, emailSource: 'unavailable' });
  });

  it('shows the job, the evidence list and the report facts captured before the takedown; every view is logged', async () => {
    const t = setup();
    const [c] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: VIDEO_URL } })).body.result.cases;
    t.videos.setJob('succeeded');
    const detail = (await t.json(`/api/csam/${c.id}`)).body.result;
    assert.equal(detail.status, 'contained');
    assert.equal(detail.job.phase, 'ban');
    assert.deepEqual(detail.evidence.files.map((f: any) => f.name), ['01-matched.jpg']);
    assert.equal(detail.facts.uploader.email, 'uploader@example.test');
    assert.equal(detail.facts.uploader.emailSource, 'auth');
    assert.equal(detail.facts.uploader.channelName, 'Synthetic channel');
    assert.equal(detail.facts.uploadedAt, '2026-11-01T00:00:00.000Z');
    assert.equal(detail.facts.ipAddress, undefined);
    assert.equal(detail.facts.uploader.ipAddress, null);
    assert.deepEqual(detail.authRequests.map((r: any) => r.action), ['revoke_sessions', 'suspend_account']);
    assert.deepEqual(await t.log(c.id), ['case.opened', 'case.viewed']);
  });

  it('downloads are logged first and come as an opaque attachment', async () => {
    const t = setup();
    const [c] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: VIDEO_URL } })).body.result.cases;
    const res = await t.call(`/api/csam/${c.id}/files/01-matched.jpg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment/);
    assert.equal(res.headers.get('cache-control'), 'no-store, private');
    assert.equal(await res.text(), 'SYNTHETIC');
    assert.deepEqual(await t.log(c.id), ['case.opened', 'file.downloaded']);
    assert.equal((await t.call(`/api/csam/${c.id}/files/..%2F..%2Fsecret`)).status, 400);
  });

  it('reported: needs a report id; starts the retention clock; resolves the flag', async () => {
    const t = setup();
    const [c] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: VIDEO_URL } })).body.result.cases;
    assert.equal((await t.json(`/api/csam/${c.id}/reported`, { method: 'POST', json: { reportId: '' } })).body.code, 'invalid_report_id');
    const reportedAt = new Date().toISOString();
    const out = (await t.json(`/api/csam/${c.id}/reported`, { method: 'POST', json: { reportId: 'SYNTH-0001', reportedAt } })).body.result;
    assert.equal(out.status, 'reported');
    assert.equal(out.retainUntil, new Date(Date.parse(reportedAt) + 365 * DAY).toISOString());
    assert.ok(t.resolved().includes(`csam:${c.id}`));
    assert.ok((await t.log(c.id)).includes('case.reported'));
    // The time is fixed once recorded (it starts the retention clock); a mistyped id can be corrected
    const earlier = new Date(Date.now() - 3600_000).toISOString();
    assert.equal((await t.json(`/api/csam/${c.id}/reported`, { method: 'POST', json: { reportId: 'SYNTH-0002', reportedAt: earlier } })).body.code, 'reported_at_fixed');
    const fixed = (await t.json(`/api/csam/${c.id}/reported`, { method: 'POST', json: { reportId: 'SYNTH-0002' } })).body.result;
    assert.equal(fixed.reportedAt, reportedAt);
    const row = await t.db.prepare('SELECT report_id FROM csam_cases WHERE id = ?').bind(c.id).first<{ report_id: string }>();
    assert.equal(row!.report_id, 'SYNTH-0002');
  });

  it('the access log is append-only', async () => {
    const t = setup();
    const [c] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: VIDEO_URL } })).body.result.cases;
    await assert.rejects(t.db.prepare('UPDATE csam_access_log SET actor_id = ? WHERE case_id = ?').bind('someone', c.id).run(), /append-only/);
    await assert.rejects(t.db.prepare('DELETE FROM csam_access_log WHERE case_id = ?').bind(c.id).run(), /append-only/);
  });
});

describe('retention and legal hold', () => {
  async function reported(t: ReturnType<typeof setup>, daysAgo: number) {
    const [c] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: `https://media.alummahnow.net/pub/vid-synth-${daysAgo}/r1/thumb.jpg` } })).body.result.cases;
    await t.db.prepare('UPDATE csam_cases SET status = ?, report_id = ?, reported_at = ?, detected_at = ? WHERE id = ?').bind('reported', 'SYNTH', new Date(Date.now() - daysAgo * DAY).toISOString(), new Date(Date.now() - (daysAgo + 1) * DAY).toISOString(), c.id).run();
    return c.id as string;
  }
  const evidenceDeletes = (t: ReturnType<typeof setup>) => t.videos.calls.filter((c) => c.method === 'DELETE').map((c) => c.path);

  it('deletes evidence only a year after the report, never under a hold, never before a report', async () => {
    const t = setup();
    const old = await reported(t, 400);
    const recent = await reported(t, 100);
    const held = await reported(t, 500);
    const [unreported] = (await t.json('/api/csam/intake', { method: 'POST', json: { text: AVATAR_URL } })).body.result.cases;
    await t.db.prepare('UPDATE csam_cases SET created_at = ?, detected_at = ? WHERE id = ?').bind('2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', unreported.id).run();
    assert.equal((await t.json(`/api/csam/${held}/hold`, { method: 'POST', json: { on: true } })).body.code, 'reason_required');
    assert.equal((await t.json(`/api/csam/${held}/hold`, { method: 'POST', json: { on: true, reason: 'Synthetic preservation request' } })).body.result.retainUntil, null);
    const out = await runCsamRetention(t.env as never);
    assert.deepEqual(out, { deleted: 1, failed: 0 });
    assert.deepEqual(evidenceDeletes(t), [`/internal/csam/cases/${old}/evidence`]);
    const row = await t.db.prepare('SELECT status, evidence_deleted_at FROM csam_cases WHERE id = ?').bind(old).first<any>();
    assert.equal(row.status, 'closed');
    assert.ok(row.evidence_deleted_at);
    assert.ok((await t.log(old)).includes('evidence.deleted'));
    assert.ok(!evidenceDeletes(t).some((p) => p.includes(recent) || p.includes(held) || p.includes(unreported.id)));
  });

  it('the setting accepts 365 days or more only, and a longer setting keeps evidence longer', async () => {
    const t = setup();
    assert.equal((await t.json('/api/csam/settings', { method: 'PUT', json: { retentionDays: 90 } })).body.code, 'invalid_retention');
    assert.equal((await t.json('/api/csam/settings', { method: 'PUT', json: { retentionDays: 364 } })).status, 400);
    assert.equal((await t.json('/api/csam/settings', { method: 'PUT', json: { retentionDays: 730 } })).body.result.retentionDays, 730);
    await reported(t, 400);
    assert.deepEqual(await runCsamRetention(t.env as never), { deleted: 0, failed: 0 });
    const settingsLog = (await t.json('/api/csam/log')).body.result.items;
    assert.equal(settingsLog[0].action, 'settings.changed');
  });
});

describe('the Cloudflare webhook', () => {
  it('refuses unsigned or wrongly signed calls; opens cases for our URLs; flags anything else', async () => {
    const t = setup();
    assert.equal((await handleCloudflareWebhook(t.env as never, { secret: 'anything', body: VIDEO_URL })).status, 401);
    const { secret, webhookUrl } = await generateWebhookSecret(t.env as never, 'usr_super');
    assert.equal(webhookUrl, 'https://admin.api.alummahnow.net/webhooks/cloudflare/notifications');
    assert.equal(webhookUrlFor({ ENVIRONMENT: 'qa' }), 'https://admin.qa.api.alummahnow.net/webhooks/cloudflare/notifications');
    const stored = await t.db.prepare("SELECT value FROM csam_settings WHERE key = 'webhook_secret_sha256'").first<{ value: string }>();
    assert.notEqual(stored!.value, secret);
    assert.equal((await handleCloudflareWebhook(t.env as never, { secret: `${secret}x`, body: VIDEO_URL })).status, 401);
    assert.equal((await handleCloudflareWebhook(t.env as never, { secret: undefined, body: VIDEO_URL })).status, 401);
    const opened = await handleCloudflareWebhook(t.env as never, { secret, body: JSON.stringify({ alert_type: 'synthetic_block', data: { url: VIDEO_URL } }) });
    assert.deepEqual(opened, { status: 200, opened: 1 });
    const row = await t.db.prepare('SELECT source, created_by FROM csam_cases').first<any>();
    assert.deepEqual({ ...row }, { source: 'webhook', created_by: 'cloudflare-webhook' });
    const test = await handleCloudflareWebhook(t.env as never, { secret, body: JSON.stringify({ alert_type: 'synthetic_test', text: 'Hello from Cloudflare' }) });
    assert.deepEqual(test, { status: 200, opened: 0 });
    assert.ok(t.flags().some((k: string) => k.startsWith('csam-webhook:')));
  });
});

describe('nothing else touches the CSAM tables', () => {
  it('no erasure, retention or other module names them', () => {
    const roots = [join(process.cwd(), 'src'), join(process.cwd(), '..', 'processor', 'src')];
    const allowed = new Set([join(process.cwd(), 'src', 'lib', 'csam.ts'), join(process.cwd(), 'src', 'routers', 'csam.router.ts')]);
    for (const root of roots) {
      for (const f of readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
        const file = join(root, f);
        if (allowed.has(file) || f.includes('__tests__')) continue;
        assert.equal(/csam_cases|csam_access_log|csam_settings/.test(readFileSync(file, 'utf8')), false, file);
      }
    }
  });
});
