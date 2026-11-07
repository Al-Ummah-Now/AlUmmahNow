/**
 * Story 1.3 AC 2, 3, 5: GDPR export, erasure/anonymisation, consent audit
 * trail and retention enforcement.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';
import { PrivacyConsentGet, PrivacyConsentPut, PrivacyErase, PrivacyExport, appendConsentRecord, CONSENT_HISTORY_LIMIT } from '../src/endpoints/privacy/privacy';
import { collectUserData, eraseUserData, DELETED_USER_ID, EXPORT_LIST_FIELDS } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import {
	archiveKeyDate,
	enforceRetention,
	EVENT_ARCHIVE_RETENTION_DAYS,
	WATCH_HISTORY_RETENTION_DAYS,
} from '../src/lib/privacy/retention';
import { MessageType } from '@al-ummah/shared-types';

const ME = 'user-me';
const OTHER = 'user-other';

function seed() {
	return {
		profiles: new MemoryBucket({
			[ME]: { id: ME, email: 'me@test.local', firstName: 'Me', subscribedTo: ['ch-other'], watchHistory: [{ videoId: 'v-other', watchTime: 5 }] },
			[OTHER]: { id: OTHER, email: 'other@test.local' },
		}),
		channels: new MemoryBucket({
			'ch-me': { id: 'ch-me', userId: ME, name: 'My channel', subscriptions: [{ id: 's0', userId: OTHER, channelId: 'ch-other', entityId: 'ch-me' }] },
			'ch-other': {
				id: 'ch-other',
				userId: OTHER,
				name: 'Other channel',
				subscriptions: [
					{ id: 's1', userId: ME, channelId: 'ch-me', entityId: 'ch-other' },
					{ id: 's2', userId: 'user-third', channelId: 'ch-third', entityId: 'ch-other' },
				],
			},
		}),
		channel_sections: new MemoryBucket({ 'ch-me/sec1': { id: 'sec1' }, 'ch-other/sec2': { id: 'sec2' } }),
		channel_tabs: new MemoryBucket({ 'channel-tabs/ch-me': { tabs: [] }, 'channel-tabs/ch-other': { tabs: [] } }),
		videos: new MemoryBucket({
			'v-mine': videoFixture({ id: 'v-mine', userId: ME, channelId: 'ch-me', comments: [commentFixture('c-on-mine', { userId: OTHER, videoId: 'v-mine' })] }),
			'v-other': videoFixture({
				id: 'v-other',
				userId: OTHER,
				channelId: 'ch-other',
				likes: [{ id: 'l1', userId: ME, channelId: 'ch-me', entityId: 'v-other' }, { id: 'l2', userId: OTHER, channelId: 'ch-other', entityId: 'v-other' }],
				comments: [
					commentFixture('c-mine', {
						userId: ME,
						channelId: 'ch-me',
						videoId: 'v-other',
						text: 'my comment',
						replies: [commentFixture('r-other', { userId: OTHER, text: 'reply' })],
					}),
					commentFixture('c-other', { userId: OTHER, likes: [{ id: 'cl1', userId: ME, channelId: 'ch-me' }] }),
				],
			}),
			'index:recent-videos': { items: [] },
		}),
		watch_history: new MemoryBucket({
			[`${ME}:v-other`]: { id: `${ME}:v-other`, userId: ME, videoId: 'v-other', progress: 10 },
			[`${OTHER}:v-mine`]: { id: `${OTHER}:v-mine`, userId: OTHER, videoId: 'v-mine', progress: 3 },
		}),
		community_posts: new MemoryBucket({
			'posts/ch-me/p-mine.json': { id: 'p-mine', channelId: 'ch-me', userId: ME, content: 'my post' },
			'posts/ch-me/index.json': { posts: ['p-mine'] },
			'posts/ch-other/p-other.json': { id: 'p-other', channelId: 'ch-other', userId: OTHER, content: 'their post' },
			'comments/p-mine/top-level/pc-x.json': { id: 'pc-x', postId: 'p-mine', userId: OTHER, content: 'on my post' },
			'comments/p-other/top-level/pc-mine.json': { id: 'pc-mine', postId: 'p-other', userId: ME, channelId: 'ch-me', content: 'my post comment', userDisplayName: 'Me', userAvatarUrl: 'https://x' },
			'comments/p-other/top-level/index.json': { ids: ['pc-mine'] },
			[`likes/p-other/${ME}.json`]: { userId: ME, postId: 'p-other' },
			[`likes/p-other/${OTHER}.json`]: { userId: OTHER, postId: 'p-other' },
			[`votes/p-other/${ME}.json`]: { userId: ME, postId: 'p-other', optionIds: ['o1'] },
			[`comment-likes/p-other/pc-x/${ME}.json`]: { userId: ME },
		}),
		playlists: new MemoryBucket({ 'pl-mine': { id: 'pl-mine', userId: ME, name: 'Mine' }, 'pl-other': { id: 'pl-other', userId: OTHER } }),
		'upload-defaults': new MemoryBucket({ [`${ME}/t1`]: { id: 't1', userId: ME }, [`${OTHER}/t2`]: { id: 't2', userId: OTHER } }),
		reports: new MemoryBucket({
			[`report:v-other:r1:${ME}`]: { id: 'r1', reporterId: ME, entityId: 'v-other', reason: 'spam' },
			[`report:v-mine:r2:${OTHER}`]: { id: 'r2', reporterId: OTHER, entityId: 'v-mine', reason: 'spam' },
		}),
		subtitles: new MemoryBucket({ 'v-mine/original/en.vtt': { x: 1 }, 'v-other/original/en.vtt': { x: 1 } }),
		queue: new MemoryQueue(),
	};
}

type Env = ReturnType<typeof seed>;

function privacyRoutes(r: any) {
	r.get('/api/privacy/export', PrivacyExport);
	r.delete('/api/privacy/data', PrivacyErase);
	r.get('/api/privacy/consent', PrivacyConsentGet);
	r.put('/api/privacy/consent', PrivacyConsentPut);
}

describe('collectUserData (export)', () => {
	let env: Env;
	beforeEach(() => {
		env = seed();
	});

	it('gathers everything stored about the user across buckets', async () => {
		const data = await collectUserData(env, ME, new OperationBudget(10_000));
		assert.equal(data.complete, true);
		assert.equal(data.profile?.email, 'me@test.local');
		assert.deepEqual(data.legacyWatchHistory, [{ videoId: 'v-other', watchTime: 5 }]);
		assert.deepEqual(data.channels.map((c) => c.id), ['ch-me']);
		assert.equal(data.channels[0].subscribersCount, 1);
		assert.equal(data.channelSections.length, 1);
		assert.equal(data.channelTabs.length, 1);
		assert.deepEqual(data.videos.map((v) => v.id), ['v-mine']);
		assert.equal(data.videos[0].commentsCount, 1);
		assert.equal(data.videos[0].comments, undefined, 'other people\'s comments are not exported');
		assert.deepEqual(data.videoComments.map((c) => c.id), ['c-mine']);
		assert.deepEqual(data.videoReactions.map((r) => r.id), ['l1']);
		assert.deepEqual(data.commentReactions.map((r) => r.id), ['cl1']);
		assert.deepEqual(
			data.subscriptions.map((s) => s.subscribedToChannelId ?? s.channelId).sort(),
			['ch-other', 'ch-other'],
		);
		assert.deepEqual(data.watchHistory.map((w) => w.videoId), ['v-other']);
		assert.deepEqual(data.communityPosts.map((p) => p.id), ['p-mine']);
		assert.deepEqual(data.communityComments.map((c) => c.id), ['pc-mine']);
		assert.equal(data.communityLikes.length, 1);
		assert.equal(data.pollVotes.length, 1);
		assert.equal(data.communityCommentLikes.length, 1);
		assert.deepEqual(data.playlists.map((p) => p.id), ['pl-mine']);
		assert.deepEqual(data.uploadDefaults.map((t) => t.id), ['t1']);
		assert.deepEqual(data.reportsFiled.map((r) => r.id), ['r1']);
		assert.ok(data.notes.length > 0);
	});

	it('never includes another user\'s private data', async () => {
		const data = await collectUserData(env, ME, new OperationBudget(10_000));
		const serialized = JSON.stringify(data);
		assert.ok(!serialized.includes('other@test.local'));
		assert.ok(!serialized.includes(`${OTHER}:v-mine`));
	});

	it('reports complete=false when the operation budget runs out', async () => {
		const data = await collectUserData(env, ME, new OperationBudget(3));
		assert.equal(data.complete, false);
		assert.ok(data.resumeToken);
	});

	it('resumed partial exports merge to the full export', async () => {
		const full = await collectUserData(env, ME, new OperationBudget(10_000));
		const merged: Record<string, any[]> = Object.fromEntries(EXPORT_LIST_FIELDS.map((f) => [f, []]));
		let resumeToken: string | undefined;
		let passes = 0;
		let profile = null;
		do {
			const part = await collectUserData(env, ME, new OperationBudget(8), { resumeToken, pageSize: 2 });
			for (const field of EXPORT_LIST_FIELDS) merged[field].push(...part[field]);
			profile = profile ?? part.profile;
			resumeToken = part.resumeToken;
			passes++;
			if (part.complete) break;
		} while (passes < 100);
		assert.ok(passes > 1);
		assert.deepEqual(profile, full.profile);
		for (const field of EXPORT_LIST_FIELDS) {
			const ids = (list: any[]) => list.map((x) => JSON.stringify(x)).sort();
			// Interrupted pages are rolled back and redone, so there are no duplicates.
			assert.deepEqual(ids(merged[field]), ids(full[field]), field);
		}
	});
});

describe('eraseUserData (erasure)', () => {
	let env: Env;
	beforeEach(() => {
		env = seed();
	});

	it('deletes owned data, anonymises shared content and leaves other users untouched', async () => {
		const deletedMedia: string[] = [];
		const summary = await eraseUserData(env, ME, new OperationBudget(10_000), {
			onVideoDeleted: async (id) => void deletedMedia.push(id),
		});
		assert.equal(summary.complete, true);

		// Deleted
		assert.equal(env.profiles.read(ME), null);
		assert.equal(env.channels.read('ch-me'), null);
		assert.equal(env.channel_sections.read('ch-me/sec1'), null);
		assert.equal(env.channel_tabs.read('channel-tabs/ch-me'), null);
		assert.equal(env.videos.read('v-mine'), null);
		assert.equal(env.subtitles.read('v-mine/original/en.vtt'), null);
		assert.deepEqual(deletedMedia, ['v-mine']);
		assert.equal(env.watch_history.read(`${ME}:v-other`), null);
		assert.equal(env.playlists.read('pl-mine'), null);
		assert.equal(env['upload-defaults'].read(`${ME}/t1`), null);
		assert.equal(env.community_posts.read('posts/ch-me/p-mine.json'), null);
		assert.equal(env.community_posts.read('posts/ch-me/index.json'), null);
		assert.equal(env.community_posts.read('comments/p-mine/top-level/pc-x.json'), null);
		assert.equal(env.community_posts.read(`likes/p-other/${ME}.json`), null);
		assert.equal(env.community_posts.read(`votes/p-other/${ME}.json`), null);
		assert.equal(env.community_posts.read(`comment-likes/p-other/pc-x/${ME}.json`), null);

		// Subscriptions and reactions removed from other people's objects
		const otherChannel = env.channels.read('ch-other');
		assert.deepEqual(otherChannel.subscriptions.map((s: any) => s.id), ['s2']);
		const otherVideo = env.videos.read('v-other');
		assert.deepEqual(otherVideo.likes.map((l: any) => l.id), ['l2']);
		assert.deepEqual(otherVideo.comments[1].likes, []);

		// Anonymised, thread kept
		const myComment = otherVideo.comments[0];
		assert.equal(myComment.userId, DELETED_USER_ID);
		assert.equal(myComment.text, '');
		assert.equal(myComment.isDeleted, true);
		assert.equal(myComment.replies[0].text, 'reply', 'replies from others survive');
		const myPostComment = env.community_posts.read('comments/p-other/top-level/pc-mine.json');
		assert.equal(myPostComment.userId, DELETED_USER_ID);
		assert.equal(myPostComment.content, '');
		assert.equal(myPostComment.userDisplayName, '');
		assert.equal(myPostComment.userAvatarUrl, undefined);
		assert.equal(env.reports.read(`report:v-other:r1:${ME}`), null);
		assert.equal(env.reports.read(`report:v-other:r1:${DELETED_USER_ID}`).reporterId, DELETED_USER_ID);

		// Other users untouched
		assert.ok(env.profiles.read(OTHER));
		assert.ok(env.channels.read('ch-other'));
		assert.ok(env.watch_history.read(`${OTHER}:v-mine`));
		assert.ok(env.playlists.read('pl-other'));
		assert.ok(env['upload-defaults'].read(`${OTHER}/t2`));
		assert.ok(env.community_posts.read(`likes/p-other/${OTHER}.json`));
		assert.ok(env.community_posts.read('posts/ch-other/p-other.json'));
		assert.ok(env.reports.read(`report:v-mine:r2:${OTHER}`));
		assert.ok(env.subtitles.read('v-other/original/en.vtt'));
		assert.ok(env.videos.read('index:recent-videos'));

		// Nothing identifying the user is left
		const everything = Object.values(env)
			.filter((b): b is MemoryBucket => b instanceof MemoryBucket)
			.flatMap((b) => [...b.store.keys(), ...b.store.values()])
			.join('\n');
		assert.ok(!everything.includes(ME), 'no trace of the erased user id');
		assert.ok(!everything.includes('me@test.local'));
	});

	it('is resumable: repeated bounded passes converge to a complete erasure', async () => {
		let passes = 0;
		let summary;
		let resumeToken: string | undefined;
		do {
			summary = await eraseUserData(env, ME, new OperationBudget(12), {}, { resumeToken, pageSize: 2 });
			resumeToken = summary.resumeToken;
			passes++;
		} while (!summary.complete && passes < 100);
		assert.equal(summary.complete, true);
		assert.ok(passes > 1, 'needed several passes');
		assert.equal(summary.resumeToken, undefined);
		assert.equal(env.profiles.read(ME), null);
		assert.equal(env.channels.read('ch-me'), null);
		assert.equal(env.community_posts.read('posts/ch-me/p-mine.json'), null);
		assert.equal(env.videos.read('v-other').comments[0].userId, DELETED_USER_ID);
		const everything = Object.values(env)
			.filter((b): b is MemoryBucket => b instanceof MemoryBucket)
			.flatMap((b) => [...b.store.keys(), ...b.store.values()])
			.join('\n');
		assert.ok(!everything.includes(ME), 'resumed passes leave no trace either');
	});

	it('ignores malformed resume tokens (starts over)', async () => {
		const summary = await eraseUserData(env, ME, new OperationBudget(10_000), {}, { resumeToken: 'not-a-token' });
		assert.equal(summary.complete, true);
		assert.equal(env.profiles.read(ME), null);
	});

	it('is idempotent', async () => {
		await eraseUserData(env, ME, new OperationBudget(10_000));
		const again = await eraseUserData(env, ME, new OperationBudget(10_000));
		assert.equal(again.complete, true);
		assert.equal(again.deleted.profile ?? 0, 0);
	});
});

describe('privacy endpoints', () => {
	it('require authentication', async () => {
		const app = buildApp(privacyRoutes, null);
		const env = seed();
		for (const [method, path] of [['GET', '/api/privacy/export'], ['DELETE', '/api/privacy/data'], ['PUT', '/api/privacy/consent']]) {
			const res = await app.request(path, { method }, env);
			assert.equal(res.status, 401, `${method} ${path}`);
		}
	});

	it('GET /api/privacy/export returns a JSON attachment for the caller only', async () => {
		const app = buildApp(privacyRoutes, { userId: ME });
		const res = await app.request('/api/privacy/export', {}, seed());
		assert.equal(res.status, 200);
		assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="al-ummah-now-data-/);
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const body = await res.json();
		assert.equal(body.userId, ME);
		assert.deepEqual(body.playlists.map((p: any) => p.id), ['pl-mine']);
	});

	it('DELETE /api/privacy/data requires explicit confirmation', async () => {
		const app = buildApp(privacyRoutes, { userId: ME });
		const env = seed();
		const res = await app.request('/api/privacy/data', { method: 'DELETE', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } }, env);
		assert.equal(res.status, 400);
		assert.equal((await res.json()).code, 'confirmation_required');
		assert.ok(env.profiles.read(ME));
	});

	it('DELETE /api/privacy/data erases and queues follow-up messages', async () => {
		const app = buildApp(privacyRoutes, { userId: ME });
		const env = seed();
		const res = await app.request(
			'/api/privacy/data',
			{ method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }), headers: { 'content-type': 'application/json' } },
			env,
		);
		assert.equal(res.status, 200);
		const body = await res.json();
		assert.equal(body.complete, true);
		assert.equal(env.profiles.read(ME), null);
		const types = env.queue.messages.map((m: any) => m.type);
		assert.ok(types.includes(MessageType.UserDataErased));
		assert.ok(types.includes(MessageType.VideoDelete));
	});

	it('records consent decisions as an audit trail on the profile', async () => {
		const app = buildApp(privacyRoutes, { userId: ME });
		const env = seed();
		const decision = { version: 1, analytics: false, experiments: false, performance: true, decidedAt: '2026-11-06T10:00:00.000Z', source: 'banner' };
		const put = await app.request('/api/privacy/consent', { method: 'PUT', body: JSON.stringify(decision), headers: { 'content-type': 'application/json' } }, env);
		assert.equal(put.status, 200);
		assert.equal((await put.json()).stored, true);
		const get = await app.request('/api/privacy/consent', {}, env);
		const { consent } = await get.json();
		assert.equal(consent.current.performance, true);
		assert.equal(consent.history.length, 1);
		assert.ok(consent.current.recordedAt);

		const bad = await app.request('/api/privacy/consent', { method: 'PUT', body: JSON.stringify({ analytics: 'yes' }), headers: { 'content-type': 'application/json' } }, env);
		assert.equal(bad.status, 400);
		assert.equal((await bad.json()).code, 'invalid_consent');
	});

	it('caps the consent history', () => {
		let profile: Record<string, any> = { id: ME };
		for (let i = 0; i < CONSENT_HISTORY_LIMIT + 10; i++) {
			profile = appendConsentRecord(profile, { version: 1, analytics: i % 2 === 0, experiments: false, performance: false, decidedAt: new Date(i).toISOString(), recordedAt: '' });
		}
		assert.equal(profile.privacyConsent.history.length, CONSENT_HISTORY_LIMIT);
		assert.equal(profile.id, ME);
	});
});

describe('retention enforcement', () => {
	const DAY = 24 * 60 * 60 * 1000;
	const now = new Date('2026-11-06T03:17:00.000Z');

	it('parses archive key dates', () => {
		assert.deepEqual(archiveKeyDate('2025-01-31T10-00-00.abc'), new Date(Date.UTC(2025, 0, 31)));
		assert.equal(archiveKeyDate('analytics/rollups/video/v1/2025-01.json'), null);
	});

	it('deletes watch history and archived events past their retention periods only', async () => {
		const watch_history = new MemoryBucket({ 'u:old': {}, 'u:recent': {} });
		watch_history.uploaded.set('u:old', new Date(now.getTime() - (WATCH_HISTORY_RETENTION_DAYS + 1) * DAY));
		watch_history.uploaded.set('u:recent', new Date(now.getTime() - 10 * DAY));

		const old = new Date(now.getTime() - (EVENT_ARCHIVE_RETENTION_DAYS + 5) * DAY).toISOString().slice(0, 10);
		const recent = new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10);
		const analytics_rollups = new MemoryBucket({
			[`${old}T01-00-00.m1`]: { userId: 'u' },
			[`${old}T02-00-00.m2`]: { userId: 'u' },
			[`${recent}T01-00-00.m3`]: { userId: 'u' },
			'analytics/rollups/video/v1/2024-01.json': { views: 10 },
		});

		const result = await enforceRetention({ watch_history, analytics_rollups }, now, new OperationBudget(100));
		assert.deepEqual(result, { watchHistoryDeleted: 1, eventsDeleted: 2, complete: true });
		assert.deepEqual([...watch_history.store.keys()], ['u:recent']);
		assert.deepEqual([...analytics_rollups.store.keys()].sort(), [`${recent}T01-00-00.m3`, 'analytics/rollups/video/v1/2024-01.json'].sort());
	});

	it('stops at the budget and reports incomplete', async () => {
		const watch_history = new MemoryBucket({ a: {} });
		const result = await enforceRetention({ watch_history }, now, new OperationBudget(0));
		assert.equal(result.complete, false);
	});
});
