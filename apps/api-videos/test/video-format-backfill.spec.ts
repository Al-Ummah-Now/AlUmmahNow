/**
 * Short/video format backfill (lib/video-format/job.ts): queued, idempotent
 * pages; encoded size from Bunny (API or playlist), never guessed; videos
 * still processing go to the processing loop; the rest are flagged for admins.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	applyFormatChoice,
	hasOpenFormatIssue,
	projectOwnership,
	videoFormatTotals,
	VIDEO_FORMAT_JOB_KIND,
} from '@al-ummah/shared-types';
import {
	handleVideoFormatMessage,
	firstMediaPlaylist,
	largestResolution,
	playlistDuration,
	readVideoFormatRun,
	startDailyVideoFormatRun,
	runVideoFormatPage,
	startVideoFormatRun,
} from '../src/lib/video-format/job';
import { runProcessingCheck } from '../src/lib/processing/loop';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const HOST = 'vz-cb79844a-c5d.b-cdn.net';
const LEGACY = 'vz-215a1ffd-a5a.b-cdn.net';
const NOW = new Date('2026-11-10T12:00:00.000Z');

class DelayQueue {
	sent: { body: any; delaySeconds?: number }[] = [];
	async send(body: unknown, opts?: { delaySeconds?: number }) {
		this.sent.push({ body, delaySeconds: opts?.delaySeconds });
	}
}

function makeEnv(videos: Record<string, unknown>) {
	return {
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket(),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		queue: new DelayQueue(),
		PROCESSING_CHECK_QUEUE: new DelayQueue(),
		SEARCH_DB: new SqliteD1(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '498994',
		bunny_hostname: HOST,
	} as any;
}

/** Bunny API by video id, and CDN master playlists by URL path. */
let bunny: Record<string, { status: number; body?: unknown }> = {};
let playlists: Record<string, string> = {};
let fetched: string[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
	bunny = {};
	playlists = {};
	fetched = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		fetched.push(url);
		if (url.includes('video.bunnycdn.com')) {
			const r = bunny[url.split('/videos/')[1]] ?? { status: 404 };
			return new Response(r.body ? JSON.stringify(r.body) : null, { status: r.status });
		}
		const path = new URL(url).pathname;
		return playlists[path] ? new Response(playlists[path], { status: 200 }) : new Response(null, { status: 404 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const ready = (id: string, extra: Record<string, unknown> = {}) =>
	videoFixture({ id, title: id, channelId: 'c1', uploadStatus: 'ready', playUrl: `https://${HOST}/${id}/playlist.m3u8`, ...extra });

function message(extra: Record<string, unknown> = {}) {
	return { kind: VIDEO_FORMAT_JOB_KIND, runId: 'run-0001', page: 0, cursor: null, dryRun: false, limit: 50, ...extra } as any;
}

function queued(body: unknown, attempts = 1) {
	const m = { body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
	return Object.assign(m, {
		ack() { m.acked = true; },
		retry(o?: { delaySeconds?: number }) { m.retried = o ?? {}; },
	});
}

const stored = async (env: any, id: string) => JSON.parse((await env.videos.get(id)).text ? await (await env.videos.get(id)).text() : 'null');

describe('largestResolution', () => {
	it('reads the biggest RESOLUTION of a master playlist', () => {
		const m3u8 = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=360x640\n360p/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=1080x1920\n1080p/video.m3u8\n';
		assert.deepEqual(largestResolution(m3u8), { width: 1080, height: 1920 });
		assert.equal(largestResolution('#EXTM3U\n'), null);
	});
});

describe('playlist parsing', () => {
	it('sums a media playlist and finds the first rendition', () => {
		assert.equal(playlistDuration('#EXTM3U\n#EXTINF:4.000,\na.ts\n#EXTINF:4.000,\nb.ts\n#EXTINF:2.4,\nc.ts\n'), 10);
		assert.equal(playlistDuration('#EXTM3U\n'), null);
		assert.equal(firstMediaPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\n360p/video.m3u8\n'), '360p/video.m3u8');
	});
});

describe('every library, every legacy record', () => {
	it('legacy records with no size or length: read from Bunny whichever library holds them; the uploader choice is never touched', async () => {
		const NEWER = 'vz-25839d05-80d.b-cdn.net';
		const env = makeEnv({
			// Configured library (prod: legacy 400189): the Stream API has size and length
			'k-legacy-api': ready('k-legacy-api', {}),
			// Another library (no API key here): the CDN gives size and, from the media playlist, length
			'l-other-lib': ready('l-other-lib', { playUrl: `https://${NEWER}/l-other-lib/playlist.m3u8` }),
			// Imported record without a playUrl: the configured library's CDN
			'm-no-playurl': videoFixture({ id: 'm-no-playurl', title: 'm', channelId: 'c1', playUrl: undefined, uploadStatus: undefined }),
			// The uploader chose "video": classified by that choice, never read or changed
			'n-choice': ready('n-choice', { format: 'video' }),
		});
		bunny['k-legacy-api'] = { status: 200, body: { guid: 'k-legacy-api', status: 4, length: 75, width: 1080, height: 1920 } };
		playlists['/l-other-lib/playlist.m3u8'] = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=720x1280\n720p/video.m3u8\n';
		playlists['/l-other-lib/720p/video.m3u8'] = '#EXTM3U\n#EXTINF:6.0,\na.ts\n#EXTINF:6.0,\nb.ts\n';
		playlists['/m-no-playurl/playlist.m3u8'] = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n1080p/video.m3u8\n';
		playlists['/m-no-playurl/1080p/video.m3u8'] = '#EXTM3U\n#EXTINF:100.0,\na.ts\n';

		const { counts } = await runVideoFormatPage(env, message(), { now: NOW });
		assert.deepEqual([await stored(env, 'k-legacy-api')].map((v) => [v.width, v.height, v.duration]), [[1080, 1920, 75]]);
		assert.deepEqual([await stored(env, 'l-other-lib')].map((v) => [v.width, v.height, v.duration]), [[720, 1280, 12]]);
		assert.deepEqual([await stored(env, 'm-no-playurl')].map((v) => [v.width, v.height, v.duration]), [[1920, 1080, 100]]);
		assert.ok(!fetched.some((u) => u.includes('video.bunnycdn.com') && u.includes('l-other-lib')), 'no API call for another library');
		assert.equal(counts.shorts, 2, 'k and l: vertical and short');
		assert.equal(counts.flagged, 0);
		const choice = await stored(env, 'n-choice');
		assert.equal(choice.format, 'video');
		assert.equal(choice.width, undefined);
		assert.ok(!fetched.some((u) => u.includes('n-choice')));
		const rows = await env.SEARCH_DB.prepare("SELECT id FROM content_ownership WHERE kind = 'video' AND is_short = 1 ORDER BY id").all();
		assert.deepEqual(rows.results.map((r: any) => r.id), ['k-legacy-api', 'l-other-lib']);
	});

	it('pages wait between each other (rate limit) and the daily run starts only after an applied run', async () => {
		const videos: Record<string, unknown> = {};
		for (let i = 0; i < 3; i++) videos[`v${i}`] = ready(`v${i}`, { duration: 30, width: 720, height: 1280 });
		const env = makeEnv(videos);
		assert.deepEqual(await startDailyVideoFormatRun(env, NOW), { started: false, why: 'no applied run yet (an admin starts the first one)' });
		await startVideoFormatRun(env, { dryRun: true, limit: 2, now: NOW });
		await handleVideoFormatMessage(env, queued(env.PROCESSING_CHECK_QUEUE.sent[0].body), NOW);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[1].delaySeconds, 5);
		await handleVideoFormatMessage(env, queued(env.PROCESSING_CHECK_QUEUE.sent[1].body), NOW);
		assert.equal((await startDailyVideoFormatRun(env, NOW)).started, false, 'a dry run does not unlock the daily run');

		env.VIDEO_FORMAT_PAGE_DELAY_SECONDS = '0';
		await startVideoFormatRun(env, { dryRun: false, limit: 2, now: NOW });
		const first = env.PROCESSING_CHECK_QUEUE.sent.length - 1;
		await handleVideoFormatMessage(env, queued(env.PROCESSING_CHECK_QUEUE.sent[first].body), NOW);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[first + 1].delaySeconds, 0);
		await handleVideoFormatMessage(env, queued(env.PROCESSING_CHECK_QUEUE.sent[first + 1].body), NOW);
		const daily = await startDailyVideoFormatRun(env, NOW);
		assert.equal(daily.started, true);
		assert.equal((await readVideoFormatRun(env))!.requestedBy, 'daily');
		assert.equal((await startDailyVideoFormatRun(env, NOW)).started, false, 'not while a run is going');
	});
});

describe('format backfill page', () => {
	it('classifies, stores Bunny sizes, rechecks processing videos and flags the rest', async () => {
		const env = makeEnv({
			'a-vertical': ready('a-vertical', { duration: 45, width: 1080, height: 1920 }),
			'b-landscape': ready('b-landscape', { duration: 120, width: 1920, height: 1080 }),
			// Old rule said Short (< 60 s); Bunny reports landscape: becomes a video
			'c-old-short': ready('c-old-short', { duration: 30 }),
			// No size stored; Bunny API reports vertical: becomes a Short
			'd-api': ready('d-api', { duration: 90 }),
			// Legacy library (404 at the API): size from the CDN playlist
			'e-legacy': ready('e-legacy', { duration: 100, playUrl: `https://${LEGACY}/e-legacy/playlist.m3u8` }),
			// Nowhere to read a size: flagged for an admin
			'f-unknown': ready('f-unknown', { duration: 50, playUrl: undefined }),
			// Still encoding: handed to the processing loop, not flagged
			'g-processing': videoFixture({ id: 'g-processing', channelId: 'c1', uploadStatus: 'processing', dateCreated: NOW.toISOString() }),
			// The uploader's choice decides without any read
			'h-override': ready('h-override', { duration: 30, format: 'video' }),
			// Long: a video whatever its shape; nothing to read
			'i-long': ready('i-long', { duration: 1200 }),
			'index:recent': { id: 'index:recent' },
		});
		bunny['c-old-short'] = { status: 200, body: { guid: 'c-old-short', status: 4, length: 30, width: 1280, height: 720 } };
		bunny['d-api'] = { status: 200, body: { guid: 'd-api', status: 4, length: 90, width: 720, height: 1280 } };
		playlists['/e-legacy/playlist.m3u8'] = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1080x1080\n1080p/video.m3u8\n';

		const { counts, nextCursor } = await runVideoFormatPage(env, message(), { now: NOW });
		assert.equal(nextCursor, null);
		assert.equal(counts.scanned, 9);
		assert.equal(counts.shorts, 3, 'a-vertical, d-api (vertical), e-legacy (square)');
		assert.equal(counts.videos, 6);
		assert.equal(counts.dimensionsStored, 3, 'c, d, e');
		assert.equal(counts.flagged, 1, 'f-unknown');
		assert.equal(counts.rechecking, 1, 'g-processing');
		assert.equal(counts.overrides, 1);
		assert.equal(counts.unknown, 2, 'f (flagged) and g (encoding)');
		assert.equal(counts.oldRuleShorts, 4, 'a, c, f and h were Shorts by duration');
		assert.equal(counts.becameShorts, 2, 'd and e');
		assert.equal(counts.becameVideos, 3, 'c (landscape), f (unknown), h (override)');

		assert.deepEqual([(await stored(env, 'd-api')).width, (await stored(env, 'd-api')).height], [720, 1280]);
		assert.deepEqual([(await stored(env, 'e-legacy')).width, (await stored(env, 'e-legacy')).height], [1080, 1080]);
		assert.ok(hasOpenFormatIssue(await stored(env, 'f-unknown')));
		assert.deepEqual((await stored(env, 'f-unknown')).formatIssue.missing, ['dimensions']);
		assert.equal((await stored(env, 'e-legacy')).uploadStatus, 'ready', 'a legacy-library 404 never marks a ready video failed');
		assert.equal((await stored(env, 'i-long')).width, undefined, 'nothing is read for a decided video');
		assert.ok(!fetched.some((u) => u.includes('i-long') || u.includes('h-override') || u.includes('a-vertical')));

		const loop = env.PROCESSING_CHECK_QUEUE.sent.find((m: any) => m.body.videoId === 'g-processing');
		assert.ok(loop, 'the processing video got a processing-check loop');
		assert.equal((await stored(env, 'g-processing')).formatIssue, undefined);

		// is_short and needs_format re-projected for the whole page
		const rows = await env.SEARCH_DB.prepare("SELECT id, is_short, needs_format FROM content_ownership WHERE kind = 'video' ORDER BY id").all();
		const byId = Object.fromEntries(rows.results.map((r: any) => [r.id, r]));
		assert.equal(byId['a-vertical'].is_short, 1);
		assert.equal(byId['d-api'].is_short, 1);
		assert.equal(byId['c-old-short'].is_short, 0);
		assert.equal(byId['f-unknown'].needs_format, 1);
		assert.equal(byId['b-landscape'].needs_format, 0);
		const search = await env.SEARCH_DB.prepare('SELECT id, is_short FROM search_videos WHERE is_short = 1 ORDER BY id').all();
		assert.deepEqual(search.results.map((r: any) => r.id), ['a-vertical', 'd-api', 'e-legacy']);
	});

	it('is idempotent: a second run changes nothing and reads nothing new', async () => {
		const env = makeEnv({ 'd-api': ready('d-api', { duration: 90 }), 'f-unknown': ready('f-unknown', { duration: 50, playUrl: undefined }) });
		bunny['d-api'] = { status: 200, body: { guid: 'd-api', status: 4, length: 90, width: 720, height: 1280 } };
		const first = await runVideoFormatPage(env, message(), { now: NOW });
		const snapshot = [await stored(env, 'd-api'), await stored(env, 'f-unknown')];
		fetched = [];
		const second = await runVideoFormatPage(env, message(), { now: new Date(NOW.getTime() + 60000) });
		assert.deepEqual([await stored(env, 'd-api'), await stored(env, 'f-unknown')], snapshot);
		assert.equal(second.counts.dimensionsStored, 0);
		assert.equal(second.counts.shorts, first.counts.shorts);
		assert.ok(!fetched.some((u) => u.includes('d-api')), 'a stored size is not read again');
	});

	it('dry run reads and counts but writes nothing', async () => {
		const env = makeEnv({ 'd-api': ready('d-api', { duration: 90 }), 'f-unknown': ready('f-unknown', { duration: 50, playUrl: undefined }), 'g': videoFixture({ id: 'g', uploadStatus: 'processing' }) });
		bunny['d-api'] = { status: 200, body: { guid: 'd-api', status: 4, length: 90, width: 720, height: 1280 } };
		const before = [await stored(env, 'd-api'), await stored(env, 'f-unknown')];
		const { counts } = await runVideoFormatPage(env, message({ dryRun: true }), { now: NOW });
		assert.equal(counts.shorts, 1, 'd-api would become a Short');
		assert.equal(counts.flagged, 1);
		assert.equal(counts.rechecking, 1);
		assert.deepEqual([await stored(env, 'd-api'), await stored(env, 'f-unknown')], before);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 0);
		const rows = await env.SEARCH_DB.prepare('SELECT COUNT(*) AS n FROM content_ownership').first();
		assert.equal(rows.n, 0, 'no index writes');
	});

	it('a Bunny error retries the page; on the last attempts the video is flagged instead', async () => {
		const env = makeEnv({ 'd-api': ready('d-api', { duration: 90 }) });
		bunny['d-api'] = { status: 500 };
		await assert.rejects(() => runVideoFormatPage(env, message(), { now: NOW }), /1 video\(s\) failed/);
		assert.equal((await stored(env, 'd-api')).formatIssue, undefined);
		const { counts } = await runVideoFormatPage(env, message(), { now: NOW, flagErrors: true });
		assert.equal(counts.errors, 1);
		assert.match((await stored(env, 'd-api')).formatIssue.reason, /Format check failed/);
	});
});

describe('format backfill run (queue chain)', () => {
	it('starts, pages through the bucket with one message per page and records totals', async () => {
		const videos: Record<string, unknown> = {};
		for (let i = 0; i < 5; i++) videos[`v${i}`] = ready(`v${i}`, { duration: 30, width: 720, height: 1280 });
		videos.w = ready('w', { duration: 600 });
		const env = makeEnv(videos);
		const run = await startVideoFormatRun(env, { dryRun: false, limit: 4, requestedBy: 'admin-1', now: NOW });
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 1);

		const first = queued(env.PROCESSING_CHECK_QUEUE.sent[0].body);
		await handleVideoFormatMessage(env, first, NOW);
		assert.ok(first.acked);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 2, 'page 1 queued');
		const second = queued(env.PROCESSING_CHECK_QUEUE.sent[1].body);
		assert.equal(second.body.page, 1);
		await handleVideoFormatMessage(env, second, NOW);

		const done = (await readVideoFormatRun(env))!;
		assert.equal(done.runId, run.runId);
		assert.equal(done.status, 'done');
		assert.equal(done.requestedBy, 'admin-1');
		const totals = videoFormatTotals(done);
		assert.equal(totals.scanned, 6);
		assert.equal(totals.shorts, 5);
		assert.equal(totals.videos, 1);

		// A duplicate delivery of a finished page is acknowledged without work
		const dup = queued(env.PROCESSING_CHECK_QUEUE.sent[0].body);
		await handleVideoFormatMessage(env, dup, NOW);
		assert.ok(dup.acked);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 2);
	});

	it('a failing page is retried with backoff and records the error on the run', async () => {
		const env = makeEnv({ 'd-api': ready('d-api', { duration: 90 }) });
		bunny['d-api'] = { status: 503 };
		await startVideoFormatRun(env, { dryRun: false, now: NOW });
		const msg = queued(env.PROCESSING_CHECK_QUEUE.sent[0].body, 1);
		await handleVideoFormatMessage(env, msg, NOW);
		assert.ok(!msg.acked);
		assert.deepEqual(msg.retried, { delaySeconds: 30 });
		assert.match((await readVideoFormatRun(env))!.lastError!, /page 0, attempt 1/);
		// Last attempts: flag and finish rather than dead-letter the whole run
		const last = queued(env.PROCESSING_CHECK_QUEUE.sent[0].body, 4);
		await handleVideoFormatMessage(env, last, NOW);
		assert.ok(last.acked);
		assert.equal((await readVideoFormatRun(env))!.status, 'done');
		assert.ok(hasOpenFormatIssue(await stored(env, 'd-api')));
	});

	it('drops malformed messages', async () => {
		const env = makeEnv({});
		const bad = queued({ kind: VIDEO_FORMAT_JOB_KIND, runId: 'x' });
		await handleVideoFormatMessage(env, bad, NOW);
		assert.ok(bad.acked);
	});
});

