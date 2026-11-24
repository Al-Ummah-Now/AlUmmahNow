/** Premieres (wiki E17 §5.4): the hold, scheduling, start, end, cancel, reschedule, swap, and everything that must not open the video early. */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches, middlewareFeatureRoutes, isVideoMediaPublic, isVideoOpenToAnyone, isVideoPubliclyVisible, studioVideoStatus, writeFeatureSwitch } from '@al-ummah/shared-types';
import { PremiereSwap, VideoPremiereCreate } from '../src/endpoints/live/premiere';
import { LiveStreamDelete, LiveStreamEnd, LiveStreamGet, LiveStreamIngestGet, LiveStreamStart, LiveStreamStateGet } from '../src/endpoints/live/liveSession';
import { LiveStreamUpdate } from '../src/endpoints/live/liveStreamUpdate';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { VideoChaptersGet } from '../src/endpoints/video/chapters';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { VideoScheduleCreate } from '../src/endpoints/video/scheduleCreate';
import { VideoSchedulePublishNow } from '../src/endpoints/video/schedulePublishNow';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { applyBulkChanges, revertFields } from '../src/lib/bulkEdit';
import { updateVideo } from '../src/lib/admin/service';
import { saveTier } from '../src/lib/creatorTiers';
import { heldForPremiere, runPremieres, startPremiere, swapPremiere } from '../src/lib/live/premieres';
import { desiredAccess } from '../src/lib/media/r2-delivery';
import { scheduleRefusal } from '../src/lib/videoSchedule';
import { withSearchSync } from '../src/lib/search/sync';
import { publishVideo } from '../../scheduler/src/publisher';
import { JobsQueue, MemoryBucket, MemoryQueue, buildApp, drainJobs, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;
const HOUR = 3_600_000;
beforeEach(() => forgetFeatureSwitches());

async function setup() {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const raw: Json = {
		SEARCH_DB: db, NOTIFICATIONS_DB: createSqliteD1(), ADMIN_JOBS_QUEUE: new JobsQueue(), queue: new MemoryQueue(), SCHEDULED_VIDEOS: new MemoryBucket(), global_settings: new MemoryBucket(),
	};
	for (const b of ['videos', 'channels', 'profiles', 'playlists', 'community_posts', 'subtitles']) raw[b] = new MemoryBucket();
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) }) as Json;
	const settle = async () => { while (pending.length) await pending.shift(); };
	await raw.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'owner', name: 'Channel', members: [{ userId: 'admin', role: 'admin' }, { userId: 'editor', role: 'editor' }] }));
	await saveTier(db as never, 'creator', { live: true }, 'test');
	db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('owner', 'creator', 'admin', 'test', '2026-11-01')").run();
	const flip = async (on: boolean) => {
		const row = db.db.prepare("SELECT version, enabled FROM feature_switches WHERE key = 'livePremieres'").get() as Json | undefined;
		await writeFeatureSwitch(env as never, { key: 'livePremieres', enabled: on, expectedVersion: row?.version ?? 0, actorId: 'usr_a', currentStored: !!row?.enabled });
	};
	await flip(true);
	const putVideo = (over: Json = {}) => env.videos.put(over.id ?? 'v1', JSON.stringify({ ...videoFixture(), id: 'v1', userId: 'owner', channelId: 'ch1', isPublic: false, uploadStatus: 'ready', duration: 600, width: 1920, height: 1080, title: 'Lecture', ...over }));
	await putVideo();
	const video = async (id = 'v1') => (await (await raw.videos.get(id))?.json()) as Json;
	const stream = async (id: string) => (await (await raw.videos.get(`livestream:${id}`))?.json()) as Json;
	const as = (userId: string | null) =>
		buildApp((r) => {
			r.post('/api/videos/:id/premiere', VideoPremiereCreate);
			r.get('/api/videos/:id/chapters', VideoChaptersGet);
			r.post('/api/videos/:id/schedule', VideoScheduleCreate);
			r.post('/api/videos/:id/publish-now', VideoSchedulePublishNow);
			r.put('/api/videos/:id', VideoUpdate);
			r.get('/api/videos/:id', VideoFetch);
			r.get('/api/live-streams', LiveStreamsList);
			r.patch('/api/live-streams/:id/premiere', PremiereSwap);
			r.patch('/api/live-streams/:id', LiveStreamUpdate);
			r.get('/api/live-streams/:id/state', LiveStreamStateGet);
			r.get('/api/live-streams/:id/ingest', LiveStreamIngestGet);
			r.get('/api/live-streams/:id', LiveStreamGet);
			r.post('/api/live-streams/:id/start', LiveStreamStart);
			r.post('/api/live-streams/:id/end', LiveStreamEnd);
			r.delete('/api/live-streams/:id', LiveStreamDelete);
		}, userId ? { userId } : null);
	const call = async (userId: string | null, method: string, path: string, body?: unknown) => {
		const res = await as(userId).request(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
		await settle();
		return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
	};
	const at = (ms = HOUR) => new Date(Date.now() + ms).toISOString();
	const schedule = async (userId = 'owner', body: Json = {}, id = 'v1') => call(userId, 'POST', `videos/${id}/premiere`, { scheduledStartTime: at(), ...body });
	const made = async (body: Json = {}) => (await schedule('owner', body)).json.result.stream as Json;
	const tick = async (now: number) => { const r = await runPremieres(env as never, now); await settle(); return r; };
	const fanouts = () => raw.queue.messages.filter((m: Json) => m.payload?.kind === 'live_started' || m.payload?.kind === 'new_video').map((m: Json) => [m.payload.kind, m.payload.entityId]);
	return { db, raw, env, settle, putVideo, video, stream, call, schedule, made, at, tick, fanouts, flip };
}

