/**
 * POST /internal/admin/lookup (lib/admin/lookup.ts): one call names a page of
 * reported items (title, channel, owner) and users (name, ban state).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import adminRouter from '../src/routers/admin.router';
import { cleanLookup } from '../src/lib/admin/lookup';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

function seed() {
	const db = new SqliteD1();
	const own = db.db.prepare('INSERT INTO content_ownership (kind, id, owner_id, channel_id, admin_title, handle, is_hidden, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
	own.run('channel', 'ch_1', 'usr_owner', 'ch_1', 'Good Channel', 'good', 0, 0);
	own.run('video', 'v_1', 'usr_owner', 'ch_1', 'A video', null, 1, 0);
	own.run('profile', 'usr_owner', null, null, 'Owner Name', 'owner', 0, 0);
	own.run('profile', 'usr_rep', null, null, 'Reporter Name', 'rep', 0, 0);
	db.db.prepare('INSERT INTO admin_comments (video_id, comment_id, user_id, channel_id, text) VALUES (?, ?, ?, ?, ?)').run('v_1', 'c_1', 'usr_commenter', null, '  a   rude comment ');
	db.db.prepare('INSERT INTO videos_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)').run('usr_owner', 'x', 'admin', '2026-01-01T00:00:00Z');
	const profiles = new MemoryBucket({ usr_commenter: { displayName: 'Commenter' } });
	const playlists = new MemoryBucket({ p_1: { id: 'p_1', title: 'List', userId: 'usr_rep', channelId: 'ch_1' } });
	const app = new Hono();
	app.route('/internal/admin', adminRouter as never);
	const env = { SEARCH_DB: db, profiles, playlists };
	return (json: unknown) =>
		app.request('/internal/admin/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }, env as never);
}

describe('admin lookup', () => {
	it('names items, their channels and owners, and users with their ban state', async () => {
		const call = seed();
		const res = await call({
			items: [
				{ type: 'video', id: 'v_1' },
				{ type: 'comment', id: 'c_1' },
				{ type: 'playlist', id: 'p_1' },
				{ type: 'channel', id: 'ch_1' },
				{ type: 'video', id: 'gone' },
				{ type: 'post', id: 'post_1' },
			],
			users: ['usr_rep', 'usr_unknown'],
		});
		assert.equal(res.status, 200);
		const { result } = (await res.json()) as { result: { items: any[]; users: any[] } };
		const [video, comment, playlist, channel, gone, post] = result.items;
		assert.deepEqual(
			{ title: video.title, channelName: video.channelName, ownerId: video.ownerId, isHidden: video.isHidden, found: video.found },
			{ title: 'A video', channelName: 'Good Channel', ownerId: 'usr_owner', isHidden: true, found: true },
		);
		assert.deepEqual(
			{ title: comment.title, parentId: comment.parentId, channelId: comment.channelId, channelName: comment.channelName, ownerId: comment.ownerId },
			{ title: 'a rude comment', parentId: 'v_1', channelId: 'ch_1', channelName: 'Good Channel', ownerId: 'usr_commenter' },
		);
		assert.equal(playlist.title, 'List');
		assert.equal(playlist.channelName, 'Good Channel');
		assert.equal(channel.ownerId, 'usr_owner');
		assert.equal(gone.found, false);
		assert.equal(post.found, false);
		const users = Object.fromEntries(result.users.map((u) => [u.id, u]));
		assert.equal(users.usr_owner.displayName, 'Owner Name');
		assert.equal(users.usr_owner.isBanned, true);
		assert.equal(users.usr_rep.displayName, 'Reporter Name');
		assert.equal(users.usr_rep.isBanned, false);
		assert.equal(users.usr_commenter.displayName, 'Commenter', 'read from R2 when the index lacks the profile');
		assert.equal(users.usr_unknown.found, false);
	});

	it('drops malformed and duplicate entries', () => {
		const clean = cleanLookup({ items: [{ type: 'video', id: 'a' }, { type: 'video', id: 'a' }, { id: 'b' } as never, null as never], users: ['u', 'u', 3 as never] });
		assert.deepEqual(clean, { items: [{ type: 'video', id: 'a' }], users: ['u'] });
	});
});
