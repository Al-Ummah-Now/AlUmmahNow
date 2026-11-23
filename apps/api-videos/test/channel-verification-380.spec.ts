/**
 * Regression tests for #380:
 * 1. Concurrent ChannelUpdate (api-videos) and admin verification (conditional R2 etagMatches)
 *    never overwrite each other's changes (isVerified is preserved across owner edits and vice versa).
 * 2. Search queries (?verified=true and post/video/transcript payloads) read channel verification
 *    from search_channels at query time so both verifying and unverifying take effect immediately.
 * 3. Admin channel directory hydration trusts the live R2 isVerified state over stale index rows.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncSearchDocument } from '@al-ummah/shared-types';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { searchIndex } from '../src/lib/search/query';
import { hydrateChannels } from '../src/lib/admin/directory';
import { writeVerification } from '../../admin-api/src/lib/channelVerification';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

function channelFixture(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		userId: 'owner',
		email: 'owner@test.local',
		name: 'Original Name',
		description: 'Original description',
		isMain: true,
		isVerified: false,
		dateCreated: '2026-01-01T00:00:00.000Z',
		dateModified: '2026-01-01T00:00:00.000Z',
		playlists: [],
		videos: [],
		subscribers: [],
		subscriptions: [],
		likes: [],
		...overrides,
	};
}

/** Minimal D1 stub for admin-api's writeVerification audit log. */
function auditDb() {
	const rows = new Map<string, unknown[]>();
	return {
		rows,
		prepare(sql: string) {
			return {
				bind(...values: unknown[]) {
					return {
						async run() {
							if (sql.startsWith('INSERT')) rows.set(String(values[0]), values);
							else if (sql.startsWith('DELETE')) rows.delete(String(values[0]));
							return { success: true };
						},
					};
				},
			};
		},
	};
}

