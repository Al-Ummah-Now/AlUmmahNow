/**
 * Per-channel roles: the matrix, "my channels" with roles (owned + member,
 * served from the ownership and channel_access indexes), the members API,
 * and what a member may do as the channel (docs/specs/CHANNEL-ROLES.md).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	CHANNEL_MEMBER_ROLES,
	can,
	canDeleteVideo,
	canManageRole,
	channelMembersOf,
	channelRoleOf,
	groupChannelsByRole,
	type ChannelCapability,
	type ChannelRole,
} from '@al-ummah/shared-types';
import { withSearchSync } from '../src/lib/search/sync';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { canOnVideo, memberMayActAs, uploadIdentity } from '../src/lib/channelAccess';
import { channelIdMiddleware } from '../src/middleware/auth';
import { ChannelAccessList, ChannelMemberAdd, ChannelMemberRemove, ChannelMemberUpdate, ChannelMembersList } from '../src/endpoints/channel/channelMembers';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { ChannelOwnerFetch } from '../src/endpoints/channel/channelOwnerFetch';
import { VideoCreate } from '../src/endpoints/video/videoCreate';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { errorHandler } from '../src/middleware/error-handler';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ALL_CAPABILITIES: ChannelCapability[] = [
	'channel.view_private', 'channel.edit', 'channel.handle', 'channel.delete', 'channel.speak',
	'video.upload', 'video.view_private', 'video.edit', 'video.delete', 'video.schedule', 'post.manage', 'playlist.manage',
	'comment.moderate', 'live.manage', 'live.moderate', 'analytics.view',
	'members.view', 'members.manage', 'members.manage_admins',
];

/** Spec §4, one row per capability: owner, admin, editor, moderator. */
const MATRIX: Record<ChannelCapability, [boolean, boolean, boolean, boolean]> = {
	'channel.view_private': [true, true, false, false],
	'channel.edit': [true, true, false, false],
	'channel.handle': [true, false, false, false],
	'channel.delete': [true, false, false, false],
	'channel.speak': [true, true, true, true],
	'video.upload': [true, true, true, false],
	'video.view_private': [true, true, true, false],
	'video.edit': [true, true, true, false],
	'video.delete': [true, true, true, false],
	'video.schedule': [true, true, true, false],
	'post.manage': [true, true, true, false],
	'playlist.manage': [true, true, true, false],
	'comment.moderate': [true, true, false, true],
	'live.manage': [true, true, false, false],
	'live.moderate': [true, true, false, true],
	'analytics.view': [true, true, false, false],
	'members.view': [true, true, false, false],
	'members.manage': [true, true, false, false],
	'members.manage_admins': [true, false, false, false],
};

function channel(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id, name: `Channel ${id}`, userId: 'owner', email: 'owner@test.local', isMain: false,
		dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z',
		playlists: [], videos: [], subscribers: [], subscriptions: [], likes: [],
		...overrides,
	};
}

function member(userId: string, role: string) {
	return { userId, role, addedBy: 'owner', addedAt: '2026-11-01T00:00:00.000Z' };
}

/** Env whose R2 writes go through the search/ownership sync, over a real SQLite D1. */
function rolesEnv(channels: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const raw = {
		SEARCH_DB: db,
		videos: new MemoryBucket(),
		channels: new MemoryBucket(channels),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		profiles: new MemoryBucket({ owner: { id: 'owner', displayName: 'Owner' }, sara: { id: 'sara', displayName: 'Sara' }, omar: { id: 'omar' } }),
		channel_tabs: new MemoryBucket(),
		queue: new MemoryQueue(),
		...extra,
	};
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
	return { db, raw, env, flush: () => Promise.all(pending) };
}

function accessRows(db: SqliteD1) {
	// node:sqlite rows have a null prototype: copy them into plain objects
	return (db.db.prepare('SELECT channel_id, user_id, role FROM channel_access ORDER BY channel_id, user_id').all() as Array<{ channel_id: string; user_id: string; role: string }>).map(r => ({ ...r }));
}

const ROUTES = (r: any) => {
	r.get('/api/channels/access', ChannelAccessList);
	r.get('/api/channels/:id/members', ChannelMembersList);
	r.post('/api/channels/:id/members', ChannelMemberAdd);
	r.put('/api/channels/:id/members/:userId', ChannelMemberUpdate);
	r.delete('/api/channels/:id/members/:userId', ChannelMemberRemove);
};