describe('processing loop and format flags', () => {
	it('an encoded video Bunny gives no size for is flagged; a later size clears the flag', async () => {
		const id = 'p-1';
		const env = makeEnv({ [id]: videoFixture({ id, uploadStatus: 'processing', dateCreated: NOW.toISOString(), processingCheck: { loopId: 'L1', startedAt: NOW.toISOString(), attempt: 0 } }) });
		bunny[id] = { status: 200, body: { guid: id, status: 4, encodeProgress: 100, availableResolutions: '720p', length: 40 } };
		playlists[`/${id}/thumbnail.jpg`] = 'jpeg';
		await runProcessingCheck(env, { kind: 'processing-check', videoId: id, loopId: 'L1', attempt: 0, startedAt: NOW.toISOString() }, NOW);
		let video = await stored(env, id);
		assert.equal(video.uploadStatus, 'ready');
		assert.deepEqual(video.formatIssue.missing, ['dimensions']);

		bunny[id] = { status: 200, body: { guid: id, status: 4, encodeProgress: 100, availableResolutions: '720p', length: 40, width: 720, height: 1280 } };
		await env.videos.put(id, JSON.stringify({ ...video, processingCheck: { loopId: 'L2', startedAt: NOW.toISOString(), attempt: 0 } }));
		await runProcessingCheck(env, { kind: 'processing-check', videoId: id, loopId: 'L2', attempt: 0, startedAt: NOW.toISOString() }, NOW);
		video = await stored(env, id);
		assert.equal(video.height, 1280);
		assert.equal(video.formatIssue, undefined);
	});
});

describe('format choice (uploader / admin)', () => {
	it('a choice resolves the flag; auto returns to detection', () => {
		const video: any = { duration: 50, formatIssue: { reason: 'x', missing: ['dimensions'], at: 'now' } };
		assert.equal(projectOwnership('video', 'v', { id: 'v', ...video })!.needsFormat, true);
		assert.equal(applyFormatChoice(video, 'short', { by: 'admin', userId: 'a1', at: 'now' }), true);
		assert.equal(video.format, 'short');
		assert.equal(video.formatIssue, undefined);
		assert.equal(video.formatSetBy.by, 'admin');
		assert.equal(projectOwnership('video', 'v', { id: 'v', ...video })!.needsFormat, false);
		assert.equal(applyFormatChoice(video, 'short', { by: 'admin', userId: 'a1', at: 'later' }), false, 'same choice: no change');
		assert.equal(applyFormatChoice(video, 'auto', { by: 'owner', userId: 'o1', at: 'now' }), true);
		assert.equal(video.format, undefined);
		assert.equal(video.formatSetBy, undefined);
	});
});
