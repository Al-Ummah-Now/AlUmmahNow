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

describe('live stream recordings (VR9, AlUmmahNow#1295)', () => {
  const SID = '11111111-2222-4333-8444-555555555555';
  function live() {
    const t = setup();
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    let gone = false;
    (t.env as any).VIDEOS = {
      fetch: async (url: RequestInfo, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        const method = init?.method ?? 'GET';
        calls.push({ method, path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (method === 'GET') {
          if (gone) return new Response('{"success":false}', { status: 404 });
          return Response.json({ success: true, result: { id: SID, title: 'Friday live', description: 'From the masjid', tags: ['khutbah'], channelId: 'ch1', ownerId: 'u1', duration: 3600, status: 'ended', review: { status: 'in_review', manifestKey: `review/${SID}/abc/manifest.json` }, playUrl: 'https://live.example/hls/s/vod.m3u8', thumbnailUrl: null } });
        }
        return Response.json({ success: true });
      },
    };
    t.insert('L1', { subject_type: 'livestream', subject_id: SID, timing: 'post', trigger: 'live_vod' });
    return { ...t, calls, setGone: () => (gone = true) };
  }

  it('the review page shows the recording (title, signed playlist, manifest) read from api-videos', async () => {
    const t = live();
    const r = await t.call('GET', '/api/review/L1');
    assert.equal(r.status, 200);
    assert.equal(r.body.result.subject.title, 'Friday live');
    assert.equal(r.body.result.subject.playUrl, 'https://live.example/hls/s/vod.m3u8');
    assert.equal(r.body.result.subject.currentStatus, 'in_review');
    assert.equal(r.body.result.manifestKey, `review/${SID}/abc/manifest.json`);
    assert.equal(t.calls[0].path, `/internal/review/livestream/${SID}`);
    t.setGone();
    assert.equal((await t.call('GET', '/api/review/L1')).body.result.subject, null, 'a deleted stream still opens the review');
  });

  it('a decision goes to the stream\'s decision route, and can be undone', async () => {
    const t = live();
    const r = await t.call('POST', '/api/review/L1/decision', { body: { decision: 'reject', reasonCode: 'hate' } });
    assert.equal(r.status, 200);
    const sent = t.calls.find((c) => c.method === 'POST')!;
    assert.equal(sent.path, `/internal/review/livestream/${SID}/decision`);
    assert.equal(sent.body.decision, 'reject');
    assert.equal(sent.body.reasonCode, 'hate');
    const undo = await t.call('POST', '/api/review/L1/decision', { body: { decision: 'undo' } });
    assert.equal(undo.status, 200);
    assert.equal(t.calls.filter((c) => c.method === 'POST').at(-1)!.body.decision, 'undo');
    assert.equal((await t.db.prepare('SELECT status FROM content_reviews WHERE id = ?').bind('L1').first<{ status: string }>())?.status, 'in_review');
  });

  it('retention purges the recording\'s review media', async () => {
    const t = live();
    t.env.REVIEW_MEDIA.files.set(`review/${SID}/abc/frames/1.jpg`, 'jpeg');
    t.db.prepare('UPDATE content_reviews SET media_purge_after = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', 'L1').run();
    await purgeReviewMedia(t.env as never);
    assert.equal(t.env.REVIEW_MEDIA.files.has(`review/${SID}/abc/frames/1.jpg`), false);
  });
});

describe('extra audio tracks (wiki AUN-MULTI-AUDIO MA8)', () => {
  const TID = 'tabc123def456';
  const SUBJECT = `v1:${TID}`;
  function audio() {
    const t = setup();
    const calls: Array<{ method: string; path: string; range?: string | null; body?: any }> = [];
    (t.env as any).VIDEOS = {
      fetch: async (url: RequestInfo, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        const method = init?.method ?? 'GET';
        const range = (init?.headers as Record<string, string> | undefined)?.range ?? null;
        calls.push({ method, path, range, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (method === 'GET' && path.endsWith('/audio')) return new Response('m4a', { status: range ? 206 : 200, headers: { 'content-length': '3', ...(range ? { 'content-range': 'bytes 0-2/3' } : {}) } });
        if (method === 'GET') return Response.json({ success: true, result: { videoId: 'v1', trackId: TID, title: 'Talk', channelId: 'ch1', ownerId: 'u1', duration: 60, language: 'en', label: 'English', kind: 'dub', review: { status: 'in_review', manifestKey: `review/v1/audio-${TID}-12345678/manifest.json` } } });
        return Response.json({ success: true });
      },
    };
    t.insert('A1', { subject_type: 'audio_track', subject_id: SUBJECT });
    t.env.REVIEW_MEDIA.files.set(`review/v1/audio-${TID}-12345678/audio/000.mp3`, 'mp3');
    return { ...t, calls };
  }

  it('the review page shows the track (language, label, kind) and its player URL', async () => {
    const t = audio();
    const r = await t.call('GET', '/api/review/A1');
    assert.equal(r.status, 200);
    assert.equal(t.calls[0].path, `/internal/review/audio-track/v1/${TID}`);
    assert.deepEqual(r.body.result.subject.track, { language: 'en', label: 'English', kind: 'dub' });
    assert.equal(r.body.result.subject.audioUrl, '/api/review/A1/audio');
    assert.equal(r.body.result.manifestKey, `review/v1/audio-${TID}-12345678/manifest.json`);
  });

  it('streams the track to reviewers only, with Range passed through', async () => {
    const t = audio();
    const res = await t.call('GET', '/api/review/A1/audio', { roles: 'user' });
    assert.equal(res.status, 403);
    const { reviewAudio } = await import('../src/lib/review/queue');
    const ok = await reviewAudio(t.env as never, { id: 'rev1', roles: ['content_reviewer'] }, 'A1', 'bytes=0-2');
    assert.equal(ok.status, 206);
    assert.equal(ok.headers.get('content-type'), 'audio/mp4');
    assert.equal(ok.headers.get('cache-control'), 'private, no-store');
    assert.equal(t.calls.at(-1)!.range, 'bytes=0-2');
    assert.equal(t.calls.at(-1)!.path, `/internal/review/audio-track/v1/${TID}/audio`);
  });

  it('reads only the track\'s own review media, never the video\'s', async () => {
    const t = audio();
    const { reviewMedia } = await import('../src/lib/review/queue');
    const reviewer = { id: 'rev1', roles: ['content_reviewer'] };
    assert.ok(await reviewMedia(t.env as never, reviewer, 'A1', `review/v1/audio-${TID}-12345678/audio/000.mp3`));
    await assert.rejects(reviewMedia(t.env as never, reviewer, 'A1', 'review/v1/rev/frames/000001.jpg'), /Not a file of this review/);
  });

  it('a decision goes to the track\'s decision route and can be undone', async () => {
    const t = audio();
    const r = await t.call('POST', '/api/review/A1/decision', { body: { decision: 'reject', reasonCode: 'hate' } });
    assert.equal(r.status, 200);
    const sent = t.calls.find((c) => c.method === 'POST')!;
    assert.equal(sent.path, `/internal/review/audio-track/v1/${TID}/decision`);
    assert.equal(sent.body.decision, 'reject');
    const undo = await t.call('POST', '/api/review/A1/decision', { body: { decision: 'undo' } });
    assert.equal(undo.status, 200);
  });

  it('retention purges the track\'s review media and leaves the video\'s', async () => {
    const t = audio();
    t.db.prepare('UPDATE content_reviews SET media_purge_after = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', 'A1').run();
    await purgeReviewMedia(t.env as never);
    assert.equal(t.env.REVIEW_MEDIA.files.has(`review/v1/audio-${TID}-12345678/audio/000.mp3`), false);
    assert.equal(t.env.REVIEW_MEDIA.files.has('review/v1/rev/manifest.json'), true);
  });
});

describe('an item under a takedown', () => {
  const taken = (t: ReturnType<typeof setup>, id: string, status: string, item: [string, string] | null, extra: { kind?: string; uploader?: string } = {}) =>
    t.db
      .prepare("INSERT INTO csam_cases (id, matched_url, url_key, source, status, item_kind, uploader_id, detected_at, created_by, created_at, updated_at, item_type, item_id) VALUES (?, 'u', ?, 'paste', ?, ?, ?, 'x', 'a', 'x', 'x', ?, ?)")
      .bind(id, id, status, extra.kind ?? null, extra.uploader ?? null, item?.[0] ?? null, item?.[1] ?? null)
      .run();
  const ids = async (t: ReturnType<typeof setup>, roles: string, path = '/api/review/queue') => (await t.call('GET', path, { roles })).body.result.items.map((r: any) => r.id).sort();

  it('is in the queue, its counts and its pages for super admins only', async () => {
    const t = setup();
    t.env.videos.set('v2', { id: 'v2', title: 'Other' });
    t.insert('gone');
    t.insert('gone_old', { status: 'rejected', decided_at: NOW, decision: 'reject', decided_by: 'rev1', undo_until: '2999-01-01' });
    t.insert('stays', { subject_id: 'v2' });
    await taken(t, 'c1', 'closed', ['video', 'v1']);
    for (const roles of ['content_reviewer', 'senior_reviewer', 'moderator', 'admin']) {
      assert.deepEqual(await ids(t, roles), ['stays'], roles);
      assert.deepEqual(await ids(t, roles, '/api/review/queue?tab=history'), [], roles);
      assert.equal((await t.call('GET', '/api/review/stats', { roles })).body.result.open.in_review, 1, roles);
      for (const [method, path, body] of [
        ['GET', 'gone'],
        ['GET', 'gone/media?key=review/v1/rev/manifest.json'],
        ['GET', 'gone/audio'],
        ['POST', 'gone/reveal', { target: 'item' }],
        ['POST', 'gone/claim', {}],
        ['POST', 'gone/decision', { decision: 'approve' }],
        ['POST', 'gone/decision', { decision: 'escalate' }],
        ['POST', 'gone_old/decision', { decision: 'undo' }],
      ] as Array<[string, string, unknown?]>) {
        const r = await t.call(method, `/api/review/${path}`, { roles, body });
        assert.deepEqual([r.status, r.body], [404, { success: false, code: 'not_found', error: 'Review not found' }], `${roles} ${method} ${path}`);
      }
    }
    assert.deepEqual(t.decisions, []);
    assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM moderation_actions').bind().first<{ n: number }>())!.n, 0);
    assert.deepEqual(await ids(t, 'super_admin'), ['gone', 'stays']);
    assert.equal((await t.call('GET', '/api/review/stats', { roles: 'super_admin' })).body.result.open.in_review, 2);
    assert.equal((await t.call('GET', '/api/review/gone', { roles: 'super_admin' })).body.result.subject.title, 'Talk');
  });

  it('is found by every kind of review', async () => {
    const t = setup();
    t.insert('track', { subject_type: 'audio_track', subject_id: 'v1:tabcdef1' });
    t.insert('stream', { subject_type: 'livestream', subject_id: 's1' });
    t.insert('post', { subject_type: 'post', subject_id: 'ch1/p1' });
    t.insert('avatar', { subject_type: 'avatar', subject_id: 'ch1' });
    t.insert('banner', { subject_type: 'banner', subject_id: 'ch1' });
    t.insert('picture', { subject_type: 'profile_picture', subject_id: 'u1' });
    t.insert('cover', { subject_type: 'profile_banner', subject_id: 'u1' });
    const others = { track: ['audio_track', 'v9:tabcdef1'], stream: ['livestream', 's9'], post: ['post', 'ch1/p9'], avatar: ['avatar', 'ch9'], picture: ['profile_picture', 'u9'] };
    for (const [id, [subject_type, subject_id]] of Object.entries(others)) t.insert(`other_${id}`, { subject_type, subject_id });
    const left = Object.keys(others).map((k) => `other_${k}`).sort();
    await taken(t, 'c1', 'contained', ['video', 'v1']);
    await taken(t, 'c2', 'contained', ['livestream', 's1']);
    await taken(t, 'c3', 'contained', ['post', 'p1']);
    await taken(t, 'c4', 'reported', ['channel', 'ch1']);
    await taken(t, 'c5', 'containing', null, { kind: 'profile_image', uploader: 'u1' });
    assert.deepEqual(await ids(t, 'admin'), left);
    // Once it is closed, a case about an image of a channel or an account hides the rest of it no more
    await t.db.prepare("UPDATE csam_cases SET status = 'closed'").bind().run();
    assert.deepEqual(await ids(t, 'admin'), [...left, 'avatar', 'banner', 'cover', 'picture'].sort());
  });

  it('reads its cases by an index', async () => {
    const t = setup();
    const { noCaseAboutReviewSql } = await import('../src/lib/csam');
    const plan = (await t.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM content_reviews r WHERE id = ? AND ${noCaseAboutReviewSql('r')}`).bind('x').all<{ detail: string }>()).results.map((p) => p.detail);
    assert.equal(plan.some((d) => /^SCAN/.test(d)), false, plan.join(' | '));
    assert.ok(plan.some((d) => /idx_csam_cases_item \(item_type=\? AND item_id=\?\)/.test(d)), plan.join(' | '));
  });
});
