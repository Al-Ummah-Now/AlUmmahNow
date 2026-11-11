/** Drafts and the bulk actions added for Studio (docs/specs/CREATOR-STUDIO.md §4.4.1). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '@al-ummah/shared-types';
import { VideoBulkSchedule } from '../src/endpoints/video/videoBulkStudio';
import { VideoScheduleCreate } from '../src/endpoints/video/scheduleCreate';
import { VideoScheduleDelete } from '../src/endpoints/video/scheduleDelete';
import { VideoSchedulePublishNow } from '../src/endpoints/video/schedulePublishNow';
import { VideoBulkUpdate } from '../src/endpoints/video/videoBulkUpdate';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const OWNER = { userId: 'owner' };
const json = { 'Content-Type': 'application/json' };
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function routes(r: any) {
	r.post('/api/videos/bulk-schedule', VideoBulkSchedule);
	r.post('/api/videos/bulk-update', VideoBulkUpdate);
	r.post('/api/videos/:id/schedule', VideoScheduleCreate);
	r.delete('/api/videos/:id/schedule', VideoScheduleDelete);
	r.post('/api/videos/:id/publish-now', VideoSchedulePublishNow);
	r.put('/api/videos/:id', VideoUpdate);
}

function env(videos: Record<string, Record<string, unknown>>, playlists: Record<string, unknown> = {}) {
	const stored = Object.fromEntries(Object.entries(videos).map(([id, v]) => [id, videoFixture({ id, userId: 'owner', channelId: 'c1', isPublic: false, ...v })]));
	return { videos: new MemoryBucket(stored), playlists: new MemoryBucket(playlists), SCHEDULED_VIDEOS: new MemoryBucket(), queue: new MemoryQueue() };
}

type Env = ReturnType<typeof env>;
const stored = (e: Env, id: string) => JSON.parse(e.videos.store.get(id) as string);
const send = (e: Env, method: string, path: string, body?: unknown, auth = OWNER) =>
	buildApp(routes, auth).request(path, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) }, e as never);

describe('draft lifecycle', () => {
	it('publish now clears the draft', async () => {
		const e = env({ v1: { isDraft: true } });
		const res = await send(e, 'POST', '/api/videos/v1/publish-now');
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(stored(e, 'v1').isDraft, false);
		assert.equal(stored(e, 'v1').isPublic, true);
	});

	it('scheduling clears the draft, and cancelling makes it a draft', async () => {
		const e = env({ v1: { isDraft: true } });
		assert.equal((await send(e, 'POST', '/api/videos/v1/schedule', { scheduledPublishDate: inAnHour(), timezone: 'UTC' })).status, 200);
		assert.equal(stored(e, 'v1').isDraft, false);
		const res = await send(e, 'DELETE', '/api/videos/v1/schedule');
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(stored(e, 'v1').isDraft, true);
		assert.equal(stored(e, 'v1').scheduledPublishStatus, 'cancelled');
	});

	it('making a draft public by bulk edit clears it', async () => {
		const e = env({ v1: { isDraft: true } });
		const res = await send(e, 'POST', '/api/videos/bulk-update', { videoIds: ['v1'], changes: { isPublic: true } });
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(stored(e, 'v1').isDraft, false);
	});

	it('making a draft public by editing clears it', async () => {
		const e = env({ v1: { isDraft: true } });
		const res = await send(e, 'PUT', '/api/videos/v1', { isPublic: true });
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(stored(e, 'v1').isDraft, false);
	});

	it('leaves a video that was never a draft alone', async () => {
		const e = env({ v1: {} });
		await send(e, 'POST', '/api/videos/v1/publish-now');
		assert.notEqual(stored(e, 'v1').isDraft, true);
	});
});

describe('POST /api/videos/bulk-schedule', () => {
	it('schedules each video, spaced by the interval', async () => {
		const e = env({ a: {}, b: { isDraft: true } });
		const startAt = inAnHour();
		const res = await send(e, 'POST', '/api/videos/bulk-schedule', { videoIds: ['a', 'b'], startAt, intervalMinutes: 60, timezone: 'UTC' });
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as any;
		assert.deepEqual(body.summary, { total: 2, succeeded: 2, failed: 0 });
		assert.equal(new Date(stored(e, 'b').scheduledPublishDate).getTime() - new Date(stored(e, 'a').scheduledPublishDate).getTime(), 3600000);
		assert.equal(stored(e, 'b').isDraft, false);
		assert.equal(e.SCHEDULED_VIDEOS.store.size, 2);
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.VideoEdit).length, 2);
	});

	it('reports per video: public, already scheduled, not found, not yours', async () => {
		const e = env({ ok: {}, pub: { isPublic: true }, sch: { scheduledPublishStatus: 'scheduled' }, theirs: { userId: 'other' } });
		const res = await send(e, 'POST', '/api/videos/bulk-schedule', { videoIds: ['ok', 'pub', 'sch', 'gone', 'theirs'], startAt: inAnHour(), timezone: 'UTC' });
		const body = (await res.json()) as any;
		assert.deepEqual(body.summary, { total: 5, succeeded: 1, failed: 4 });
		assert.equal(stored(e, 'theirs').scheduledPublishStatus, undefined);
	});

	it('refuses a time too soon, and more than 50 videos', async () => {
		const e = env({ a: {} });
		const soon = await send(e, 'POST', '/api/videos/bulk-schedule', { videoIds: ['a'], startAt: new Date(Date.now() + 60000).toISOString(), timezone: 'UTC' });
		assert.equal(((await soon.json()) as any).summary.failed, 1);
		const many = await send(e, 'POST', '/api/videos/bulk-schedule', { videoIds: Array.from({ length: 51 }, (_, i) => `v${i}`), startAt: inAnHour(), timezone: 'UTC' });
		assert.equal(many.status, 400);
	});
});
