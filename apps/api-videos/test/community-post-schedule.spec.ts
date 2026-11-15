/**
 * Scheduling and editing community posts (Story 29.4): create with a time inside the scheduled-video
 * window (5 minutes to a year ahead), move a scheduled post, publish it now (the cron's go-live step:
 * index first, CommunityPostCreated for the subscriber notification), never schedule a published post,
 * and edited text is sanitised like new text. `posts.scheduled` refuses with 402 when a plan says no.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '@al-ummah/shared-types';
import { CreateCommunityPost } from '../src/endpoints/community/create-post';
import { UpdateCommunityPost } from '../src/endpoints/community/update-post';
import { checkPostScheduleAllowed, type EntitlementResolver } from '../src/lib/studioLimits';
import { postScheduleProblem } from '../src/lib/post-schedule';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const CH = 'ch';
const OWNER = 'owner';
const MIN = 60_000;
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

function routes(r: any) {
	r.post('/api/channels/:channelId/posts', CreateCommunityPost);
	r.put('/api/channels/:channelId/posts/:postId', UpdateCommunityPost);
}

const stored = (overrides: Record<string, unknown> = {}) => ({
	id: 'p1', channelId: CH, userId: OWNER, type: 'text', content: 'Original', status: 'published', visibility: 'public',
	commentsEnabled: true, likes: 0, comments: 0, views: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
	...overrides,
});

function env(post = stored()) {
	return {
		community_posts: new SlowBucket({ [`posts/${CH}/p1.json`]: post, [`posts/${CH}/index.json`]: { postIds: ['old', 'p1'], lastUpdated: '' } }),
		channels: new MemoryBucket({ [CH]: { id: CH, userId: OWNER, name: 'Channel' } }),
		queue: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(),
	};
}

const owner = buildApp(routes, { userId: OWNER });
const headers = { 'Content-Type': 'application/json', channelId: CH };
const create = (e: ReturnType<typeof env>, body: Record<string, unknown>) =>
	owner.request(`/api/channels/${CH}/posts`, { method: 'POST', headers, body: JSON.stringify({ type: 'text', content: 'Hello', ...body }) }, e);
const update = (e: ReturnType<typeof env>, body: Record<string, unknown>) =>
	owner.request(`/api/channels/${CH}/posts/p1`, { method: 'PUT', headers, body: JSON.stringify(body) }, e);
const markers = async (e: ReturnType<typeof env>) => (await e.community_posts.list({ prefix: 'scheduled-posts/' })).objects.map((o: { key: string }) => o.key);
const created = (e: ReturnType<typeof env>) => e.queue.messages.filter((m: { type: MessageType }) => m.type === MessageType.CommunityPostCreated);

describe('the scheduling window', () => {
	const now = new Date('2026-11-14T10:00:00.000Z');
	it('takes 5 minutes to a year ahead, like scheduled videos', () => {
		assert.equal(postScheduleProblem('2026-11-14T10:05:00.000Z', now), null);
		assert.equal(postScheduleProblem('2027-11-14T09:59:00.000Z', now), null);
		assert.equal(postScheduleProblem('2026-11-14T10:04:00.000Z', now)?.code, 'schedule_too_soon');
		assert.equal(postScheduleProblem('2026-11-14T09:00:00.000Z', now)?.code, 'schedule_too_soon');
		assert.equal(postScheduleProblem('2027-11-15T10:00:00.000Z', now)?.code, 'schedule_too_far');
		assert.equal(postScheduleProblem('soon', now)?.code, 'schedule_invalid');
	});
});

describe('posts.scheduled', () => {
	const resolver = (value: unknown): EntitlementResolver => async () => ({ entitlements: { 'posts.scheduled': { value } } as never });
	it('refuses only when a plan says no; allows with no resolver or a failing one', async () => {
		const input = { userId: OWNER, channelId: CH };
		assert.equal(await checkPostScheduleAllowed({}, input, resolver(true)), null);
		assert.equal(await checkPostScheduleAllowed({}, input, null), null);
		assert.equal(await checkPostScheduleAllowed({}, input, async () => { throw new Error('D1 down'); }), null);
		const refused = await checkPostScheduleAllowed({}, input, resolver(false));
		assert.equal(refused?.error, 'upgrade_required');
		assert.equal(refused?.entitlement, 'posts.scheduled');
	});
});

describe('creating a scheduled post', () => {
	it('stores it scheduled with a marker and announces nothing yet', async () => {
		const e = env();
		const at = ahead(60 * MIN);
		const res = await create(e, { scheduledAt: at });
		assert.equal(res.status, 200, await res.clone().text());
		const { post } = (await res.json()) as { post: { id: string; status: string; scheduledAt: string } };
		assert.equal(post.status, 'scheduled');
		assert.deepEqual(await markers(e), [`scheduled-posts/${new Date(at).toISOString()}/${CH}/${post.id}`]);
		assert.equal(created(e).length, 0, 'subscribers hear about it when it goes live');
	});

	it('refuses a time outside the window with its code', async () => {
		const e = env();
		const soon = await create(e, { scheduledAt: ahead(2 * MIN) });
		assert.equal(soon.status, 400);
		assert.equal(((await soon.json()) as { code: string }).code, 'schedule_too_soon');
		const far = await create(e, { scheduledAt: ahead(400 * 24 * 60 * MIN) });
		assert.equal(((await far.json()) as { code: string }).code, 'schedule_too_far');
		assert.deepEqual(await markers(e), []);
	});

	it('a post published now is announced at once', async () => {
		const e = env();
		const res = await create(e, {});
		assert.equal(res.status, 200);
		assert.equal(created(e).length, 1);
	});
});

describe('changing a scheduled post', () => {
	const scheduled = () => env(stored({ status: 'scheduled', scheduledAt: ahead(60 * MIN) }));

	it('moves it to a new time (a new marker; the old one is dropped when due)', async () => {
		const e = scheduled();
		const at = ahead(120 * MIN);
		const res = await update(e, { scheduledAt: at });
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(e.community_posts.read(`posts/${CH}/p1.json`).scheduledAt, at);
		assert.deepEqual(await markers(e), [`scheduled-posts/${new Date(at).toISOString()}/${CH}/p1`]);
	});

	it('publishes it now: published, first in the index, announced once', async () => {
		const e = scheduled();
		const res = await update(e, { publishNow: true });
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as { post: { status: string } };
		assert.equal(body.post.status, 'published');
		const saved = e.community_posts.read(`posts/${CH}/p1.json`);
		assert.equal(saved.status, 'published');
		assert.ok(Date.now() - Date.parse(saved.createdAt) < MIN, 'dated now');
		assert.deepEqual(e.community_posts.read(`posts/${CH}/index.json`).postIds, ['p1', 'old']);
		const announced = created(e);
		assert.equal(announced.length, 1);
		assert.deepEqual({ postId: announced[0].payload.postId, channelId: announced[0].payload.channelId }, { postId: 'p1', channelId: CH });
		// Again: it is no longer scheduled
		const again = await update(e, { publishNow: true });
		assert.equal(again.status, 400);
		assert.equal(((await again.json()) as { code: string }).code, 'not_scheduled');
		assert.equal(created(e).length, 1);
	});

	it('refuses both at once', async () => {
		const res = await update(scheduled(), { publishNow: true, scheduledAt: ahead(90 * MIN) });
		assert.equal(res.status, 400);
	});

	it('never schedules a published post', async () => {
		const e = env();
		const res = await update(e, { scheduledAt: ahead(60 * MIN) });
		assert.equal(res.status, 400);
		assert.equal(((await res.json()) as { code: string }).code, 'not_scheduled');
		assert.equal(e.community_posts.read(`posts/${CH}/p1.json`).status, 'published');
		assert.deepEqual(await markers(e), []);
	});
});

describe('editing a post', () => {
	it('sanitises edited text like new text', async () => {
		const e = env();
		const res = await update(e, { content: 'Hi <script>alert(1)</script><b>there</b> <img src=x onerror=alert(1)>' });
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(e.community_posts.read(`posts/${CH}/p1.json`).content, 'Hi <b>there</b> ');
	});

	it('only the owning channel edits', async () => {
		const res = await owner.request(`/api/channels/${CH}/posts/p1`, { method: 'PUT', headers: { 'Content-Type': 'application/json', channelId: 'other' }, body: JSON.stringify({ content: 'x' }) }, env());
		assert.equal(res.status, 403);
	});
});