describe('channel verification concurrency and query-time reads (#380)', () => {
	it('concurrent ChannelUpdate and admin writeVerification preserve both isVerified and owner edits', async () => {
		const channels = new SlowBucket({ ch1: channelFixture('ch1') });
		const env = {
			channels,
			channel_tabs: new MemoryBucket(),
			queue: new MemoryQueue(),
		};
		const app = buildApp((r) => r.put('/api/channels/:id', ChannelUpdate), { userId: 'owner' });
		const db = auditDb();

		// Race 10 concurrent owner edits against an admin verification write
		const ownerEdits = Array.from({ length: 10 }, (_, i) =>
			app.request('/api/channels/ch1', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: `Edited ${i}`, description: `Desc ${i}` }),
			}, env),
		);
		const verifyWrite = writeVerification(db, channels as never, 'ch1', {
			verified: true,
			note: 'Verified scholar credentials',
			actorId: 'admin-1',
			now: '2026-11-23T12:00:00.000Z',
			id: 'audit-1',
		});

		const [verifyResult, ...responses] = await Promise.all([verifyWrite, ...ownerEdits]);
		assert.equal(verifyResult?.changed, true);
		assert.ok(responses.every((r) => r.status === 200), 'every owner update succeeds');
		assert.equal(db.rows.size, 1, 'audit row persisted');

		const stored = channels.read('ch1');
		assert.equal(stored.isVerified, true, 'admin verification survived concurrent owner edits');
		assert.match(stored.name, /^Edited \d+$/, 'owner edit survived admin verification');

		// Now race an admin unverification against another owner edit
		const [unverifyResult, secondEdit] = await Promise.all([
			writeVerification(db, channels as never, 'ch1', {
				verified: false,
				note: 'Revoked',
				actorId: 'admin-1',
				now: '2026-11-23T12:05:00.000Z',
				id: 'audit-2',
			}),
			app.request('/api/channels/ch1', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ description: 'Final bio' }),
			}, env),
		]);
		assert.equal(unverifyResult?.changed, true);
		assert.equal(secondEdit.status, 200);
		const afterUnverify = channels.read('ch1');
		assert.equal(afterUnverify.isVerified, false, 'unverification survived concurrent owner edit');
		assert.equal(afterUnverify.description, 'Final bio', 'owner bio survived unverification');
	});

	it('search ?verified=true and post/video results reflect live channel verification on verify and unverify', async () => {
		const db = new SqliteD1();
		const now = Date.parse('2026-11-23T12:00:00.000Z');
		const ch = { id: 'ch1', name: 'Scholar Channel', dateCreated: '2026-01-01T00:00:00.000Z', isVerified: true };
		const video = { id: 'v1', channelId: 'ch1', title: 'Fiqh Lesson', isPublic: true, uploadStatus: 'ready', dateCreated: '2026-02-01T00:00:00.000Z' };
		const post = { id: 'p1', channelId: 'ch1', content: 'Fiqh announcement', status: 'published', visibility: 'public', channelVerified: true, createdAt: '2026-02-02T00:00:00.000Z' };

		await syncSearchDocument(db, 'channel', 'ch1', ch, { now, version: 1 });
		await syncSearchDocument(db, 'video', 'v1', video, { now, version: 1 });
		await syncSearchDocument(db, 'post', 'p1', post, { now, version: 1 });

		// Verified channel: both video and post appear under verified=true with verified badge
		const before = await searchIndex(db, { q: 'Fiqh', verified: true }, { now });
		assert.deepEqual(before.results.map((r) => `${r.type}:${r.id}`).sort(), ['post:p1', 'video:v1']);
		const beforePost = before.results.find((r) => r.type === 'post');
		assert.equal(beforePost?.type === 'post' && beforePost.post.channelVerified, true);

		// Unverify ONLY the channel row (without re-syncing video or post rows)
		await syncSearchDocument(db, 'channel', 'ch1', { ...ch, isVerified: false }, { now: now + 1000, version: 2 });

		// Neither video nor post should match verified=true anymore
		const afterVerifiedFilter = await searchIndex(db, { q: 'Fiqh', verified: true }, { now: now + 1000 });
		assert.deepEqual(afterVerifiedFilter.results, [], 'unverified channel content must not match verified=true');

		// Unfiltered search still returns them, with channelVerified=false from the live channel row
		const afterAll = await searchIndex(db, { q: 'Fiqh' }, { now: now + 1000 });
		const afterPost = afterAll.results.find((r) => r.type === 'post');
		const afterVideo = afterAll.results.find((r) => r.type === 'video');
		assert.equal(afterPost?.type === 'post' && afterPost.post.channelVerified, false);
		assert.equal(afterVideo?.type === 'video' && afterVideo.channel?.isVerified, false);

		// Re-verify ONLY the channel row: both immediately match verified=true again
		await syncSearchDocument(db, 'channel', 'ch1', { ...ch, isVerified: true }, { now: now + 2000, version: 3 });
		const reverified = await searchIndex(db, { q: 'Fiqh', verified: true }, { now: now + 2000 });
		assert.deepEqual(reverified.results.map((r) => `${r.type}:${r.id}`).sort(), ['post:p1', 'video:v1']);
	});

	it('admin directory hydration uses live R2 isVerified instead of stale ownership index is_verified=1', async () => {
		const db = new SqliteD1();
		const channels = new MemoryBucket({
			ch1: channelFixture('ch1', { isVerified: false }),
		});
		const rows = await hydrateChannels(
			{ SEARCH_DB: db as never, channels: channels as never, videos: new MemoryBucket() as never, profiles: new MemoryBucket() as never },
			[{
				id: 'ch1',
				owner_id: 'owner',
				channel_id: 'ch1',
				is_public: 1,
				is_hidden: 0,
				is_deleted: 0,
				is_suspended: 0,
				is_verified: 1, // stale index row
				subscribers: 0,
				views: 0,
				created_at: Date.parse('2026-01-01T00:00:00.000Z'),
				admin_title: 'Original Name',
				handle: null,
				email: null,
			}],
		);
		assert.equal(rows[0].isVerified, false);
	});
});
