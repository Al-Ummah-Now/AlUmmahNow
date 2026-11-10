/**
 * Thumbnail aspect repair job and the width-only size URLs
 * (2026-11-10: "single video upload, thumbs dont match aspect").
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	aspectMismatch,
	imageSize,
	planThumbnailRepair,
	repairVideoThumbnail,
	runThumbnailRepairStep,
	THUMBNAIL_REPAIR_JOB,
	THUMBNAIL_REPAIR_TARGET,
	VIDEOS_PER_STEP,
} from '../src/lib/thumbnail/repair';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { createProcessingInternalRouter } from '../src/endpoints/video/processingInternal';
import { thumbnailSizeUrls } from '../src/lib/thumbnail/processor';
import { thumbnailStorage } from '../src/lib/thumbnail/storage';
import { MemoryBucket, videoFixture } from './helpers';

const HOST = 'vz-215a1ffd-a5a.b-cdn.net';
const ID = '0f5b5978-1111-4222-8333-944455556666';
const IMAGES = 'https://images.alummahnow.net';

/** Minimal JPEG: SOI, APP1 (an EXIF block with a decoy SOF inside), SOF0 with the size. */
function jpeg(width: number, height: number): Uint8Array {
	const decoy = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10];
	const app1 = [0xff, 0xe1, 0x00, 2 + decoy.length, ...decoy];
	const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
	return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xda, 0x00, 0x02]);
}

function png(width: number, height: number): Uint8Array {
	const b = new Uint8Array(33);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	new DataView(b.buffer).setUint32(16, width);
	new DataView(b.buffer).setUint32(20, height);
	return b;
}

class BatchQueue {
	sent: any[] = [];
	async send(body: unknown) {
		this.sent.push(body);
	}
	async sendBatch(messages: Iterable<{ body: unknown }>) {
		for (const m of messages) this.sent.push(m.body);
	}
}