const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function listAccess(env: unknown, userId: string) {
	const res = await buildApp(ROUTES, { userId }).request('/api/channels/access', {}, env as never);
	assert.equal(res.status, 200);
	assert.match(res.headers.get('cache-control') ?? '', /no-store/);
	return ((await res.json()) as { data: Array<{ id: string; role: ChannelRole; isMain: boolean; userId: string }> }).data;
}

describe('channel role matrix (shared-types)', () => {
	const roles: ChannelRole[] = ['owner', 'admin', 'editor', 'moderator'];
	for (const capability of ALL_CAPABILITIES) {
		it(`${capability}`, () => {
			roles.forEach((role, i) => assert.equal(can(role, capability), MATRIX[capability][i], `${role} / ${capability}`));
			assert.equal(can(null, capability), false);
		});
	}

	it('site roles are not channel roles: an unknown role string grants nothing', () => {
		for (const capability of ALL_CAPABILITIES) {
			assert.equal(can('super_admin' as never, capability), false);
			assert.equal(can('Super Admin' as never, capability), false);
		}
	});

	it('the owner manages every role, an admin only editors and moderators, others nothing', () => {
		for (const role of CHANNEL_MEMBER_ROLES) assert.equal(canManageRole('owner', role), true);
		assert.equal(canManageRole('admin', 'admin'), false);
		assert.equal(canManageRole('admin', 'editor'), true);
		assert.equal(canManageRole('admin', 'moderator'), true);
		assert.equal(canManageRole('editor', 'moderator'), false);
		assert.equal(canManageRole('moderator', 'moderator'), false);
	});

	it('an editor deletes only their own uploads; legacy videos without uploadedBy are not theirs', () => {
		assert.equal(canDeleteVideo('editor', { uploadedBy: 'sara' }, 'sara'), true);
		assert.equal(canDeleteVideo('editor', { uploadedBy: 'omar' }, 'sara'), false);
		assert.equal(canDeleteVideo('editor', {}, 'sara'), false);
		assert.equal(canDeleteVideo('admin', {}, 'sara'), true);
		assert.equal(canDeleteVideo('moderator', { uploadedBy: 'sara' }, 'sara'), false);
	});

	it('reads roles from the record: the owner from userId, malformed or duplicate members ignored', () => {
		const record = { userId: 'owner', members: [member('sara', 'editor'), member('sara', 'admin'), member('owner', 'admin'), { userId: 'x', role: 'owner' }, null, member('omar', 'moderator')] };
		assert.deepEqual(channelMembersOf(record).map(m => [m.userId, m.role]), [['sara', 'editor'], ['omar', 'moderator']]);
		assert.equal(channelRoleOf(record, 'owner'), 'owner');
		assert.equal(channelRoleOf(record, 'sara'), 'editor');
		assert.equal(channelRoleOf(record, 'x'), null);
		assert.equal(channelRoleOf(record, null), null);
	});

	it('groups a list into owned and managed, each channel once', () => {
		const { owned, managed } = groupChannelsByRole([
			{ id: 'b', name: 'Beta', role: 'owner' as const },
			{ id: 'a', name: 'Alpha', role: 'owner' as const, isMain: true },
			{ id: 'm2', name: 'Zed', role: 'editor' as const },
			{ id: 'm1', name: 'Yas', role: 'admin' as const },
			{ id: 'm3', name: 'Abc', role: 'moderator' as const },
			{ id: 'm2', name: 'Zed', role: 'editor' as const },
			{ id: 'b', name: 'Beta', role: 'editor' as const },
			{ id: 'n', name: 'No role', role: null },
		]);
		assert.deepEqual(owned.map(c => c.id), ['a', 'b']);
		assert.deepEqual(managed.map(c => c.id), ['m1', 'm2', 'm3']);
	});
});