describe('scheduling', () => {
	it('holds the video and nothing else about it changes', async () => {
		const t = await setup();
		await t.putVideo({ isDraft: true });
		const before = await t.video();
		const s = await t.made({ title: 'Opening night', slowModeSeconds: 10 });
		assert.deepEqual([s.kind, s.status, s.premiereVideoId, s.durationSeconds, s.title, s.slowModeSeconds, s.userId, s.channelId], ['premiere', 'scheduled', 'v1', 600, 'Opening night', 10, 'owner', 'ch1']);
		const { premiereHold, dateModified: _a, ...held } = await t.video();
		const { dateModified: _b, ...original } = before;
		assert.deepEqual(held, original);
		assert.equal(premiereHold.streamId, s.id);
		const row = t.db.db.prepare('SELECT kind, status, premiere_video_id, duration_seconds, visibility FROM live_stream_metadata WHERE stream_id = ?').get(s.id);
		assert.deepEqual({ ...(row as Json) }, { kind: 'premiere', status: 'scheduled', premiere_video_id: 'v1', duration_seconds: 600, visibility: 'public' });
		assert.equal(t.db.count('live_sessions'), 0);
		assert.equal(studioVideoStatus(await t.video()), 'scheduled');
	});

	it('refuses what cannot be a premiere', async () => {
		for (const [over, status, code] of [
			[{ channelId: undefined }, 404, 'video_not_found'],
			[{ width: 1080, height: 1920, duration: 30 }, 400, 'premiere_video_unsuitable'],
			[{ duration: 0 }, 400, 'premiere_video_unsuitable'],
			[{ uploadStatus: 'processing' }, 409, 'premiere_video_not_ready'],
			[{ review: { status: 'checking' } }, 409, 'premiere_video_not_ready'],
			[{ review: { status: 'in_review' } }, 409, 'premiere_video_not_ready'],
			[{ review: { status: 'rejected' } }, 409, 'premiere_video_not_ready'],
			[{ isHidden: true }, 409, 'premiere_video_not_ready'],
			[{ isPublic: true }, 409, 'premiere_video_already_open'],
			[{ isUnlisted: true }, 409, 'premiere_video_already_open'],
			[{ scheduledPublishStatus: 'scheduled', scheduledPublishDate: '2027-01-01T00:00:00Z' }, 409, 'premiere_video_scheduled'],
		] as const) {
			const t = await setup();
			await t.putVideo(over as Json);
			const r = await t.schedule();
			if (over && 'channelId' in over) { assert.ok([400, 404].includes(r.status), JSON.stringify(r)); continue; }
			assert.deepEqual([r.status, r.json.code], [status, code], JSON.stringify(over));
			assert.equal((await t.video()).premiereHold, undefined);
		}
		const t = await setup();
		for (const scheduledStartTime of [t.at(60_000), t.at(366 * 24 * HOUR), 'soon']) assert.equal((await t.schedule('owner', { scheduledStartTime })).json.code, 'premiere_bad_time');
		await t.schedule();
		assert.equal((await t.schedule()).json.code, 'premiere_exists');
	});

	it('is for who may schedule the video and run live on its channel, in a tier with premieres', async () => {
		const t = await setup();
		for (const user of ['stranger', 'editor']) assert.equal((await t.schedule(user)).status, 404, user);
		assert.equal((await t.schedule('admin')).status, 200);
		const u = await setup();
		await saveTier(u.db as never, 'creator', { livePremieres: false }, 'test');
		assert.deepEqual([(await u.schedule()).json.code], ['feature_off']);
	});

	it('two requests at once make one premiere', async () => {
		const t = await setup();
		const results = await Promise.all([t.schedule(), t.schedule(), t.schedule()]);
		assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
		assert.equal(t.db.count('live_stream_metadata'), 1);
	});

	it('a failed stream write takes the hold off', async () => {
		const t = await setup();
		const { createPremiere } = await import('../src/lib/live/premieres');
		const broken = { ...t.env, videos: new Proxy(t.env.videos, { get: (target, p) => (p === 'put' ? async (k: string, ...a: unknown[]) => { if (k.startsWith('livestream:')) throw new Error('R2 down'); return target.put(k, ...a); } : typeof target[p] === 'function' ? target[p].bind(target) : target[p]) }) };
		await assert.rejects(createPremiere(broken as never, { video: (await t.video()) as never, scheduledStartTime: t.at(), actorId: 'owner', fields: {} }));
		assert.equal((await t.video()).premiereHold, undefined);
	});
});

