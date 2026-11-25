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
	db.db.prepare("UPDATE content_ownership SET email = 'rep@example.com' WHERE kind = 'profile' AND id = 'usr_rep'").run();
	db.db.prepare('INSERT INTO admin_comments (video_id, comment_id, user_id, channel_id, text) VALUES (?, ?, ?, ?, ?)').run('v_1', 'c_1', 'usr_commenter', null, '  a   rude comment ');
	db.db.prepare('INSERT INTO videos_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)').run('usr_owner', 'x', 'admin', '2026-01-01T00:00:00Z');
	db.db.prepare("INSERT INTO channel_comments (comment_id, channel_id, target_kind, target_id, author_user_id, status, created_at, updated_at) VALUES ('pc_1', 'ch_1', 'post', 'post_1', 'usr_commenter', 'published', '', '')").run();
	db.db.prepare("INSERT INTO channel_comments (comment_id, channel_id, target_kind, target_id, author_user_id, status, created_at, updated_at) VALUES ('c_2', 'ch_1', 'video', 'v_1', 'usr_rep', 'held', '', '')").run();
	db.db.prepare('INSERT INTO admin_comments (video_id, comment_id, user_id, channel_id, text, status) VALUES (?, ?, ?, ?, ?, ?)').run('v_1', 'c_2', 'usr_rep', null, 'held comment', 'held');
	const community_posts = new MemoryBucket({
		'post-locations/post_1': { channelId: 'ch_1' },
		'posts/ch_1/post_1.json': { id: 'post_1', userId: 'usr_owner', channelId: 'ch_1', content: 'A  post', status: 'published' },
		'comments/post_1/top-level/pc_1.json': { id: 'pc_1', postId: 'post_1', userId: 'usr_commenter', content: 'a post comment' },
	});
	const profiles = new MemoryBucket({ usr_commenter: { displayName: 'Commenter', email: 'commenter@example.com' } });
	const playlists = new MemoryBucket({ p_1: { id: 'p_1', title: 'List', userId: 'usr_rep', channelId: 'ch_1' } });
	const app = new Hono();
	app.route('/internal/admin', adminRouter as never);
	const env = { SEARCH_DB: db, profiles, playlists, community_posts };
	const call = (json: unknown) =>
		app.request('/internal/admin/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }, env as never);
	return Object.assign(call, { db });
}

describe('admin lookup', () => {
	it('reads a comment by a key or an index, never the whole table', async () => {
		const call = seed();
		const seen: string[] = [];
		const prepare = call.db.prepare.bind(call.db);
		(call.db as any).prepare = (sql: string) => (seen.push(sql), prepare(sql));
		// c_1 is on no channel (looked for by id alone), c_2 is, c_9 is nowhere
		await call({ items: ['c_1', 'c_2', 'c_9'].map((id) => ({ type: 'comment', id })), users: [] });
		const reads = seen.filter((sql) => /admin_comments/.test(sql));
		assert.equal(reads.length, 2);
		for (const sql of reads) {
			const plan = call.db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('[]').map((r: any) => String(r.detail));
			assert.ok(plan.some((d) => /^SEARCH c USING/.test(d)) && !plan.some((d) => /^SCAN c\b/.test(d)), plan.join(' | '));
		}
		assert.ok(reads.some((sql) => call.db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('[]').some((r: any) => /idx_admin_comments_comment/.test(r.detail))));
	});

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
				{ type: 'comment', id: 'pc_1' },
				{ type: 'comment', id: 'c_2' },
				{ type: 'post', id: 'post_9' },
			],
			users: ['usr_rep', 'usr_unknown'],
		});
		assert.equal(res.status, 200);
		const { result } = (await res.json()) as { result: { items: any[]; users: any[] } };
		const [video, comment, playlist, channel, gone, post, postComment, held, noPost] = result.items;
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
		const of = (i: any) => ({ found: i.found, title: i.title, parentId: i.parentId, parentType: i.parentType, channelName: i.channelName, ownerId: i.ownerId, isHidden: i.isHidden });
		assert.deepEqual(of(post), { found: true, title: 'A post', parentId: null, parentType: undefined, channelName: 'Good Channel', ownerId: 'usr_owner', isHidden: false });
		assert.deepEqual(of(postComment), { found: true, title: 'a post comment', parentId: 'post_1', parentType: 'post', channelName: 'Good Channel', ownerId: 'usr_commenter', isHidden: false });
		assert.deepEqual(of(held), { found: true, title: 'held comment', parentId: 'v_1', parentType: 'video', channelName: 'Good Channel', ownerId: 'usr_rep', isHidden: true });
		assert.equal(noPost.found, false);
		const users = Object.fromEntries(result.users.map((u) => [u.id, u]));
		assert.equal(users.usr_owner.displayName, 'Owner Name');
		assert.equal(users.usr_owner.isBanned, true);
		assert.equal(users.usr_rep.displayName, 'Reporter Name');
		assert.equal(users.usr_rep.isBanned, false);
		assert.equal(users.usr_commenter.displayName, 'Commenter', 'read from R2 when the index lacks the profile');
		assert.equal(users.usr_rep.email, 'rep@example.com', 'the email for admin pages (#745)');
		assert.equal(users.usr_commenter.email, 'commenter@example.com');
		assert.equal(users.usr_unknown.found, false);
		assert.equal(users.usr_unknown.email, null);
	});

	it('drops malformed and duplicate entries', () => {
		const clean = cleanLookup({ items: [{ type: 'video', id: 'a' }, { type: 'video', id: 'a' }, { id: 'b' } as never, null as never], users: ['u', 'u', 3 as never] });
		assert.deepEqual(clean, { items: [{ type: 'video', id: 'a' }], users: ['u'] });
	});
});