describe('GET /api/channels/access (owned + channel roles)', () => {
	async function indexedEnv(channels: Record<string, unknown>) {
		const ctx = rolesEnv(channels);
		await runOwnershipPass(ctx.raw as never, 'channel', { maxPages: 10 });
		return ctx;
	}

	it('lists owned channels then managed ones with their role, from the indexes (no bucket scan)', async () => {
		const { raw, db } = await indexedEnv({
			main: channel('main', { userId: 'sara', isMain: true, name: 'Sara main' }),
			second: channel('second', { userId: 'sara', name: 'Another' }),
			team: channel('team', { members: [member('sara', 'admin')] }),
			helps: channel('helps', { userId: 'omar', members: [member('sara', 'moderator')] }),
			other: channel('other'),
			gone: channel('gone', { members: [member('sara', 'editor')], isDeleted: true }),
			hidden: channel('hidden', { members: [member('sara', 'editor')], isHidden: true }),
		});
		assert.deepEqual(accessRows(db).filter(r => r.user_id === 'sara').map(r => [r.channel_id, r.role]), [['gone', 'editor'], ['helps', 'moderator'], ['hidden', 'editor'], ['team', 'admin']]);
		raw.channels.calls = 0;
		const data = await listAccess(raw, 'sara');
		assert.deepEqual(data.map(c => [c.id, c.role]), [['main', 'owner'], ['second', 'owner'], ['helps', 'moderator'], ['team', 'admin']]);
		assert.equal(data.find(c => c.id === 'team')!.isMain, false);
		assert.equal(data.find(c => c.id === 'team')!.userId, 'owner');
		// Owned (2, deleted/hidden excluded by the index) + member rows (4): one GET each, no list
		assert.equal(raw.channels.calls, 6);
	});

	it('a site Super Admin with no channel role sees only their own channels', async () => {
		const { raw } = await indexedEnv({ team: channel('team', { members: [member('sara', 'admin')] }) });
		const res = await buildApp(ROUTES, { userId: 'staff', roles: ['Super Admin'] }).request('/api/channels/access', {}, raw as never);
		assert.deepEqual(((await res.json()) as any).data, []);
	});

	it('requires sign-in', async () => {
		const { raw } = await indexedEnv({});
		assert.equal((await buildApp(ROUTES, null).request('/api/channels/access', {}, raw as never)).status, 401);
	});

	it('grant -> listed with no duplicate; role change -> new role; revoke -> gone (index follows)', async () => {
		const { raw, env, db, flush } = await indexedEnv({ team: channel('team', { members: [] }), mine: channel('mine', { userId: 'sara', isMain: true }) });
		const owner = buildApp(ROUTES, { userId: 'owner' });
		// Writes go through the sync-wrapped env, as in production (index.ts)
		const write = (path: string, init: RequestInit) => owner.request(path, init, env as never).then(async r => { await flush(); return r; });

		assert.deepEqual((await listAccess(raw, 'sara')).map(c => c.id), ['mine']);
		const granted = await write('/api/channels/team/members', { method: 'POST', ...json({ userId: 'sara', role: 'admin' }) });
		assert.equal(granted.status, 200);
		assert.deepEqual(accessRows(db), [{ channel_id: 'team', user_id: 'sara', role: 'admin' }]);
		assert.deepEqual((await listAccess(raw, 'sara')).map(c => [c.id, c.role]), [['mine', 'owner'], ['team', 'admin']]);

		// Granting again is refused, not duplicated
		const again = await write('/api/channels/team/members', { method: 'POST', ...json({ userId: 'sara', role: 'editor' }) });
		assert.equal(again.status, 409);
		assert.equal(((await again.json()) as any).code, 'already_member');
		assert.equal((await listAccess(raw, 'sara')).filter(c => c.id === 'team').length, 1);

		assert.equal((await write('/api/channels/team/members/sara', { method: 'PUT', ...json({ role: 'editor' }) })).status, 200);
		assert.deepEqual(accessRows(db), [{ channel_id: 'team', user_id: 'sara', role: 'editor' }]);
		assert.equal((await listAccess(raw, 'sara')).find(c => c.id === 'team')!.role, 'editor');

		assert.equal((await write('/api/channels/team/members/sara', { method: 'DELETE' })).status, 200);
		assert.deepEqual(accessRows(db), []);
		assert.deepEqual((await listAccess(raw, 'sara')).map(c => c.id), ['mine']);
	});

	it('a stale index row grants nothing: the role is re-read from the record', async () => {
		const { raw, db } = await indexedEnv({ team: channel('team') });
		db.db.prepare("INSERT INTO channel_access (channel_id, user_id, role, source_version) VALUES ('team', 'sara', 'admin', 0)").run();
		assert.deepEqual(await listAccess(raw, 'sara'), []);
	});

	it('falls back to a bounded scan (and still finds roles) while the index is incomplete', async () => {
		const { raw } = rolesEnv({ team: channel('team', { members: [member('sara', 'editor')] }), mine: channel('mine', { userId: 'sara' }) });
		const data = await listAccess({ ...raw, SEARCH_DB: undefined }, 'sara');
		assert.deepEqual(data.map(c => [c.id, c.role]), [['mine', 'owner'], ['team', 'editor']]);
	});

	it('an older copy of the channel synced late does not bring a revoked role back', async () => {
		const { raw, db } = await indexedEnv({ team: channel('team', { members: [member('sara', 'editor')] }) });
		const { syncOwnership } = await import('@al-ummah/shared-types');
		await syncOwnership(db as never, 'channel', 'team', channel('team', { members: [] }), Date.now(), 2_000_000_000_000);
		await syncOwnership(db as never, 'channel', 'team', channel('team', { members: [member('sara', 'editor')] }), Date.now(), 1_000_000_000_000);
		assert.deepEqual(accessRows(db), []);
		void raw;
	});
});