describe('closed until the start', () => {
	it('for every rule and surface', async () => {
		const t = await setup();
		await t.putVideo({ description: '0:00 Start\n1:00 Middle\n2:00 End' });
		const s = await t.made();
		// Even if something made it public meanwhile
		const held = { ...(await t.video()), isPublic: true };
		for (const rule of [isVideoOpenToAnyone, isVideoPubliclyVisible, isVideoMediaPublic]) assert.equal(rule(held as never), false, rule.name);
		assert.equal(desiredAccess(held as never), 'priv');
		for (const path of ['videos/v1', 'videos/v1/chapters']) {
			for (const user of [null, 'stranger']) assert.equal((await t.call(user, 'GET', path)).status, 404, `${path} ${user}`);
		}
		assert.equal((await t.call('owner', 'GET', 'videos/v1/chapters')).status, 200);
		assert.equal(t.db.db.prepare("SELECT COUNT(*) AS n FROM search_videos WHERE id = 'v1'").get()!.n, 0);
		// Which video it is is not told either
		for (const path of [`live-streams/${s.id}`, `live-streams/${s.id}/state`]) {
			const viewer = await t.call('stranger', 'GET', path);
			assert.equal(viewer.status, 200);
			assert.ok(!JSON.stringify(viewer.json).includes('"v1"'), path);
			assert.ok(JSON.stringify((await t.call('owner', 'GET', path)).json).includes('"v1"'), path);
		}
		assert.ok(!JSON.stringify((await t.call('stranger', 'GET', 'live-streams?status=scheduled')).json).includes('"v1"'));
	});

	it('nothing else opens it: schedule, publish now, edits, bulk edits, admin edits, an old schedule entry', async () => {
		const t = await setup();
		await t.made();
		assert.equal((await t.call('owner', 'POST', 'videos/v1/publish-now')).json.code, 'premiere_scheduled');
		assert.equal((await t.call('owner', 'POST', 'videos/v1/schedule', { scheduledPublishDate: t.at(), timezone: 'UTC' })).status, 409);
		for (const body of [{ isPublic: true }, { visibility: 'unlisted' }, { isUnlisted: true }]) assert.equal((await t.call('owner', 'PUT', 'videos/v1', body)).json.code, 'premiere_scheduled', JSON.stringify(body));
		const v = await t.video();
		assert.equal(scheduleRefusal(v as never), 'Waiting for its premiere');
		assert.deepEqual(applyBulkChanges(v as never, { visibility: 'public' } as never, 'now'), { ok: false, error: 'scheduled' });
		await assert.rejects(updateVideo(t.env as never, 'v1', { isPublic: true }), /premiere_scheduled/);
		assert.equal(await publishVideo(t.raw.videos, { videoId: 'v1', scheduledPublishDate: '2020-01-01T00:00:00Z' } as never), 'cancelled');
		assert.equal((await t.video()).isPublic, false);
		// Undoing an older bulk edit does not bring back an older visibility
		const undone = revertFields(v as never, { isPublic: true, isUnlisted: true, isDraft: false, title: 'Old title' } as never, { isPublic: v.isPublic, isUnlisted: v.isUnlisted, isDraft: v.isDraft, title: v.title } as never, 'now');
		assert.deepEqual([undone.restored, undone.kept], [['title'], ['isPublic', 'isUnlisted', 'isDraft']]);
		assert.deepEqual([(undone.video as Json).isPublic, (undone.video as Json).isUnlisted], [false, undefined]);
		// Its texts can be edited
		assert.equal((await t.call('owner', 'PUT', 'videos/v1', { title: 'New title' })).status, 200);
		assert.deepEqual([(await t.video()).title, !!(await t.video()).premiereHold], ['New title', true]);
	});
});

