/**
 * Wrong-shape thumbnails can't come in again, from any path (owner,
 * 2026-11-10: "just don't let it happen in future"), and the daily check keeps
 * flagging the ones that do for the admin Errors page.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
	absoluteImageUrl,
	aspectMismatch,
	checkThumbnailShape,
	isBunnyFrameOf,
	isLetterboxedArt,
	resolveVideoSize,
	videoSizeOf,
	isOnHost,
	isOwnImageHost,
} from '../src/lib/thumbnail/shape';
import {
	DAILY_CHECK_ACTOR,
	isStillFlagged,
	latestFlagged,
	planThumbnailRepair,
	repairVideoThumbnail,
	startDailyThumbnailCheck,
	THUMBNAIL_REPAIR_TARGET,
	verifyThumbnailUrl,
} from '../src/lib/thumbnail/repair';
import { createUploadRecord } from '../src/lib/upload/uploadRecord';
import { VideoThumbnailUpload } from '../src/endpoints/video/videoThumbnailUpload';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { UploadInitiateEndpoint } from '../src/endpoints/video/uploadInitiate';
import { createProcessingInternalRouter } from '../src/endpoints/video/processingInternal';
import adminRouter from '../src/routers/admin.router';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const HOST = 'vz-215a1ffd-a5a.b-cdn.net';
const ID = 'ae7a1f33-da52-40ce-b74c-4b970cc5635c';
const OWNER = 'owner';

function jpeg(width: number, height: number): Uint8Array {
	const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
	// Padded past the validator's minimum file size
	return new Uint8Array([0xff, 0xd8, ...sof, 0xff, 0xda, 0x00, 0x02, ...new Array(2048).fill(0)]);
}
const dataUrl = (bytes: Uint8Array) => `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;

/** URL (no query) → image bytes or status; Bunny API by id; storage PUTs recorded. */
let images: Record<string, Uint8Array | number> = {};
let bunnyVideos: Record<string, unknown> = {};
let stored: string[] = [];
let fetched: { url: string; redirect?: RequestRedirect }[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
	images = {};
	bunnyVideos = {};
	stored = [];
	fetched = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		fetched.push({ url, redirect: init?.redirect });
		if (url.startsWith('https://video.bunnycdn.com/')) {
			if (method === 'POST') return new Response(JSON.stringify({ guid: ID, status: 0 }), { status: 200 });
			const body = bunnyVideos[url.split('/videos/')[1]];
			return new Response(body ? JSON.stringify(body) : null, { status: body ? 200 : 404 });
		}
		const host = new URL(url).hostname;
		if (method === 'PUT' && (host === 'storage.bunnycdn.com' || host.endsWith('.storage.bunnycdn.com'))) {
			stored.push(url);
			return new Response(null, { status: 201 });
		}
		const image = images[decodeURI(url.split('?')[0])];
		if (typeof image === 'number') return new Response(null, { status: image });
		if (!image) return new Response(null, { status: 404 });
		return new Response(image, { status: 206 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function baseEnv(seed: Record<string, unknown> = {}) {
	return {
		videos: new MemoryBucket(seed),
		channels: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new MemoryQueue(),
		TUS_SESSIONS: { get: async () => null, put: async () => undefined, delete: async () => undefined },
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '7',
		bunny_hostname: HOST,
		image_storage_key: 'storage-key',
		ZONE: 'zone',
	} as any;
}

describe('shape rules', () => {
	it('5% tolerance, symmetric; odd encodes pass, a squashed frame does not', () => {
		assert.equal(aspectMismatch({ width: 1280, height: 696 }, { width: 1280, height: 720 }), false);
		assert.equal(aspectMismatch({ width: 1280, height: 720 }, { width: 720, height: 1280 }), true);
		assert.equal(aspectMismatch({ width: 720, height: 1280 }, { width: 1280, height: 720 }), true);
	});

	it('refuses an image of another shape with the expected size, passes unknown video sizes', () => {
		const verdict = checkThumbnailShape({ width: 1280, height: 720 }, { width: 720, height: 1280 });
		assert.equal(verdict.ok, false);
		assert.equal(verdict.code, 'thumbnail_shape');
		assert.deepEqual(verdict.expected, { width: 720, height: 1280 });
		assert.equal(checkThumbnailShape({ width: 1280, height: 720 }, null).ok, true);
		assert.equal(checkThumbnailShape(null, { width: 1, height: 1 }).ok, true);
	});

	it('old 4:3 YouTube art on a landscape video is letterboxed art, not on a vertical one', () => {
		assert.equal(isLetterboxedArt({ width: 480, height: 360 }, { width: 1920, height: 1080 }), true);
		assert.equal(isLetterboxedArt({ width: 640, height: 480 }, { width: 720, height: 1280 }), false);
		assert.equal(isLetterboxedArt({ width: 640, height: 480 }, { width: 1440, height: 1440 }), false);
	});

	it('reads imported addresses without a scheme as https', () => {
		assert.equal(absoluteImageUrl('images.alummahnow.net/خطبة الجمعة.jpg'), 'https://images.alummahnow.net/%D8%AE%D8%B7%D8%A8%D8%A9%20%D8%A7%D9%84%D8%AC%D9%85%D8%B9%D8%A9.jpg');
		assert.equal(absoluteImageUrl('//cdn.example/x.jpg'), 'https://cdn.example/x.jpg');
		assert.equal(absoluteImageUrl('https://a.example/x.jpg'), 'https://a.example/x.jpg');
		assert.equal(absoluteImageUrl(''), null);
		assert.equal(absoluteImageUrl('javascript://x'), null);
	});

	it('knows the video size from the record, else Bunny; Bunny frames of the video itself', async () => {
		assert.deepEqual(videoSizeOf({ width: 720, height: 1280 }), { width: 720, height: 1280 });
		assert.equal(videoSizeOf({ width: 0, height: 1280 }), null);
		assert.deepEqual(await resolveVideoSize({}, async () => ({ width: 1080, height: 1080 })), { width: 1080, height: 1080 });
		assert.equal(await resolveVideoSize({}, async () => { throw new Error('down'); }), null);
		assert.equal(isBunnyFrameOf(`https://${HOST}/${ID}/thumbnail_3.jpg`, ID, HOST), true);
		assert.equal(isBunnyFrameOf(`https://${HOST}/${ID}/thumbnail.jpg`, ID, HOST), true);
		assert.equal(isBunnyFrameOf(`https://${HOST}/other/thumbnail.jpg`, ID, HOST), false);
		assert.equal(isBunnyFrameOf(`https://evil.example/${ID}/thumbnail.jpg`, ID, HOST), false);
	});
});

describe('the check: legacy and custom thumbnails are flag-only', () => {
	const vertical = { width: 720, height: 1280 };
	it('an imported thumbnail (no type) of the wrong shape is flagged, never replaced', () => {
		const plan = planThumbnailRepair({ thumbnailUrl: 'images.alummahnow.net/x.jpg', video: vertical, thumbnail: { width: 1280, height: 720 } });
		assert.equal(plan.action, 'flag');
		assert.match(plan.reason, /imported thumbnail/);
	});
	it('old 4:3 art on a 16:9 video counts as matching', () => {
		assert.equal(planThumbnailRepair({ thumbnailUrl: 'u', video: { width: 1280, height: 720 }, thumbnail: { width: 480, height: 360 } }).action, 'none');
	});

	it('reads an imported address without a scheme and flags it (the 32 legacy videos show for the owner)', async () => {
		const legacyUrl = 'images.alummahnow.net/الموقف الصحيح.jpg';
		const env = baseEnv({ [ID]: videoFixture({ id: ID, thumbnailUrl: legacyUrl, width: 720, height: 1280 }) });
		images['https://images.alummahnow.net/الموقف الصحيح.jpg'] = jpeg(1280, 720);
		images[`https://${HOST}/${ID}/thumbnail.jpg`] = jpeg(720, 1280);
		bunnyVideos[ID] = { guid: ID, width: 720, height: 1280 };
		const result = await repairVideoThumbnail(env, ID, { runId: 'daily-1', dryRun: false });
		assert.equal(result.outcome, 'flagged');
		const saved = env.videos.read(ID);
		assert.equal(saved.thumbnailUrl, legacyUrl, 'Fix never replaces a legacy thumbnail');
		assert.equal(saved.thumbnailCheck.outcome, 'flagged');
	});

	it('a daily re-check that finds the same thing writes nothing', async () => {
		const env = baseEnv({ [ID]: videoFixture({ id: ID, thumbnailUrl: `https://${HOST}/${ID}/thumbnail.jpg`, thumbnailType: 'auto', width: 720, height: 1280 }) });
		images[`https://${HOST}/${ID}/thumbnail.jpg`] = jpeg(720, 1280);
		await repairVideoThumbnail(env, ID, { runId: 'day-1', dryRun: false });
		const first = env.videos.read(ID).thumbnailCheck;
		await repairVideoThumbnail(env, ID, { runId: 'day-2', dryRun: false });
		assert.deepEqual(env.videos.read(ID).thumbnailCheck, first, 'unchanged record: no write, no search re-projection');
	});
});

describe('daily check and the Errors page list', () => {
	class JobsDb {
		rows: any[] = [];
		prepare(sql: string) {
			const db = this;
			let args: any[] = [];
			const stmt = {
				bind(...a: any[]) { args = a; return stmt; },
				async run() {
					if (sql.startsWith('INSERT INTO admin_jobs')) {
						const [id, kind, target_kind, target_id, params, status, attempts, last_error, result, actor_id, created_at, updated_at, finished_at] = args;
						db.rows.unshift({ id, kind, target_kind, target_id, params, status, attempts, last_error, result, actor_id, created_at, updated_at, finished_at });
					}
					return {};
				},
				async first() { return db.rows.find((r) => r.id === args[0]) ?? null; },
				async all() { return { results: db.rows.filter((r) => r.target_id === args[1]) }; },
			};
			return stmt;
		}
	}
	const row = (over: Record<string, unknown>) => ({ id: crypto.randomUUID(), kind: 'videos.repair-thumbnails', target_kind: 'video', target_id: THUMBNAIL_REPAIR_TARGET, params: '{"dryRun":false}', status: 'succeeded', attempts: 1, last_error: null, result: null, actor_id: DAILY_CHECK_ACTOR, created_at: '2026-11-10T03:17:00Z', updated_at: '2026-11-10T03:20:00Z', finished_at: '2026-11-10T03:20:00Z', ...over });

	it('starts one every-video run (queued on the admin-jobs queue), not while one is active', async () => {
		const queue = new MemoryQueue();
		const env = { SEARCH_DB: new JobsDb(), ADMIN_JOBS_QUEUE: queue };
		const first = await startDailyThumbnailCheck(env as never);
		assert.equal(first.started, true);
		assert.equal(queue.messages.length, 1);
		const created = env.SEARCH_DB.rows[0];
		assert.deepEqual(JSON.parse(created.params), { dryRun: false, scheduled: 'daily' });
		assert.equal(created.actor_id, DAILY_CHECK_ACTOR);
		const second = await startDailyThumbnailCheck(env as never);
		assert.equal(second.started, false);
		assert.match(second.why ?? '', /queued/);
	});

	it('lists the flagged videos of the latest every-video run until their thumbnail changes', async () => {
		const flaggedResult = JSON.stringify({ dryRun: false, checked: 3, counts: { flagged: 2, ok: 1 }, items: [
			{ videoId: ID, outcome: 'flagged', reason: 'imported thumbnail differs' },
			{ videoId: 'fixed-since', outcome: 'flagged', reason: 'x' },
		] });
		const db = new JobsDb();
		db.rows = [
			row({ params: '{"dryRun":true,"ids":["a"]}', result: '{"items":[{"videoId":"a","outcome":"flagged"}]}' }), // an ids run: ignored
			row({ result: flaggedResult }),
		];
		const runs = (await db.prepare('x').bind('video', THUMBNAIL_REPAIR_TARGET).all()).results.map((r: any) => ({ ...r, params: JSON.parse(r.params), result: JSON.parse(r.result), status: r.status, finishedAt: r.finished_at, updatedAt: r.updated_at }));
		const latest = latestFlagged(runs as never);
		assert.deepEqual(latest?.items.map((i) => i.videoId), [ID, 'fixed-since']);
		assert.equal(isStillFlagged({ thumbnailCheck: { outcome: 'flagged' } }), true);
		assert.equal(isStillFlagged({}), false, 'a new thumbnail clears thumbnailCheck');
		assert.equal(isStillFlagged({ isDeleted: true, thumbnailCheck: { outcome: 'flagged' } }), false);

		const env = {
			...baseEnv({
				[ID]: videoFixture({ id: ID, title: 'Vertical talk', thumbnailCheck: { outcome: 'flagged' } }),
				'fixed-since': videoFixture({ id: 'fixed-since' }),
			}),
			SEARCH_DB: db,
		};
		const res = await createProcessingInternalRouter().request('/errors', {}, env);
		const body = (await res.json()) as any;
		assert.equal(res.status, 200);
		assert.deepEqual(body.result.thumbnailFlagged.items.map((i: any) => [i.videoId, i.title]), [[ID, 'Vertical talk']]);
	});
});

describe('every path that sets a thumbnail refuses another shape', () => {
	const vertical = () => baseEnv({ [ID]: videoFixture({ id: ID, userId: OWNER, channelId: 'ch1', width: 720, height: 1280, thumbnailUrl: `https://${HOST}/${ID}/thumbnail.jpg`, thumbnailType: 'auto', thumbnailCheck: { outcome: 'flagged' } }) });

	it('studio custom upload: 422 thumbnail_shape for 16:9 on a vertical video; the right shape is stored and clears the flag', async () => {
		const env = vertical();
		const app = buildApp((r) => r.post('/api/videos/:id/thumbnail', VideoThumbnailUpload), { userId: OWNER });
		const send = (bytes: Uint8Array) => {
			const form = new FormData();
			form.set('thumbnail', new File([bytes], 't.jpg', { type: 'image/jpeg' }));
			return app.request(`/api/videos/${ID}/thumbnail`, { method: 'POST', body: form }, env);
		};
		const refused = await send(jpeg(1280, 720));
		assert.equal(refused.status, 422);
		const body = (await refused.json()) as any;
		assert.equal(body.code, 'thumbnail_shape');
		assert.deepEqual(body.expected, { width: 720, height: 1280 });
		assert.equal(stored.length, 0, 'nothing stored');

		const ok = await send(jpeg(720, 1280));
		assert.equal(ok.status, 200);
		const saved = env.videos.read(ID);
		assert.equal(saved.thumbnailType, 'custom');
		assert.equal(saved.thumbnailCheck, undefined);
	});

	it('studio editor / API: a thumbnailUrl of another shape is refused; the video\'s own Bunny frames are accepted', async () => {
		const env = vertical();
		const app = buildApp((r) => r.put('/api/videos/:id', VideoUpdate), { userId: OWNER });
		const put = (thumbnailUrl: string) => app.request(`/api/videos/${ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', channelId: 'ch1' }, body: JSON.stringify({ thumbnailUrl }) }, env);

		images['https://images.alummahnow.net/wide.jpg'] = jpeg(1280, 720);
		const wide = await put('https://images.alummahnow.net/wide.jpg');
		assert.equal(wide.status, 422);
		assert.equal(((await wide.json()) as any).code, 'thumbnail_shape');

		const unreadable = await put('https://images.alummahnow.net/missing.jpg');
		assert.equal(unreadable.status, 422);
		assert.equal(((await unreadable.json()) as any).code, 'thumbnail_unreadable');

		const frame = await put(`https://${HOST}/${ID}/thumbnail_2.jpg`);
		assert.equal(frame.status, 200);
		const saved = env.videos.read(ID);
		assert.equal(saved.thumbnailUrl, `https://${HOST}/${ID}/thumbnail_2.jpg`);
		assert.equal(saved.thumbnailType, 'auto');
		assert.equal(saved.thumbnailCheck, undefined);
	});

	it('verifyThumbnailUrl: a right-shape image elsewhere is a custom thumbnail', async () => {
		images['https://images.alummahnow.net/tall.jpg'] = jpeg(1080, 1920);
		const verdict = await verifyThumbnailUrl(baseEnv(), { id: ID, width: 720, height: 1280 }, 'https://images.alummahnow.net/tall.jpg');
		assert.deepEqual(verdict, { ok: true, type: 'custom' });
	});

	it('verifyThumbnailUrl never fetches an address outside our image hosts (no SSRF)', async () => {
		for (const url of ['https://169.254.169.254/latest/meta-data', 'http://images.alummahnow.net/x.jpg', 'https://images.alummahnow.net.evil.example/x.jpg', `https://evil.example/${HOST}/x.jpg`, 'https://localhost/x.jpg']) {
			const verdict = await verifyThumbnailUrl(baseEnv(), { id: ID, width: 720, height: 1280 }, url);
			assert.equal(verdict.ok, false, url);
			assert.equal(verdict.code, 'thumbnail_host', url);
		}
		assert.deepEqual(fetched, [], 'nothing fetched');
		assert.deepEqual(await verifyThumbnailUrl(baseEnv(), { id: ID }, ''), { ok: true }, 'clearing is allowed');
	});

	it('the size read follows no redirect: a 3xx is unreadable', async () => {
		images['https://images.alummahnow.net/moved.jpg'] = 302;
		const verdict = await verifyThumbnailUrl(baseEnv(), { id: ID, width: 720, height: 1280 }, 'https://images.alummahnow.net/moved.jpg');
		assert.equal(verdict.code, 'thumbnail_unreadable');
		assert.equal(fetched.at(-1)?.redirect, 'manual');
	});

	it('only the exact Bunny host is signed, never a look-alike', () => {
		assert.equal(isOnHost(`https://${HOST}/a/thumbnail.jpg`, HOST), true);
		assert.equal(isOnHost(`https://${HOST}.evil.example/a.jpg`, HOST), false);
		assert.equal(isOnHost(`https://evil.example/?${HOST}`, HOST), false);
		assert.equal(isOnHost(`http://${HOST}/a.jpg`, HOST), false);
		assert.equal(isOwnImageHost('https://IMAGES.alummahnow.net./a.jpg', []), true);
	});

	it('admin upload: 422 thumbnail_shape, nothing stored', async () => {
		const env = vertical();
		const app = new Hono();
		app.route('/internal/admin', adminRouter);
		const form = new FormData();
		form.set('photo', new File([jpeg(1280, 720)], 't.jpg', { type: 'image/jpeg' }));
		const res = await app.request(`/internal/admin/videos/${ID}/thumbnail`, { method: 'POST', body: form, headers: { 'X-Admin-Actor': 'usr_admin' } }, env);
		assert.equal(res.status, 422);
		assert.equal(((await res.json()) as any).code, 'thumbnail_shape');
		assert.equal(stored.length, 0);
	});

	it('single upload: an image of another shape than the file is not stored; Bunny\'s frame is used', async () => {
		const env = baseEnv();
		const app = buildApp((r) => r.post('/api/videos/upload/initiate', UploadInitiateEndpoint), { userId: OWNER });
		const initiate = (data: Uint8Array) => app.request('/api/videos/upload/initiate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', channelId: 'ch1' },
			body: JSON.stringify({ title: 'Talk', fileSize: 4096, mimeType: 'video/mp4', thumbnail: { type: 'auto', data: dataUrl(data), video: { width: 720, height: 1280 } } }),
		}, env);
		const res = await initiate(jpeg(1280, 720));
		assert.equal(res.status, 200);
		assert.equal(stored.length, 0, 'the squashed frame was not stored');
		const record = env.videos.read(((await res.json()) as any).result.videoId);
		assert.equal(record.thumbnailUrl, undefined, 'no stored thumbnail: Bunny\'s frame comes when the video plays');
		assert.equal(record.thumbnailType, 'auto');
	});

	it('batch upload: records carry no foreign image, only Bunny\'s frame of the video', () => {
		const record = createUploadRecord({ videoId: ID, title: 't', userId: OWNER, channelId: 'ch1', isPublic: true, bunnyHostname: HOST, now: new Date('2026-11-10T00:00:00Z') } as never);
		assert.equal(record.thumbnailType, 'auto');
		assert.equal(record.thumbnailUrl, undefined);
	});
});