describe('members API rules', () => {
	const env = () => rolesEnv({
		team: channel('team', { members: [member('admin1', 'admin'), member('ed', 'editor')] }),
		saraMain: channel('saraMain', { userId: 'sara', handle: 'SaraTalks' }),
	}, { channel_tabs: new MemoryBucket({ 'channel-handles/saratalks': { channelId: 'saraMain', handle: 'SaraTalks' } }) });

	it('grants by @handle (resolves to that channel\'s owner)', async () => {
		const { raw } = env();
		const res = await buildApp(ROUTES, { userId: 'owner' }).request('/api/channels/team/members', { method: 'POST', ...json({ handle: '@saratalks', role: 'moderator' }) }, raw as never);
		assert.equal(res.status, 200);
		assert.equal(channelRoleOf(raw.channels.read('team'), 'sara'), 'moderator');
	});

	it('an unknown handle is a 404 with a code, not an internal error', async () => {
		const { raw } = env();
		const res = await buildApp(ROUTES, { userId: 'owner' }).request('/api/channels/team/members', { method: 'POST', ...json({ handle: 'nobody', role: 'editor' }) }, raw as never);
		assert.equal(res.status, 404);
		assert.equal(((await res.json()) as any).code, 'person_not_found');
	});

	it('a channel admin grants editors but not admins; an editor grants nothing', async () => {
		const { raw } = env();
		const asAdmin = buildApp(ROUTES, { userId: 'admin1' });
		assert.equal((await asAdmin.request('/api/channels/team/members', { method: 'POST', ...json({ userId: 'sara', role: 'admin' }) }, raw as never)).status, 403);
		assert.equal((await asAdmin.request('/api/channels/team/members', { method: 'POST', ...json({ userId: 'sara', role: 'editor' }) }, raw as never)).status, 200);
		assert.equal((await buildApp(ROUTES, { userId: 'ed' }).request('/api/channels/team/members', { method: 'POST', ...json({ userId: 'omar', role: 'moderator' }) }, raw as never)).status, 403);
	});

	it('an admin cannot remove another admin or the owner; nobody gives the owner a member role', async () => {
		const { raw } = env();
		const owner = buildApp(ROUTES, { userId: 'owner' });
		await owner.request('/api/channels/team/members', { method: 'POST', ...json({ userId: 'sara', role: 'admin' }) }, raw as never);
		const asAdmin = buildApp(ROUTES, { userId: 'admin1' });
		assert.equal((await asAdmin.request('/api/channels/team/members/sara', { method: 'DELETE' }, raw as never)).status, 403);
		assert.equal((await asAdmin.request('/api/channels/team/members/owner', { method: 'DELETE' }, raw as never)).status, 403);
		const ownerGrant = await owner.request('/api/channels/team/members', { method: 'POST', ...json({ userId: 'owner', role: 'admin' }) }, raw as never);
		assert.equal(ownerGrant.status, 409);
		assert.equal(((await ownerGrant.json()) as any).code, 'cannot_invite_owner');
	});

	it('any member may leave; leaving takes the channel out of their list', async () => {
		const { raw } = env();
		assert.equal((await buildApp(ROUTES, { userId: 'ed' }).request('/api/channels/team/members/ed', { method: 'DELETE' }, raw as never)).status, 200);
		assert.equal(channelRoleOf(raw.channels.read('team'), 'ed'), null);
	});

	it('the member list (owner first) shows to owner and admins only', async () => {
		const { raw } = env();
		const res = await buildApp(ROUTES, { userId: 'admin1' }).request('/api/channels/team/members', {}, raw as never);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.deepEqual(body.data.members.map((m: any) => [m.userId, m.role, m.isYou]), [['owner', 'owner', false], ['admin1', 'admin', true], ['ed', 'editor', false]]);
		assert.equal(body.data.members[0].displayName, 'Owner');
		assert.equal((await buildApp(ROUTES, { userId: 'ed' }).request('/api/channels/team/members', {}, raw as never)).status, 403);
	});
});