function makeEnv(videos = new MemoryBucket()) {
	return {
		videos,
		channels: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new BatchQueue(),
		PROCESSING_CHECK_QUEUE: new BatchQueue(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '400189',
		bunny_hostname: HOST,
	} as any;
}

/** URL (without query) → image bytes, or a status. Bunny API answers by video id. */
let images: Record<string, Uint8Array | number> = {};
let bunnyVideos: Record<string, unknown> = {};
const realFetch = globalThis.fetch;
beforeEach(() => {
	images = {};
	bunnyVideos = {};
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.startsWith('https://video.bunnycdn.com/')) {
			const id = url.split('/videos/')[1];
			const body = bunnyVideos[id];
			return new Response(body ? JSON.stringify(body) : null, { status: body ? 200 : 404 });
		}
		const image = images[url.split('?')[0]];
		if (typeof image === 'number') return new Response(null, { status: image });
		if (!image) return new Response(null, { status: 404 });
		return new Response(image, { status: 206, headers: { 'content-type': 'image/jpeg' } });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('imageSize', () => {
	it('reads JPEG past an EXIF block, PNG and WebP', () => {
		assert.deepEqual(imageSize(jpeg(1280, 720)), { width: 1280, height: 720 });
		assert.deepEqual(imageSize(jpeg(1080, 1920)), { width: 1080, height: 1920 });
		assert.deepEqual(imageSize(png(1440, 1440)), { width: 1440, height: 1440 });
		const vp8x = new Uint8Array(30);
		vp8x.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
		vp8x.set([(720 - 1) & 0xff, (720 - 1) >> 8, 0, (1280 - 1) & 0xff, (1280 - 1) >> 8, 0], 24);
		assert.deepEqual(imageSize(vp8x), { width: 720, height: 1280 });
		assert.equal(imageSize(new TextEncoder().encode('<html>not an image</html>')), null);
	});
});

describe('planThumbnailRepair', () => {
	const vertical = { width: 1080, height: 1920 };
	const squashed = { width: 1280, height: 720 };

	it('a squashed auto frame on image storage is replaced by Bunny\'s thumbnail', () => {
		const plan = planThumbnailRepair({ thumbnailUrl: `${IMAGES}/thumbnails/x/custom.jpg?width=1280&quality=90`, thumbnailType: 'auto', video: vertical, thumbnail: squashed });
		assert.equal(plan.action, 'use_bunny');
	});

	it('a custom image and Bunny\'s own thumbnail are flagged, never replaced', () => {
		assert.equal(planThumbnailRepair({ thumbnailUrl: `${IMAGES}/t/a.jpg`, thumbnailType: 'custom', video: vertical, thumbnail: squashed }).action, 'flag');
		assert.equal(planThumbnailRepair({ thumbnailUrl: `https://${HOST}/${ID}/thumbnail.jpg`, thumbnailType: 'auto', video: { width: 1440, height: 1440 }, thumbnail: { width: 640, height: 480 } }).action, 'flag');
	});

	it('matching shapes (within 5%) are left alone; unknown sizes are skipped or flagged', () => {
		assert.equal(planThumbnailRepair({ thumbnailUrl: 'u', video: vertical, thumbnail: { width: 720, height: 1280 } }).action, 'none');
		// A 1280x658 encode drawn into 1280x720 is 9% squashed: replaced
		assert.equal(planThumbnailRepair({ thumbnailUrl: 'u', video: { width: 1280, height: 658 }, thumbnail: { width: 1280, height: 720 } }).action, 'use_bunny');
		assert.equal(planThumbnailRepair({ thumbnailUrl: 'u', video: null, thumbnail: squashed }).action, 'skip');
		assert.equal(planThumbnailRepair({ video: vertical, thumbnail: null }).action, 'skip');
		assert.equal(planThumbnailRepair({ thumbnailUrl: 'u', video: vertical, thumbnail: null }).action, 'flag');
		assert.equal(aspectMismatch({ width: 1920, height: 1080 }, { width: 1280, height: 720 }), false);
	});
});

describe('repairVideoThumbnail', () => {
	const squashedUrl = `${IMAGES}/thumbnails/${ID}/custom.jpg`;
	const bunnyThumb = `https://${HOST}/${ID}/thumbnail.jpg`;

	function seeded(overrides: Record<string, unknown> = {}) {
		return new MemoryBucket({
			[ID]: videoFixture({ id: ID, thumbnailUrl: `${squashedUrl}?width=1280&height=720&quality=90&aspect_ratio=16:9`, thumbnailType: 'auto', thumbnailSizes: { hd: 'x' }, ...overrides }),
		});
	}

	it('replaces a squashed auto frame with Bunny\'s thumbnail and stores the video size', async () => {
		const env = makeEnv(seeded());
		images[squashedUrl] = jpeg(1280, 720);
		images[bunnyThumb] = jpeg(1080, 1920);
		bunnyVideos[ID] = { guid: ID, status: 4, width: 1080, height: 1920, thumbnailFileName: 'thumbnail.jpg' };

		const result = await repairVideoThumbnail(env, ID, { runId: 'run-1', dryRun: false, now: new Date('2026-11-10T06:00:00Z') });
		assert.equal(result.outcome, 'replaced');
		const saved = env.videos.read(ID);
		assert.equal(saved.thumbnailUrl, bunnyThumb);
		assert.equal(saved.thumbnailType, 'auto');
		assert.equal(saved.thumbnailSizes, undefined);
		assert.equal(saved.width, 1080);
		assert.equal(saved.height, 1920);
		assert.equal(saved.thumbnailCheck.outcome, 'replaced');
		assert.match(saved.thumbnailCheck.previousThumbnailUrl, /custom\.jpg/);
		assert.equal(env.queue.sent.length, 1, 'a VideoEdit message follows the change');

		// Idempotent: the next run finds it matching
		const again = await repairVideoThumbnail(env, ID, { runId: 'run-2', dryRun: false });
		assert.equal(again.outcome, 'ok');
		assert.equal(again.changed, false);
	});

	it('dry run records what would change and changes nothing else', async () => {
		const env = makeEnv(seeded({ width: 1080, height: 1920 }));
		images[squashedUrl] = jpeg(1280, 720);
		images[bunnyThumb] = jpeg(1080, 1920);
		bunnyVideos[ID] = { guid: ID, status: 4, width: 1080, height: 1920 };
		const result = await repairVideoThumbnail(env, ID, { runId: 'run-1', dryRun: true });
		assert.equal(result.outcome, 'would_replace');
		const saved = env.videos.read(ID);
		assert.match(saved.thumbnailUrl, /custom\.jpg/);
		assert.equal(saved.thumbnailCheck.outcome, 'would_replace');
		assert.equal(env.queue.sent.length, 0);
	});

	it('flags instead of replacing when Bunny\'s thumbnail does not match either', async () => {
		const env = makeEnv(seeded({ width: 1440, height: 1440 }));
		images[squashedUrl] = jpeg(1280, 720);
		images[bunnyThumb] = jpeg(640, 480);
		bunnyVideos[ID] = { guid: ID, status: 4, width: 1440, height: 1440 };
		const result = await repairVideoThumbnail(env, ID, { runId: 'r', dryRun: false });
		assert.equal(result.outcome, 'flagged');
		assert.match(env.videos.read(ID).thumbnailUrl, /custom\.jpg/);
	});

	it('never touches a custom thumbnail', async () => {
		const env = makeEnv(seeded({ thumbnailType: 'custom', width: 1080, height: 1920 }));
		images[squashedUrl] = jpeg(1280, 720);
		bunnyVideos[ID] = { guid: ID, status: 4, width: 1080, height: 1920 };
		const result = await repairVideoThumbnail(env, ID, { runId: 'r', dryRun: false });
		assert.equal(result.outcome, 'flagged');
		assert.equal(env.videos.read(ID).thumbnailType, 'custom');
	});

	it('a CDN 5xx throws (the queue retries)', async () => {
		const env = makeEnv(seeded({ width: 1080, height: 1920 }));
		images[squashedUrl] = 503;
		bunnyVideos[ID] = { guid: ID, status: 4, width: 1080, height: 1920 };
		await assert.rejects(repairVideoThumbnail(env, ID, { runId: 'r', dryRun: false }), /HTTP 503/);
	});
});

describe('the admin job (resumable steps)', () => {
	const job = (params: Record<string, unknown>, result: Record<string, unknown> | null = null) => ({ id: 'job-1', params, result });

	it('is registered with the admin job handlers', () => {
		assert.equal(typeof ADMIN_JOB_HANDLERS[THUMBNAIL_REPAIR_JOB], 'function');
	});

	it('walks every video record a step at a time, skipping side records, and sums the results', async () => {
		const seed: Record<string, unknown> = { 'v-1:views': 1, 'idx/x': {} };
		for (let i = 0; i < VIDEOS_PER_STEP + 3; i++) {
			const id = `vid-${String(i).padStart(4, '0')}`;
			seed[id] = videoFixture({ id }); // no thumbnail: skipped, still counted
		}
		const env = makeEnv(new MemoryBucket(seed));
		const first = await runThumbnailRepairStep(env, job({ dryRun: true }));
		assert.equal(first.done, false);
		const second = await runThumbnailRepairStep(env, job((first as any).params, first.result as any));
		const third = second.done ? second : await runThumbnailRepairStep(env, job((second as any).params, second.result as any));
		assert.equal(third.done, true);
		assert.equal(third.result.checked, VIDEOS_PER_STEP + 3);
		assert.equal(third.result.counts.skipped, VIDEOS_PER_STEP + 3);
		assert.equal(third.result.dryRun, true);
	});

	it('an ids run checks only those videos and lists what needs an admin', async () => {
		const env = makeEnv(new MemoryBucket({
			[ID]: videoFixture({ id: ID, thumbnailUrl: `${IMAGES}/thumbnails/${ID}/custom.jpg`, thumbnailType: 'custom', width: 1080, height: 1920 }),
			other123: videoFixture({ id: 'other123' }),
		}));
		images[`${IMAGES}/thumbnails/${ID}/custom.jpg`] = jpeg(1280, 720);
		const done = await runThumbnailRepairStep(env, job({ dryRun: false, ids: [ID] }));
		assert.equal(done.done, true);
		assert.deepEqual(done.result.counts, { flagged: 1 });
		assert.equal(done.result.items[0].videoId, ID);
		assert.equal(done.result.items[0].outcome, 'flagged');
		assert.equal(env.videos.read('other123').thumbnailCheck, undefined);
	});

	it('a video that keeps failing is listed as an error and does not stop the job', async () => {
		const env = makeEnv(new MemoryBucket({ [ID]: videoFixture({ id: ID, thumbnailUrl: `${IMAGES}/t.jpg`, width: 1080, height: 1920 }) }));
		images[`${IMAGES}/t.jpg`] = 503;
		const done = await runThumbnailRepairStep(env, job({ dryRun: false, ids: [ID] }));
		assert.equal(done.done, true);
		assert.deepEqual(done.result.counts, { error: 1 });
		assert.equal(env.videos.read(ID).thumbnailCheck.outcome, 'error');
	});
});

describe('processing admin endpoints for the thumbnail job', () => {
	class FakeJobsDb {
		rows = new Map<string, any>();
		prepare(sql: string) {
			const db = this;
			let args: any[] = [];
			const stmt = {
				bind(...a: any[]) { args = a; return stmt; },
				async run() {
					if (sql.startsWith('INSERT INTO admin_jobs')) {
						const [id, kind, target_kind, target_id, params, status, attempts, last_error, result, actor_id, created_at, updated_at, finished_at] = args;
						db.rows.set(id, { id, kind, target_kind, target_id, params, status, attempts, last_error, result, actor_id, created_at, updated_at, finished_at });
					} else if (sql.startsWith('UPDATE admin_jobs SET')) {
						const cols = sql.slice('UPDATE admin_jobs SET '.length, sql.indexOf(' WHERE')).split(', ').map((c) => c.split(' = ')[0]);
						const row = db.rows.get(args[args.length - 1]);
						cols.forEach((col, i) => { row[col] = args[i]; });
					}
					return {};
				},
				async first() { return db.rows.get(args[0]) ?? null; },
				async all() {
					const [targetKind, targetId] = args;
					return { results: [...db.rows.values()].filter((r) => r.target_kind === targetKind && r.target_id === targetId) };
				},
			};
			return stmt;
		}
	}

	it('queues a dry run by default, lists runs, and retries only a failed run', async () => {
		const env = { ...makeEnv(new MemoryBucket()), SEARCH_DB: new FakeJobsDb(), ADMIN_JOBS_QUEUE: new BatchQueue() };
		const app = createProcessingInternalRouter();
		const res = await app.request('/thumbnails', { method: 'POST', body: JSON.stringify({ actorId: 'admin-1' }), headers: { 'content-type': 'application/json' } }, env);
		assert.equal(res.status, 202);
		const { result } = (await res.json()) as any;
		assert.equal(result.job.kind, THUMBNAIL_REPAIR_JOB);
		assert.equal(result.job.targetId, THUMBNAIL_REPAIR_TARGET);
		assert.deepEqual(result.job.params, { dryRun: true });
		assert.equal(result.job.actorId, 'admin-1');
		assert.equal(env.ADMIN_JOBS_QUEUE.sent.length, 1);

		const list = (await (await app.request('/thumbnails', {}, env)).json()) as any;
		assert.equal(list.result.runs.length, 1);

		const notFailed = await app.request(`/thumbnails/${result.job.id}/retry`, { method: 'POST' }, env);
		assert.equal(notFailed.status, 409);
		env.SEARCH_DB.rows.get(result.job.id).status = 'failed';
		const retried = await app.request(`/thumbnails/${result.job.id}/retry`, { method: 'POST' }, env);
		assert.equal(retried.status, 200);
		assert.equal(((await retried.json()) as any).result.job.status, 'queued');

		const bad = await app.request('/thumbnails', { method: 'POST', body: JSON.stringify({ ids: ['../x'] }), headers: { 'content-type': 'application/json' } }, env);
		assert.equal(bad.status, 400);
	});
});

describe('thumbnail size URLs keep the image aspect', () => {
	it('ask for a width only (no height, no 16:9 crop)', () => {
		const urls = thumbnailSizeUrls(`${IMAGES}/thumbnails/v/a.jpg`);
		assert.equal(urls.hd, `${IMAGES}/thumbnails/v/a.jpg?width=1280&quality=90`);
		for (const url of Object.values(urls)) {
			assert.doesNotMatch(url, /height=|aspect_ratio/);
		}
		assert.doesNotMatch(thumbnailStorage.getBunnyUrl('v', IMAGES, 'sd'), /height=|aspect_ratio/);
	});
});