describe('start and end', () => {
	it('starts at its time, once: the video is public, subscribers hear of one thing', async () => {
		const t = await setup();
		await t.putVideo({ isDraft: true });
		const s = await t.made();
		const start = Date.parse(s.scheduledStartTime);
		assert.deepEqual(await t.tick(start - 1), { started: 0, ended: 0, cancelled: 0, failed: 0 });
		assert.equal((await t.tick(start + 1000)).started, 1);
		const v = await t.video();
		assert.deepEqual([v.premiereHold, v.isPublic, v.isDraft, v.publishedAt], [undefined, true, false, new Date(start + 1000).toISOString()]);
		assert.ok(isVideoPubliclyVisible(v as never));
		assert.equal(desiredAccess(v as never), 'pub');
		assert.equal(t.db.db.prepare("SELECT COUNT(*) AS n FROM search_videos WHERE id = 'v1'").get()!.n, 1);
		assert.equal(t.db.db.prepare('SELECT status FROM live_stream_metadata').get()!.status, 'live');
		assert.deepEqual(t.fanouts(), [['live_started', s.id]]);
		const state = (await t.call('stranger', 'GET', `live-streams/${s.id}/state`)).json.result;
		assert.deepEqual([state.kind, state.status, state.premiereVideoId, state.durationSeconds, state.startedAt, state.playbackUrl], ['premiere', 'live', 'v1', 600, new Date(start + 1000).toISOString(), null]);
		assert.ok(typeof state.serverNow === 'number');
		assert.deepEqual(await t.tick(start + 60_000), { started: 0, ended: 0, cancelled: 0, failed: 0 });
		assert.equal((await t.tick(start + 1000 + 600_000)).ended, 1);
		const after = await t.stream(s.id);
		assert.deepEqual([after.status, after.vodUrl, after.review], ['ended', undefined, undefined]);
		assert.equal(t.db.count('live_sessions'), 0);
		assert.equal((await t.tick(start + 2_000_000)).ended, 0);
	});

	it('two crons at the same moment start it once', async () => {
		const t = await setup();
		const s = await t.made();
		const at = Date.parse(s.scheduledStartTime) + 1;
		const outcomes = await Promise.all([1, 2, 3, 4].map(() => startPremiere(t.env as never, s.id, { now: at })));
		await t.settle();
		assert.equal(outcomes.filter((o) => o === 'started').length, 1);
		assert.equal(t.fanouts().length, 1);
	});

	it('a start cut short after its claim is finished by the next minute', async () => {
		const t = await setup();
		const s = await t.made();
		const at = Date.parse(s.scheduledStartTime);
		const record = await t.stream(s.id);
		await t.env.videos.put(`livestream:${s.id}`, JSON.stringify({ ...record, status: 'live', actualStartTime: new Date(at).toISOString() }));
		assert.equal(isVideoOpenToAnyone((await t.video()) as never), false);
		await t.tick(at + 60_000);
		assert.equal((await t.video()).isPublic, true);
		assert.deepEqual(t.fanouts(), [['live_started', s.id]]);
	});

	it('a start cut short before anyone was told is announced by the next minute, once', async () => {
		const t = await setup();
		const s = await t.made();
		const at = Date.parse(s.scheduledStartTime);
		const send = t.raw.queue.send;
		t.raw.queue.send = async () => { throw new Error('queue down'); };
		assert.equal((await t.tick(at)).started, 1);
		assert.deepEqual([(await t.video()).isPublic, (await t.stream(s.id)).announcedAt, t.fanouts().length], [true, undefined, 0]);
		t.raw.queue.send = send;
		await t.tick(at + 60_000);
		assert.deepEqual(t.fanouts(), [['live_started', s.id]]);
		await t.tick(at + 120_000);
		assert.equal(t.fanouts().length, 1);
	});

	it('its owner may start it early and end it; nobody streams into it', async () => {
		const t = await setup();
		const s = await t.made();
		assert.equal((await t.call('owner', 'GET', `live-streams/${s.id}/ingest`)).json.code, 'premiere_no_ingest');
		assert.equal((await t.call('owner', 'POST', `live-streams/${s.id}/end`)).json.code, 'premiere_fixed');
		assert.equal((await t.call('stranger', 'POST', `live-streams/${s.id}/start`)).status, 403);
		assert.equal((await t.call('owner', 'POST', `live-streams/${s.id}/start`)).status, 200);
		assert.equal((await t.stream(s.id)).status, 'live');
		assert.equal((await t.call('owner', 'POST', `live-streams/${s.id}/start`)).json.code, 'premiere_started');
		assert.equal((await t.call('owner', 'POST', `live-streams/${s.id}/end`)).status, 200);
		assert.equal((await t.stream(s.id)).status, 'ended');
		assert.equal(t.db.count('live_sessions'), 0);
	});

	it('the start route answers to the switch of what it starts', async () => {
		const t = await setup();
		const s = await t.made();
		const set = async (key: 'live' | 'livePremieres', on: boolean) => {
			const row = t.db.db.prepare('SELECT version FROM feature_switches WHERE key = ?').get(key) as Json | undefined;
			await writeFeatureSwitch(t.env as never, { key, enabled: on, expectedVersion: row?.version ?? 0, actorId: 'usr_a', currentStored: true });
		};
		await t.env.videos.put('livestream:s1', JSON.stringify({ id: 's1', userId: 'owner', channelId: 'ch1', title: 'Talk', status: 'scheduled' }));
		await set('live', false);
		assert.deepEqual([(await t.call('owner', 'POST', 'live-streams/s1/start')).json.code], ['feature_off']);
		await set('livePremieres', false);
		assert.deepEqual([(await t.call('owner', 'POST', `live-streams/${s.id}/start`)).json.code], ['feature_off']);
		await set('livePremieres', true);
		assert.equal((await t.call('owner', 'POST', `live-streams/${s.id}/start`)).status, 200, 'live is off, premieres are on');
		assert.equal(middlewareFeatureRoutes('api-videos').some((r) => r.path === '/api/live-streams/:id/start'), false);
	});

	it('the start route refuses while the switches cannot be read', async () => {
		const t = await setup();
		const s = await t.made();
		const db = t.env.SEARCH_DB;
		forgetFeatureSwitches();
		t.env.SEARCH_DB = new Proxy(db, { get: (target, p) => (p === 'prepare' ? (sql: string) => { if (sql.includes('feature_switches')) throw new Error('D1 down'); return target.prepare(sql); } : (target as any)[p]?.bind?.(target) ?? (target as any)[p]) });
		assert.equal((await t.call('owner', 'POST', `live-streams/${s.id}/start`)).json.code, 'feature_off');
		assert.equal((await t.call('stranger', 'GET', `live-streams/${s.id}`)).status, 404);
		t.env.SEARCH_DB = db;
		assert.equal((await t.stream(s.id)).status, 'scheduled');
	});

	it('while premieres are off a scheduled one is its team’s only', async () => {
		const t = await setup();
		const s = await t.made();
		const seen = async (user: string | null) => [
			(await t.call(user, 'GET', `live-streams/${s.id}`)).status,
			(await t.call(user, 'GET', `live-streams/${s.id}/state`)).status,
			(await t.call(user, 'GET', 'live-streams?status=scheduled')).json.result.data.length,
		];
		assert.deepEqual(await seen('stranger'), [200, 200, 1]);
		await t.flip(false);
		forgetFeatureSwitches();
		for (const user of [null, 'stranger']) assert.deepEqual(await seen(user), [404, 404, 0]);
		assert.deepEqual(await seen('owner'), [200, 200, 1]);
	});

	it('waits for a video that is not ready, or the switch, up to an hour; then is cancelled', async () => {
		for (const block of ['review', 'switch', 'hold', 'tier'] as const) {
			const t = await setup();
			const s = await t.made();
			const at = Date.parse(s.scheduledStartTime);
			if (block === 'review') await t.env.videos.put('v1', JSON.stringify({ ...(await t.video()), review: { status: 'in_review' } }));
			if (block === 'switch') await t.flip(false);
			if (block === 'hold') await t.env.videos.put(`livestream:${s.id}`, JSON.stringify({ ...(await t.stream(s.id)), suspensionHolds: ['channel'], isHidden: true }));
			if (block === 'tier') await saveTier(t.db as never, 'creator', { livePremieres: false }, 'test');
			forgetFeatureSwitches();
			assert.deepEqual(await t.tick(at + 59 * 60_000), { started: 0, ended: 0, cancelled: 0, failed: 0 }, block);
			assert.equal(isVideoOpenToAnyone((await t.video()) as never), false, block);
			assert.equal((await t.tick(at + 61 * 60_000)).cancelled, 1, block);
			assert.deepEqual([(await t.stream(s.id)).status, (await t.stream(s.id)).cancelReason, (await t.video()).premiereHold, (await t.video()).isPublic], ['cancelled', 'missed', undefined, false], block);
		}
	});

	it('a removed, rejected or moved video cancels it', async () => {
		for (const over of [{ review: { status: 'rejected' } }, { channelId: 'ch2' }]) {
			const t = await setup();
			const s = await t.made();
			await t.raw.videos.put('v1', JSON.stringify({ ...(await t.video()), ...over }));
			assert.equal((await t.tick(Date.parse(s.scheduledStartTime) + 1)).cancelled, 1, JSON.stringify(over));
			assert.equal((await t.stream(s.id)).cancelReason, 'video_unavailable');
			assert.equal((await t.video()).isPublic, false);
		}
		// Through api-videos, at once
		const t = await setup();
		const s = await t.made();
		await t.env.videos.put('v1', JSON.stringify({ ...(await t.video()), isDeleted: true }));
		await t.settle();
		assert.deepEqual([(await t.stream(s.id)).status, (await t.video()).premiereHold], ['cancelled', undefined]);
		assert.equal(t.db.db.prepare('SELECT status FROM live_stream_metadata').get()!.status, 'cancelled');
	});

	it('ends when its video is taken away while it runs', async () => {
		const t = await setup();
		const s = await t.made();
		const at = Date.parse(s.scheduledStartTime);
		await t.tick(at);
		await t.env.videos.put('v1', JSON.stringify({ ...(await t.video()), isPublic: false }));
		assert.equal((await t.tick(at + 60_000)).ended, 1);
	});

	it('one broken record does not stop the others', async () => {
		const t = await setup();
		const s = await t.made();
		const get = t.env.videos.get;
		t.env.videos = new Proxy(t.env.videos, { get: (target, p) => (p === 'get' ? async (k: string) => { if (k === 'livestream:bad') throw new Error('R2 down'); return get.call(target, k); } : typeof (target as any)[p] === 'function' ? (target as any)[p].bind(target) : (target as any)[p]) });
		t.db.db.prepare("INSERT INTO live_stream_metadata (stream_id, kind, status, scheduled_start_at) VALUES ('bad', 'premiere', 'scheduled', 1)").run();
		const r = await t.tick(Date.parse(s.scheduledStartTime));
		assert.deepEqual([r.started, r.failed], [1, 1]);
	});
});

