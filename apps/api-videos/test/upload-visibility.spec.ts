/**
 * Single and bulk uploads behave the same (2026-11-10: bulk uploads showed up
 * at once without thumbnails, single uploads did not; the home page listed a
 * processing upload the channel page hid; an anonymous visitor saw
 * uploading/processing videos on a channel's Videos tab).
 *
 * - Both initiate endpoints write the same record (lib/upload/uploadRecord.ts):
 *   no thumbnail URL until Bunny's exists.
 * - One listing rule (lib/visibility.ts): before ready only the owner sees the
 *   video; at ready everyone does, in every list.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UploadInitiateEndpoint } from '../src/endpoints/video/uploadInitiate';
import { UploadBatchInitiateEndpoint } from '../src/endpoints/video/uploadBatchInitiate';
import { VideosList } from '../src/endpoints/video/videoList';
import { ChannelVideosList } from '../src/endpoints/channel/channelVideosList';
import { ChannelShortsList } from '../src/endpoints/channel/channelShortsList';
import { createUploadRecord } from '../src/lib/upload/uploadRecord';
import { isVideoListedFor, isVideoPubliclyVisible } from '../src/lib/visibility';
import { isDiscoverable } from '../src/lib/discovery';
import { publicVideoFields } from '../src/lib/transformations';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const HOST = 'vz-215a1ffd-a5a.b-cdn.net';
const OWNER = 'owner';
const CHANNEL = 'owner-ch';

class MemoryKV {
	store = new Map<string, string>();
	async get(key: string, type?: string) {
		const v = this.store.get(key);
		return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
	}
	async put(key: string, value: string) {
		this.store.set(key, value);
	}
	async delete(key: string) {
		this.store.delete(key);
	}
}

let guid = 0;
const realFetch = globalThis.fetch;
beforeEach(() => {
	guid = 0;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (/\/collections/.test(url)) return Response.json(method === 'POST' ? { guid: 'coll-1' } : { items: [], totalItems: 0 });
		if (/\/library\/\d+\/videos$/.test(url) && method === 'POST') {
			guid++;
			return Response.json({ guid: `00000000-0000-4000-8000-00000000000${guid}`, videoLibraryId: 400189 });
		}
		return new Response('not mocked', { status: 500 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function env() {
	return {
		videos: new MemoryBucket(),
		channels: new MemoryBucket({ [CHANNEL]: { id: CHANNEL, userId: OWNER, name: 'Owner channel' } }),
		profiles: new MemoryBucket(),
		'upload-defaults': new MemoryBucket(),
		queue: new MemoryQueue(),
		TUS_SESSIONS: new MemoryKV(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '400189',
		bunny_hostname: HOST,
		image_storage_key: 'img',
		ZONE: 'zone',
	} as any;
}

/** The parts of a record that differ by nature: id and time */
function comparable(record: Record<string, unknown>) {
	const { id: _id, dateCreated: _c, dateModified: _m, playUrl, title: _t, ...rest } = record;
	return { ...rest, playUrlHost: new URL(String(playUrl)).host };
}

describe('single and bulk initiate write the same record', () => {
	it('same fields and values; no thumbnail URL before Bunny has one', async () => {
		const e = env();
		const auth = { userId: OWNER };
		const single = buildApp((r) => r.post('/api/videos/upload/initiate', UploadInitiateEndpoint), auth);
		const batch = buildApp((r) => r.post('/api/videos/upload/batch/initiate', UploadBatchInitiateEndpoint), auth);
		const body = { fileSize: 123201, mimeType: 'video/mp4', isPublic: true, tags: 'a, b' };

		const s = await single.request('/api/videos/upload/initiate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', channelId: CHANNEL },
			body: JSON.stringify({ title: 'Single', ...body }),
		}, e);
		assert.equal(s.status, 200, await s.clone().text());
		const b = await batch.request('/api/videos/upload/batch/initiate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', channelId: CHANNEL },
			body: JSON.stringify({ videos: [{ title: 'Bulk', ...body }] }),
		}, e);
		assert.equal(b.status, 200, await b.clone().text());

		const records = [...e.videos.store.values()].map((v: string) => JSON.parse(v));
		assert.equal(records.length, 2);
		const [one, two] = records.map(comparable);
		assert.deepEqual(one, two);
		for (const r of records) {
			assert.equal(r.uploadStatus, 'uploading');
			assert.equal(r.thumbnailUrl, undefined, 'no thumbnail URL until Bunny made one');
			assert.equal(r.thumbnailType, 'auto');
			assert.equal(new URL(r.playUrl).host, HOST);
			assert.deepEqual(r.tags, ['a', 'b']);
		}
	});

	it('a thumbnail stored with a single upload is kept (custom)', () => {
		const r = createUploadRecord({
			videoId: 'v', title: 't', userId: OWNER, channelId: CHANNEL, bunnyHostname: HOST,
			customThumbnail: { url: 'https://images.example/v.jpg', type: 'custom', sizes: { hd: 'x' } },
		});
		assert.equal(r.thumbnailUrl, 'https://images.example/v.jpg');
		assert.equal(r.thumbnailType, 'custom');
	});
});

