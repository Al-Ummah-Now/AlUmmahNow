/**
 * The video review queue for people (docs/specs/VIDEO-REVIEW.md §6) against the real reports
 * schema (node:sqlite) with a fake api-videos. Covers the roles (VR7), the appeal rule (VR10),
 * undo, reveal audit, alerts, settings, channel trust, stats and retention. No AI anywhere.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { VIDEO_REVIEW_SETTINGS_KEY, clearVideoReviewSettingsCache } from '@al-ummah/shared-types';
import reviewRouter from '../src/routers/review.router';
import { purgeReviewMedia } from '../src/lib/review/queue';
import { adminMiddleware } from '../src/middleware/auth';
import { sqliteD1 } from './d1-sqlite';
import { MemoryR2 } from './r2-fake';

const NOW = new Date().toISOString();

function setup() {
  clearVideoReviewSettingsCache();
  const db = sqliteD1();
  const decisions: Array<{ path: string; body: any }> = [];
  let videosStatus = 200;
  const env = {
    REPORTS_DB: db,
    global_settings: new MemoryR2(),
    channels: new MemoryR2(),
    videos: new MemoryR2(),
    REVIEW_MEDIA: (() => {
      const files = new Map<string, string>([['review/v1/rev/frames/000001.jpg', 'jpeg'], ['review/v1/rev/manifest.json', '{}'], ['review/v2/rev/frames/x.jpg', 'other']]);
      return {
        files,
        async get(key: string) { const v = files.get(key); return v === undefined ? null : { body: new Response(v).body as ReadableStream, httpMetadata: { contentType: 'image/jpeg' }, text: async () => v }; },
        async list({ prefix }: { prefix: string }) { return { objects: [...files.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
        async delete(keys: string | string[]) { for (const k of [keys].flat()) files.delete(k); },
      };
    })(),
    VIDEOS: { fetch: async (url: RequestInfo, init?: RequestInit) => { decisions.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)) }); return new Response('{"success":true}', { status: videosStatus }); } },
    INTERNAL_API_KEY: 'k',
    VIDEO_REVIEW_ALLOWED: 'true',
  };
  env.videos.set('v1', { id: 'v1', title: 'Talk', userId: 'u1', channelId: 'ch1', review: { status: 'in_review', manifestKey: 'review/v1/rev/manifest.json' } });
  env.channels.set('ch1', { id: 'ch1', name: 'C' });
  const insert = (id: string, extra: Record<string, unknown> = {}) => {
    const row = { id, subject_type: 'video', subject_id: 'v1', channel_id: 'ch1', owner_id: 'u1', status: 'in_review', mode: 'enforce', timing: 'pre', created_at: NOW, updated_at: NOW, sla_due_at: NOW, nsfw: 0, escalate: 0, ...extra };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO content_reviews (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...Object.values(row)).run();
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles') ?? 'content_reviewer';
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'rev1', roles: roles.split(','), payload: {} } as never);
    await next();
  });
  app.use('/api/*', adminMiddleware as never);
  app.route('/api/review', reviewRouter as never);
  const call = async (method: string, path: string, opts: { roles?: string; user?: string; body?: unknown } = {}) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(opts.roles ? { 'x-test-roles': opts.roles } : {}), ...(opts.user ? { 'x-test-user': opts.user } : {}) }, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) }, env as never);
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  return { db, env, decisions, insert, call, setVideosStatus: (s: number) => (videosStatus = s) };
}

describe('access (VR7)', () => {
  it('a content reviewer reaches the review queue only; other admin routes stay closed to them', async () => {
    const t = setup();
    assert.equal((await t.call('GET', '/api/review/queue')).status, 200);
    assert.equal((await t.call('GET', '/api/review/queue', { roles: 'user' })).status, 403);
  });

  it('content reviewers never see escalations; seniors do, first', async () => {
    const t = setup();
    t.insert('r1');
    t.insert('r2', { escalate: 1 });
    const plain = await t.call('GET', '/api/review/queue');
    assert.deepEqual(plain.body.result.items.map((r: any) => r.id), ['r1']);
    assert.equal((await t.call('GET', '/api/review/r2')).status, 403);
    const senior = await t.call('GET', '/api/review/queue', { roles: 'senior_reviewer' });
    assert.deepEqual(senior.body.result.items.map((r: any) => r.id).sort(), ['r1', 'r2']);
  });

  it('pages with a cursor', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) t.insert(`r${i}`, { sla_due_at: `2026-11-13T12:0${i}:00.000Z` });
    const first = await t.call('GET', '/api/review/queue?limit=2');
    assert.deepEqual(first.body.result.items.map((r: any) => r.id), ['r0', 'r1']);
    const second = await t.call('GET', `/api/review/queue?limit=2&cursor=${first.body.result.nextCursor}`);
    assert.deepEqual(second.body.result.items.map((r: any) => r.id), ['r2', 'r3']);
  });
});

describe('decisions', () => {
  it('approve: applied on the video by api-videos, then recorded and audited, with a 10-minute undo', async () => {
    const t = setup();
    t.insert('r1');
    const res = await t.call('POST', '/api/review/r1/decision', { body: { decision: 'approve' } });
    assert.equal(res.status, 200);
    assert.equal(t.decisions[0].path, '/internal/review/v1/decision');
    assert.equal(t.decisions[0].body.decision, 'approve');
    const row = t.db.prepare('SELECT * FROM content_reviews WHERE id = ?').bind('r1').first<any>() as any;
    const stored = await row;
    assert.equal(stored.status, 'approved');
    assert.ok(stored.undo_until);
    assert.ok(stored.media_purge_after, 'media purge scheduled after the decision (VR12)');
    const actions = await t.db.prepare("SELECT action FROM moderation_actions WHERE subject_type = 'video_review'").all<{ action: string }>();
    assert.deepEqual(actions.results?.map((a) => a.action), ['review_approve']);
    const undo = await t.call('POST', '/api/review/r1/decision', { body: { decision: 'undo' } });
    assert.equal(undo.status, 200);
    assert.equal(t.decisions[1].body.decision, 'undo');
    assert.equal((await t.db.prepare('SELECT status FROM content_reviews WHERE id = ?').bind('r1').first<any>()).status, 'in_review');
  });

  it('reject needs a reason; api-videos refusing leaves the row untouched', async () => {
    const t = setup();
    t.insert('r1');
    assert.equal((await t.call('POST', '/api/review/r1/decision', { body: { decision: 'reject' } })).status, 400);
    t.setVideosStatus(409);
    assert.equal((await t.call('POST', '/api/review/r1/decision', { body: { decision: 'reject', reasonCode: 'sexual' } })).status, 409);
    assert.equal((await t.db.prepare('SELECT status FROM content_reviews WHERE id = ?').bind('r1').first<any>()).status, 'in_review');
  });

  it('an appeal is decided by someone other than the person who rejected it (VR10)', async () => {
    const t = setup();
    t.insert('r1', { status: 'rejected', decided_by: 'rev1', decided_at: NOW, decision: 'reject' });
    t.insert('a1', { status: 'appealed', appeal_of: 'r1', hold_cause: 'appeal' });
    assert.equal((await t.call('POST', '/api/review/a1/decision', { body: { decision: 'approve' }, user: 'rev1' })).status, 403);
    assert.equal((await t.call('POST', '/api/review/a1/decision', { body: { decision: 'approve' }, user: 'rev2' })).status, 200);
  });

  it('escalate moves it to the seniors', async () => {
    const t = setup();
    t.insert('r1');
    assert.equal((await t.call('POST', '/api/review/r1/decision', { body: { decision: 'escalate', note: 'looks like a minor' } })).status, 200);
    assert.equal((await t.call('GET', '/api/review/queue')).body.result.items.length, 0);
  });
});

describe('item, media and reveal', () => {
  it('the detail has findings and the subject; media is served only under the subject’s review prefix', async () => {
    const t = setup();
    t.insert('r1');
    await t.db.prepare("INSERT INTO content_review_findings (id, review_id, source, category, score, at_ms, media_key, model, created_at) VALUES ('f1', 'r1', 'frame', 'sexual', 0.9, 42000, 'review/v1/rev/frames/000001.jpg', 'm', ?)").bind(NOW).run();
    const detail = await t.call('GET', '/api/review/r1');
    assert.equal(detail.body.result.findings[0].at_ms, 42000);
    assert.equal(detail.body.result.subject.title, 'Talk');
    assert.equal(detail.body.result.manifestKey, 'review/v1/rev/manifest.json');
    const app = await t.call('GET', '/api/review/r1/media?key=review/v2/rev/frames/x.jpg');
    assert.equal(app.status, 403, 'another video’s media');
    const reveal = await t.call('POST', '/api/review/r1/reveal', { body: { target: 'frame@42000' } });
    assert.equal(reveal.status, 200);
    const audit = await t.db.prepare("SELECT action FROM moderation_actions WHERE action = 'review_reveal'").all();
    assert.equal(audit.results?.length, 1);
  });
});

describe('alerts, settings, trust, stats, retention', () => {
  it('alerts: on and off for me; seniors are flagged senior', async () => {
    const t = setup();
    await t.call('POST', '/api/review/alerts', { body: { on: true }, roles: 'senior_reviewer', user: 'owner' });
    assert.equal((await t.db.prepare('SELECT senior FROM review_alert_subscribers WHERE user_id = ?').bind('owner').first<any>()).senior, 1);
    assert.equal((await t.call('GET', '/api/review/alerts', { user: 'owner', roles: 'senior_reviewer' })).body.result.alerts, true);
    await t.call('POST', '/api/review/alerts', { body: { on: false }, user: 'owner', roles: 'senior_reviewer' });
    assert.equal((await t.call('GET', '/api/review/alerts', { user: 'owner', roles: 'senior_reviewer' })).body.result.alerts, false);
  });

  it('settings: admins only, merged and audited; reviewers can read them', async () => {
    const t = setup();
    assert.equal((await t.call('PUT', '/api/review/settings', { body: { mode: 'shadow' } })).status, 403);
    const put = await t.call('PUT', '/api/review/settings', { roles: 'admin', body: { mode: 'shadow', etaMinutes: 7, thresholds: { nsfwHit: 0.6 } } });
    assert.equal(put.status, 200);
    assert.equal(t.env.global_settings.read(VIDEO_REVIEW_SETTINGS_KEY).mode, 'shadow');
    const got = await t.call('GET', '/api/review/settings');
    assert.equal(got.body.result.settings.etaMinutes, 7);
    assert.equal(got.body.result.settings.thresholds.nsfwHit, 0.6);
    assert.equal(got.body.result.effectiveMode, 'shadow');
  });

  it('channel trust (post-hoc review) is set by admins and audited', async () => {
    const t = setup();
    assert.equal((await t.call('PUT', '/api/review/channels/ch1/trust', { roles: 'admin', body: { trusted: true } })).status, 200);
    assert.equal(t.env.channels.read('ch1').reviewTrusted, true);
    await t.call('PUT', '/api/review/channels/ch1/trust', { roles: 'admin', body: { trusted: false } });
    assert.equal(t.env.channels.read('ch1').reviewTrusted, undefined);
  });

  it('stats answer even when empty', async () => {
    const t = setup();
    t.insert('r1');
    const stats = await t.call('GET', '/api/review/stats');
    assert.equal(stats.body.result.open.in_review, 1);
    assert.equal(stats.body.result.queueMinutes, null);
  });

  it('retention deletes the video’s review media and the finding text after the purge date', async () => {
    const t = setup();
    t.insert('r1', { status: 'approved', media_purge_after: '2000-01-01T00:00:00.000Z' });
    await t.db.prepare("INSERT INTO content_review_findings (id, review_id, source, category, score, text, media_key, model, created_at) VALUES ('f1', 'r1', 'transcript', 'hate', 0.4, 'words', 'review/v1/rev/frames/000001.jpg', 'm', ?)").bind(NOW).run();
    const r = await purgeReviewMedia(t.env as never);
    assert.equal(r.purged, 1);
    assert.equal([...t.env.REVIEW_MEDIA.files.keys()].some((k) => k.startsWith('review/v1/')), false);
    assert.equal(t.env.REVIEW_MEDIA.files.has('review/v2/rev/frames/x.jpg'), true, 'other videos untouched');
    const f = await t.db.prepare("SELECT text, media_key FROM content_review_findings WHERE id = 'f1'").first<any>();
    assert.equal(f.text, null);
    assert.equal(f.media_key, null);
  });
});
