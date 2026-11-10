/**
 * Per-user records created once (docs/architecture/SCALABILITY-AUDIT.md,
 * AV-21 / AV-22).
 *
 * A post like, a poll vote and a report are each one record per user, created
 * with a create-only conditional put: of a double tap, two tabs or a double
 * submit only the request that creates it counts and sends its event. The old
 * get → put let every request at once pass the check.
 *
 * Real endpoints against an R2 fake that honours `onlyIf` and widens the
 * read → write window (SlowBucket).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LikeCommunityPost } from '../src/endpoints/community/like-post';
import { VoteOnPoll } from '../src/endpoints/community/vote-poll';
import { ReportCreate } from '../src/endpoints/moderation/reportCreate';
import { MessageType } from '../src/lib/queue';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';

const CH = 'ch';
const post = (overrides: Record<string, unknown> = {}) => ({
	id: 'p1', channelId: CH, userId: 'owner', type: 'text', content: 'Post', status: 'published', visibility: 'public',
	commentsEnabled: true, likes: 0, comments: 0, views: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
	...overrides,
});
const poll = post({
	type: 'poll',
	poll: { options: [{ id: 'a', text: 'A', votes: 0 }, { id: 'b', text: 'B', votes: 0 }], multipleChoice: false, totalVotes: 0 },
});

function routes(r: any) {
	r.post('/api/channels/:channelId/posts/:postId/like', LikeCommunityPost);
	r.post('/api/channels/:channelId/posts/:postId/vote', VoteOnPoll);
	r.post('/api/reports', ReportCreate);
}
const as = (userId: string) => buildApp(routes, { userId });
const json = { 'Content-Type': 'application/json', channelId: 'me-ch' };

describe('post likes (AV-22)', () => {
	it('a user liking 10 times at once is one like record and one event', async () => {
		const e = { community_posts: new SlowBucket({ [`posts/${CH}/p1.json`]: post() }), queue: new MemoryQueue() };
		const responses = await Promise.all(
			Array.from({ length: 10 }, () => as('me').request(`/api/channels/${CH}/posts/p1/like`, { method: 'POST', headers: json }, e)),
		);
		assert.ok(responses.every((r) => r.status === 200));
		const totals = await Promise.all(responses.map(async (r) => ((await r.json()) as { totalLikes: number }).totalLikes));
		assert.deepEqual(totals.sort(), [0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 'only the request that liked reports the +1');
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.CommunityPostLiked).length, 1);
		assert.equal(e.community_posts.read('likes/p1/me.json').userId, 'me');
	});

	it('20 users liking at once each get their record and event', async () => {
		const e = { community_posts: new SlowBucket({ [`posts/${CH}/p1.json`]: post() }), queue: new MemoryQueue() };
		await Promise.all(Array.from({ length: 20 }, (_, i) => as(`u${i}`).request(`/api/channels/${CH}/posts/p1/like`, { method: 'POST', headers: json }, e)));
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.CommunityPostLiked).length, 20);
	});
});

describe('poll votes (AV-22)', () => {
	it('two different votes at once: the first is stored, the other is refused, one event', async () => {
		for (let round = 0; round < 5; round++) {
			const e = { community_posts: new SlowBucket({ [`posts/${CH}/p1.json`]: poll }), queue: new MemoryQueue() };
			const responses = await Promise.all(
				['a', 'b', 'a', 'b'].map((option) =>
					as('me').request(`/api/channels/${CH}/posts/p1/vote`, { method: 'POST', headers: json, body: JSON.stringify({ optionIds: [option] }) }, e)),
			);
			const statuses = responses.map((r) => r.status);
			assert.equal(statuses.filter((s) => s === 200).length, 1, statuses.join());
			assert.equal(statuses.filter((s) => s === 400).length, 3);
			const events = e.queue.messages.filter((m: any) => m.type === MessageType.PollVoted);
			assert.equal(events.length, 1);
			assert.deepEqual(e.community_posts.read('votes/p1/me.json').optionIds, events[0].payload.optionIds, 'the stored vote is the counted one');
		}
	});
});

describe('reports (AV-21)', () => {
	const report = (entityId = 'v1') => JSON.stringify({ entityType: 'video', entityId, reason: 'spam' });

	it('a double submit files one report and queues it once', async () => {
		const e = { reports: new SlowBucket({}), queue: new MemoryQueue() };
		const statuses = await Promise.all(
			Array.from({ length: 6 }, () => as('me').request('/api/reports', { method: 'POST', headers: json, body: report() }, e).then((r) => r.status)),
		);
		assert.equal(statuses.filter((s) => s === 200).length, 1, statuses.join());
		assert.equal(statuses.filter((s) => s === 409).length, 5);
		const reports = [...e.reports.store.keys()].filter((k) => k.startsWith('report:v1:'));
		assert.equal(reports.length, 1);
		assert.ok(reports[0].endsWith(':me'));
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.ReportCreate).length, 1);
		// Other users and other entities are not affected
		assert.equal((await as('other').request('/api/reports', { method: 'POST', headers: json, body: report() }, e)).status, 200);
		assert.equal((await as('me').request('/api/reports', { method: 'POST', headers: json, body: report('v2') }, e)).status, 200);
	});

	it('a report filed before claims existed still blocks a second one', async () => {
		const e = { reports: new MemoryBucket({ 'report:v1:old-id:me': { id: 'old-id', entityId: 'v1', reporterId: 'me' } }), queue: new MemoryQueue() };
		assert.equal((await as('me').request('/api/reports', { method: 'POST', headers: json, body: report() }, e)).status, 409);
	});

	it('erasure deletes the user\'s claims with their reports\' identity', async () => {
		const e = { reports: new MemoryBucket({}), queue: new MemoryQueue() };
		assert.equal((await as('me').request('/api/reports', { method: 'POST', headers: json, body: report() }, e)).status, 200);
		assert.equal((await as('other').request('/api/reports', { method: 'POST', headers: json, body: report() }, e)).status, 200);
		const empty = () => new MemoryBucket({});
		await eraseUserData({
			profiles: new MemoryBucket({ me: { id: 'me' } }), channels: empty(), channel_tabs: empty(), channel_sections: empty(), videos: empty(),
			watch_history: empty(), community_posts: empty(), playlists: empty(), 'upload-defaults': empty(), subtitles: empty(), reports: e.reports,
		} as any, 'me', new OperationBudget(1000));
		const keys = [...e.reports.store.keys()];
		assert.ok(!keys.some((k) => k.includes('me')), keys.join());
		assert.ok(keys.includes('claims/v1/other'), 'other users\' claims stay');
		assert.equal(keys.filter((k) => k.startsWith('report:v1:')).length, 2, 'both reports are kept (one anonymised)');
	});
});