describe('acting as a channel with a role', () => {
	it('memberMayActAs: reads pass, writes need the listed capability, unlisted writes stay owner only', () => {
		assert.equal(memberMayActAs('moderator', 'GET', '/api/videos'), true);
		assert.equal(memberMayActAs('editor', 'POST', '/api/videos/upload/initiate'), true);
		assert.equal(memberMayActAs('moderator', 'POST', '/api/videos/upload/initiate'), false);
		assert.equal(memberMayActAs('editor', 'PATCH', '/api/videos/tus/abc'), true);
		assert.equal(memberMayActAs('editor', 'PUT', '/api/videos/v1'), true);
		assert.equal(memberMayActAs('moderator', 'PUT', '/api/videos/v1'), false);
		assert.equal(memberMayActAs('editor', 'PUT', '/api/channels/team'), false);
		assert.equal(memberMayActAs('admin', 'PUT', '/api/channels/team'), true);
		assert.equal(memberMayActAs('moderator', 'POST', '/api/videos/v1/comments/c1/approve'), true);
		assert.equal(memberMayActAs('moderator', 'POST', '/api/videos/v1/likes'), true);
		// Not listed: live streams, editing or deleting a playlist, posts, channel delete
		assert.equal(memberMayActAs('admin', 'POST', '/api/live-streams'), false);
		assert.equal(memberMayActAs('admin', 'PATCH', '/api/playlists/p1'), false);
		// Creating a playlist and adding videos need playlist.manage
		assert.equal(memberMayActAs('admin', 'POST', '/api/playlists'), true);
		assert.equal(memberMayActAs('moderator', 'POST', '/api/playlists'), false);
		assert.equal(memberMayActAs('admin', 'DELETE', '/api/channels/team'), false);
		assert.equal(memberMayActAs(null, 'GET', '/api/videos'), false);
		assert.equal(memberMayActAs('owner', 'POST', '/api/live-streams'), true);
	});

	/** App with the production channelId middleware in front of the routes. */
	function appWith(register: (r: any) => void, userId: string) {
		const app = new Hono();
		app.onError(errorHandler);
		app.use('*', async (c, next) => {
			c.set('auth' as never, { userId, email: `${userId}@test.local`, payload: {} } as never);
			c.set('userId' as never, userId as never);
			await next();
		});
		app.use('/api/*', channelIdMiddleware);
		register(fromHono(app));
		return app;
	}

	const teamEnv = () => {
		const videos = new MemoryBucket({
			v1: videoFixture({ id: 'v1', userId: 'owner', channelId: 'team', isPublic: false }),
			v2: videoFixture({ id: 'v2', userId: 'owner', channelId: 'other', isPublic: false }),
		});
		const channels = new MemoryBucket({
			team: channel('team', { members: [member('ed', 'editor'), member('mod', 'moderator'), member('adm', 'admin')] }),
			other: channel('other'),
		});
		return { videos, channels, profiles: new MemoryBucket(), queue: new MemoryQueue() };
	};

	it('as an editor, the middleware passes the channel owner on, so new videos are owned by them and record the uploader', async () => {
		const env = teamEnv();
		const probe = (userId: string) => appWith(r => r.post('/api/videos/upload/initiate', class extends VideoCreate {
			async handle(c: any) { return c.json(uploadIdentity(c, userId)); }
		}), userId).request('/api/videos/upload/initiate', { method: 'POST', headers: { 'content-type': 'application/json', channelId: 'team' }, body: JSON.stringify({ title: 'x' }) }, env as never);
		assert.deepEqual(await (await probe('ed')).json(), { ownerId: 'owner', uploadedBy: 'ed' });
		assert.deepEqual(await (await probe('owner')).json(), { ownerId: 'owner' });
		assert.equal((await probe('mod')).status, 403);
	});

	it('a moderator cannot create a video as the channel; a stranger cannot act as it at all', async () => {
		const env = teamEnv();
		const body = { method: 'POST', headers: { 'content-type': 'application/json', channelId: 'team' }, body: JSON.stringify({ title: 'Nope' }) };
		assert.equal((await appWith(r => r.post('/api/videos', VideoCreate), 'mod').request('/api/videos', body, env as never)).status, 403);
		assert.equal((await appWith(r => r.post('/api/videos', VideoCreate), 'stranger').request('/api/videos', body, env as never)).status, 403);
		const reads = await appWith(r => r.get('/api/videos/:id', VideoFetch), 'stranger').request('/api/videos/v1', { headers: { channelId: 'team' } }, env as never);
		assert.equal(reads.status, 403);
	});

	it('an editor edits and sees the channel\'s private video; a moderator cannot edit it; no access to other channels', async () => {
		const env = teamEnv();
		const update = (userId: string, id: string) => appWith(r => r.put('/api/videos/:id', VideoUpdate), userId)
			.request(`/api/videos/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `Edited by ${userId}` }) }, env as never);
		assert.equal((await update('ed', 'v1')).status, 200);
		assert.equal(env.videos.read('v1').title, 'Edited by ed');
		assert.equal(env.videos.read('v1').userId, 'owner', 'ownership is unchanged');
		assert.equal((await update('mod', 'v1')).status, 403);
		assert.equal((await update('ed', 'v2')).status, 403);
		const fetchAs = (userId: string) => appWith(r => r.get('/api/videos/:id', VideoFetch), userId).request('/api/videos/v1', {}, env as never);
		assert.equal((await fetchAs('ed')).status, 200);
		assert.equal((await fetchAs('mod')).status, 404);
	});

	it('canOnVideo: delete follows the editor rule; legacy videos without a channel stay owner only', async () => {
		const env = teamEnv();
		assert.equal(await canOnVideo(env as never, { userId: 'owner', channelId: 'team', uploadedBy: 'ed' }, 'ed', 'video.delete'), true);
		assert.equal(await canOnVideo(env as never, { userId: 'owner', channelId: 'team' }, 'ed', 'video.delete'), false);
		assert.equal(await canOnVideo(env as never, { userId: 'owner', channelId: 'team' }, 'adm', 'video.delete'), true);
		assert.equal(await canOnVideo(env as never, { userId: 'owner', channelId: null }, 'adm', 'video.edit'), false);
		assert.equal(await canOnVideo(env as never, { userId: 'owner', channelId: 'missing' }, 'adm', 'video.edit'), false);
		assert.equal(await canOnVideo(env as never, { userId: 'owner' }, null, 'video.edit'), false);
	});

	it('a channel admin edits the channel but not its @handle; an editor cannot edit it', async () => {
		const env = { ...teamEnv(), channel_tabs: new MemoryBucket() };
		const put = (userId: string, body: unknown) => appWith(r => r.put('/api/channels/:id', ChannelUpdate), userId)
			.request('/api/channels/team', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env as never);
		assert.equal((await put('adm', { description: 'Updated by the admin' })).status, 200);
		assert.equal(env.channels.read('team').description, 'Updated by the admin');
		assert.equal(env.channels.read('team').userId, 'owner');
		assert.equal(env.channels.read('team').members.length, 3, 'members survive an edit');
		assert.equal((await put('adm', { handle: 'newhandle' })).status, 403);
		assert.equal((await put('adm', { isMain: true })).status, 403);
		assert.equal((await put('ed', { description: 'Nope' })).status, 403);
	});

	it('the owner view (channel settings form) opens for the owner and a channel admin only', async () => {
		const env = teamEnv();
		const get = (userId: string) => appWith(r => r.get('/api/channels/:id/owner', ChannelOwnerFetch), userId)
			.request('/api/channels/team/owner', {}, env as never);
		assert.equal((await get('owner')).status, 200);
		const adminView = await get('adm');
		assert.equal(adminView.status, 200);
		assert.equal(((await adminView.json()) as { members?: unknown }).members, undefined, 'the view never carries the members list');
		assert.equal((await get('ed')).status, 403);
		assert.equal((await get('stranger')).status, 403);
	});
});