describe('cancel, reschedule, swap', () => {
	it('cancelling or deleting leaves the video exactly as it was', async () => {
		for (const how of ['patch', 'delete'] as const) {
			const t = await setup();
			await t.putVideo({ isDraft: true });
			const { dateModified: _a, ...before } = await t.video();
			const s = await t.made();
			const r = how === 'patch' ? await t.call('owner', 'PATCH', `live-streams/${s.id}`, { status: 'cancelled' }) : await t.call('owner', 'DELETE', `live-streams/${s.id}`);
			assert.equal(r.status, 200, how);
			const { dateModified: _b, ...after } = await t.video();
			assert.deepEqual(after, before, how);
			assert.equal((await t.tick(Date.parse(s.scheduledStartTime) + 1)).started, 0);
			if (how === 'patch') assert.equal((await t.schedule()).status, 200, 'it can be a premiere again');
		}
	});

	it('a running premiere is not deleted; an ended or cancelled one is, and its video stays as it is', async () => {
		const t = await setup();
		const s = await t.made();
		await t.tick(Date.parse(s.scheduledStartTime));
		assert.equal((await t.call('owner', 'DELETE', `live-streams/${s.id}`)).json.code, 'premiere_started');
		assert.ok(await t.stream(s.id));
		await t.call('owner', 'POST', `live-streams/${s.id}/end`);
		assert.equal((await t.call('owner', 'DELETE', `live-streams/${s.id}`)).status, 200);
		assert.deepEqual([await t.stream(s.id), (await t.video()).isPublic], [undefined, true]);
		const u = await setup();
		const p = await u.made();
		await u.call('owner', 'PATCH', `live-streams/${p.id}`, { status: 'cancelled' });
		// Not told to others: the video is private again
		assert.ok(!JSON.stringify((await u.call('stranger', 'GET', `live-streams/${p.id}`)).json).includes('"v1"'));
		assert.equal((await u.call('owner', 'DELETE', `live-streams/${p.id}`)).status, 200);
		assert.equal((await u.video()).isPublic, false);
	});

	it('a write that slipped past the guards does not open the video when the premiere is cancelled', async () => {
		const t = await setup();
		await t.putVideo({ isDraft: true });
		const s = await t.made();
		await t.raw.videos.put('v1', JSON.stringify({ ...(await t.video()), isPublic: true, isUnlisted: true, isDraft: false }));
		await t.call('owner', 'PATCH', `live-streams/${s.id}`, { status: 'cancelled' });
		const v = await t.video();
		assert.deepEqual([v.isPublic, v.isUnlisted, v.isDraft, v.premiereHold], [false, undefined, true, undefined]);
		assert.equal(isVideoOpenToAnyone(v as never), false);
	});

	it('cancelling against the start: one of them wins, and the video follows', async () => {
		const t = await setup();
		const s = await t.made();
		const at = Date.parse(s.scheduledStartTime);
		await t.tick(at);
		assert.equal((await t.call('owner', 'PATCH', `live-streams/${s.id}`, { status: 'cancelled' })).json.code, 'premiere_started');
		assert.deepEqual([(await t.stream(s.id)).status, (await t.video()).isPublic], ['live', true]);
		const u = await setup();
		const p = await u.made();
		await u.call('owner', 'PATCH', `live-streams/${p.id}`, { status: 'cancelled' });
		assert.equal(await startPremiere(u.env as never, p.id, { now: Date.parse(p.scheduledStartTime) }), 'not_due');
		assert.equal((await u.video()).isPublic, false);
	});

	it('rescheduling moves only the stream; the old time passes quietly', async () => {
		const t = await setup();
		const s = await t.made();
		assert.equal((await t.call('owner', 'PATCH', `live-streams/${s.id}`, { scheduledStartTime: t.at(60_000) })).json.code, 'premiere_bad_time');
		assert.equal((await t.call('owner', 'PATCH', `live-streams/${s.id}`, { status: 'cancelled', scheduledStartTime: t.at(5 * HOUR) })).json.code, 'premiere_fixed');
		assert.equal((await t.stream(s.id)).status, 'scheduled');
		assert.equal((await t.call('owner', 'PATCH', `live-streams/${s.id}`, { scheduledStartTime: t.at(5 * HOUR) })).status, 200);
		assert.equal((await t.tick(Date.parse(s.scheduledStartTime) + 1)).started, 0);
		assert.equal((await t.tick(Date.now() + 5 * HOUR + 1000)).started, 1);
		assert.equal((await t.call('owner', 'PATCH', `live-streams/${s.id}`, { scheduledStartTime: t.at(9 * HOUR) })).json.code, 'premiere_started');
		for (const body of [{ status: 'live' }, { status: 'ended' }, { status: 'scheduled' }, { isPrivate: true }]) assert.equal((await t.call('owner', 'PATCH', `live-streams/${s.id}`, body)).json.code, 'premiere_fixed', JSON.stringify(body));
	});

	it('swapping holds the new video and frees the old one; refused once started', async () => {
		const t = await setup();
		await t.putVideo({ id: 'v2', duration: 900 });
		await t.putVideo({ id: 'open', isPublic: true });
		const s = await t.made();
		assert.equal((await t.call('owner', 'PATCH', `live-streams/${s.id}/premiere`, { videoId: 'open' })).json.code, 'premiere_video_already_open');
		const r = await t.call('owner', 'PATCH', `live-streams/${s.id}/premiere`, { videoId: 'v2' });
		assert.deepEqual([r.status, r.json.result.stream.premiereVideoId, r.json.result.stream.durationSeconds], [200, 'v2', 900]);
		assert.deepEqual([(await t.video('v1')).premiereHold, (await t.video('v2')).premiereHold.streamId], [undefined, s.id]);
		await t.tick(Date.parse(s.scheduledStartTime));
		assert.deepEqual([(await t.video('v1')).isPublic, (await t.video('v2')).isPublic], [false, true]);
		await t.putVideo({ id: 'v3' });
		const late = await swapPremiere(t.env as never, { ...(s as never), premiereVideoId: 'v2' }, (await t.video('v3')) as never, 'owner');
		assert.deepEqual(late, { problem: 'premiere_started' });
		assert.equal((await t.video('v3')).premiereHold, undefined);
	});

	it('a hold whose premiere is gone lets go, after ten minutes; a fresh one does not', async () => {
		const t = await setup();
		const hold = (minutes: number) => t.putVideo({ premiereHold: { streamId: 'gone', heldAt: new Date(Date.now() - minutes * 60_000).toISOString(), heldBy: 'owner' } });
		await hold(1);
		assert.equal(await heldForPremiere(t.env as never, (await t.video()) as never), true);
		await hold(11);
		assert.equal((await t.call('owner', 'POST', 'videos/v1/publish-now')).status, 200);
		assert.equal((await t.video()).isPublic, true);
		await t.putVideo({ premiereHold: { streamId: 'gone', heldAt: '2026-01-01T00:00:00Z', heldBy: 'owner' } });
		assert.equal((await t.schedule()).status, 200);
	});

	it('a stream record lost another way frees the video when it is purged', async () => {
		const t = await setup();
		const s = await t.made();
		await t.env.videos.delete(`livestream:${s.id}`);
		await t.settle();
		const jobEnv = withSearchSync(t.raw, { waitUntil: () => undefined });
		await drainJobs(jobEnv as never);
		assert.equal((await t.video()).premiereHold, undefined);
	});

	it('a video marked as made for kids by its source makes the premiere so', async () => {
		const t = await setup();
		await t.putVideo({ importedFrom: { kind: 'youtube', madeForKids: true } });
		assert.equal((await t.made()).madeForKids, true);
	});

	it('so does its owner’s own choice, which wins over what the source said', async () => {
		const own = await setup();
		await own.putVideo({ madeForKids: true });
		assert.equal((await own.made()).madeForKids, true);
		const cleared = await setup();
		await cleared.putVideo({ madeForKids: false, importedFrom: { kind: 'youtube', madeForKids: true } });
		assert.ok(!(await cleared.made()).madeForKids);
	});
});

it('the cron’s queries use the premiere index', async () => {
	const t = await setup();
	t.db.trace = [];
	await t.tick(Date.now());
	for (const q of t.db.trace.filter((x) => x.sql.includes("kind = 'premiere'"))) {
		const plan = t.db.plan(q).join(' ; ');
		assert.match(plan, /SEARCH live_stream_metadata USING (COVERING )?INDEX idx_live_stream_meta_premiere_due/, plan);
	}
});