describe('one listing rule', () => {
	const processing = videoFixture({ id: 'p1', userId: OWNER, channelId: CHANNEL, uploadStatus: 'processing', duration: 54, thumbnailUrl: `https://${HOST}/p1/thumbnail.jpg`, thumbnailType: 'auto' });
	const uploading = videoFixture({ id: 'u1', userId: OWNER, channelId: CHANNEL, uploadStatus: 'uploading', thumbnailUrl: `https://${HOST}/u1/thumbnail.jpg`, thumbnailType: 'auto' });
	const ready = videoFixture({ id: 'r1', userId: OWNER, channelId: CHANNEL, uploadStatus: 'ready', duration: 300 });
	const legacy = videoFixture({ id: 'l1', userId: OWNER, channelId: CHANNEL, duration: 300 });

	it('helpers: visitors see public ready videos; the owner also sees their own not-ready ones', () => {
		for (const v of [processing, uploading]) {
			assert.equal(isVideoPubliclyVisible(v), false);
			assert.equal(isVideoListedFor(v, null), false);
			assert.equal(isVideoListedFor(v, 'someone-else'), false);
			assert.equal(isVideoListedFor(v, OWNER), true);
			assert.equal(isDiscoverable(v), false);
		}
		for (const v of [ready, legacy]) {
			assert.equal(isVideoPubliclyVisible(v), true);
			assert.equal(isDiscoverable(v), true);
		}
		assert.equal(isVideoPubliclyVisible({ ...ready, scheduledPublishStatus: 'scheduled' }), false);
		assert.equal(isVideoListedFor({ ...ready, isDeleted: true }, OWNER), false);
	});

	it('views never carry a thumbnail URL that 404s, nor processing internals', () => {
		const view = publicVideoFields({ ...processing, processingCheck: { loopId: 'x' }, processingIssue: { kind: 'stalled', reason: 'raw', at: 'now' } });
		assert.equal(view.thumbnailUrl, undefined);
		assert.equal((view as any).processingCheck, undefined);
		assert.equal((view as any).processingIssue, undefined);
		assert.equal(view.processingIssueKind, 'stalled');
		assert.equal(publicVideoFields({ ...ready, thumbnailUrl: 'https://x/r1/thumbnail.jpg' }).thumbnailUrl, 'https://x/r1/thumbnail.jpg');
		assert.equal(publicVideoFields({ ...ready, thumbnailUrl: 'https://x/t.jpg', thumbnailPending: true }).thumbnailUrl, undefined);
	});

	async function ids(app: any, path: string, e: any) {
		const body = (await (await app.request(path, {}, e)).json()) as any;
		return (body.data ?? []).map((v: any) => v.id).sort();
	}

	for (const [label, list, path] of [
		['latest (GET /api/videos)', VideosList, '/api/videos?limit=50'],
		['channel videos', ChannelVideosList, `/api/channels/${CHANNEL}/videos?limit=50`],
	] as const) {
		it(`${label}: visitor sees only ready videos, owner sees their processing ones too; at ready both see it`, async () => {
			const e = env();
			for (const v of [processing, uploading, ready, legacy]) await e.videos.put(v.id, JSON.stringify(v));
			const route = list === VideosList ? '/api/videos' : '/api/channels/:id/videos';
			const visitor = buildApp((r) => r.get(route, list), null);
			const owner = buildApp((r) => r.get(route, list), { userId: OWNER });

			assert.deepEqual(await ids(visitor, path, e), ['l1', 'r1']);
			const ownerIds = await ids(owner, path, e);
			assert.ok(ownerIds.includes('u1') && ownerIds.includes('r1'), `owner sees not-ready videos: ${ownerIds}`);

			// At ready (the check loop): visible to both, with its thumbnail
			await e.videos.put('u1', JSON.stringify({ ...uploading, uploadStatus: 'ready', duration: 300 }));
			assert.ok((await ids(visitor, path, e)).includes('u1'));
		});
	}

	it('channel shorts: a processing short is the owner\'s only until ready', async () => {
		const e = env();
		await e.videos.put('p1', JSON.stringify(processing));
		const visitor = buildApp((r) => r.get('/api/channels/:id/shorts', ChannelShortsList), null);
		const owner = buildApp((r) => r.get('/api/channels/:id/shorts', ChannelShortsList), { userId: OWNER });
		assert.deepEqual(await ids(visitor, `/api/channels/${CHANNEL}/shorts`, e), []);
		assert.deepEqual(await ids(owner, `/api/channels/${CHANNEL}/shorts`, e), ['p1']);
		await e.videos.put('p1', JSON.stringify({ ...processing, uploadStatus: 'ready' }));
		assert.deepEqual(await ids(visitor, `/api/channels/${CHANNEL}/shorts`, e), ['p1']);
	});
});
