/**
 * Public profile (Story 29.5): user @handles share the channel handle index, the profile shows
 * only public things, and each list (subscriptions, playlists, likes) follows its owner's toggle.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	PublicProfileSettingsUpdate,
	UserByHandleFetch,
	UserHandleAvailability,
	UserLikesPublicList,
	UserPlaylistsPublicList,
	UserSubscriptionsPublicList,
} from '../src/endpoints/profile/publicProfile';
import { ProfileUpdate } from '../src/endpoints/profile/profileUpdate';
import { ProfileDelete } from '../src/endpoints/profile/profileDelete';
import { checkHandleAvailability, claimHandle, resolveHandle } from '../src/lib/channelHandles';
import { PUBLIC_PROFILE_DEFAULTS, claimUserHandle, resolvePublicProfilePrivacy, resolveUserHandle } from '../src/lib/userHandles';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const T = '2026-01-01T00:00:00.000Z';
const profile = (id: string, over: Record<string, unknown> = {}) => ({
	id, email: `${id}@test.local`, displayName: `Name ${id}`, bio: 'Hello', dateCreated: T, dateModified: T,
	channels: [], watchHistory: [], subscribedTo: [], ...over,
});
const channel = (id: string, userId: string, over: Record<string, unknown> = {}) => ({
	id, userId, email: `${userId}@test.local`, name: `Channel ${id}`, isMain: false, dateCreated: T, dateModified: T,
	playlists: [], videos: [], subscribers: [], subscriptions: [], likes: [], ...over,
});
const playlist = (id: string, userId: string, over: Record<string, unknown> = {}) => ({
	id, userId, title: `List ${id}`, videos: [], isPublic: true, dateCreated: T, dateModified: T, ...over,
});

function env(over: Record<string, unknown> = {}) {
	return {
		profiles: new MemoryBucket({
			me: profile('me', { channels: ['pub', 'priv', 'gone'], subscribedTo: ['pub', 'other', 'secret'] }),
			you: profile('you'),
		}),
		channels: new MemoryBucket({
			pub: channel('pub', 'me', { handle: 'mychannel', isMain: true }),
			priv: channel('priv', 'me', { isPrivate: true }),
			gone: channel('gone', 'me', { isDeleted: true }),
			other: channel('other', 'you'),
			secret: channel('secret', 'you', { isPrivate: true }),
		}),
		channel_tabs: new MemoryBucket({
			'channel-handles/mychannel': { handle: 'mychannel', channelId: 'pub', userId: 'me', dateClaimed: T },
		}),
		playlists: new MemoryBucket({
			p1: playlist('p1', 'me'),
			p2: playlist('p2', 'me', { isPublic: false }),
			p3: playlist('p3', 'me', { isPublic: false, isUnlisted: true }),
			p4: playlist('p4', 'me', { channelId: 'pub' }),
			p5: playlist('p5', 'me', { systemType: 'watch_later' }),
			p6: playlist('p6', 'you'),
		}),
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', channelId: 'other', userId: 'you' }),
			v2: videoFixture({ id: 'v2', channelId: 'other', userId: 'you', isPublic: false }),
		}),
		queue: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(),
		...over,
	} as any;
}

function routes(r: any) {
	r.put('/api/profile/public', PublicProfileSettingsUpdate);
	r.get('/api/profile/handle-availability', UserHandleAvailability);
	r.put('/api/profile', ProfileUpdate);
	r.delete('/api/profile', ProfileDelete);
	r.get('/api/users/by-handle/:handle', UserByHandleFetch);
	r.get('/api/users/by-handle/:handle/subscriptions', UserSubscriptionsPublicList);
	r.get('/api/users/by-handle/:handle/playlists', UserPlaylistsPublicList);
	r.get('/api/users/by-handle/:handle/likes', UserLikesPublicList);
}

async function call(e: any, path: string, init: RequestInit = {}, userId: string | null = null) {
	const res = await buildApp(routes, userId ? { userId } : null).request(path, init, e);
	return { status: res.status, body: (await res.json()) as any };
}
const put = (e: any, body: unknown, userId = 'me') =>
	call(e, '/api/profile/public', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, userId);

describe('public profile settings', () => {
	it('defaults: public playlists on, subscriptions and likes off', () => {
		assert.deepEqual(resolvePublicProfilePrivacy(undefined), { showSubscriptions: false, showPlaylists: true, showLikes: false });
		assert.deepEqual(resolvePublicProfilePrivacy({ showLikes: true, showPlaylists: 'yes' as never }), { ...PUBLIC_PROFILE_DEFAULTS, showLikes: true });
	});

	it('claims a handle into the shared index and returns the profile with the settings', async () => {
		const e = env();
		const res = await put(e, { handle: '@Sara.K', showLikes: true });
		assert.equal(res.status, 200);
		assert.equal(res.body.result.profile.handle, 'Sara.K');
		assert.deepEqual(res.body.result.profile.publicProfile, { showSubscriptions: false, showPlaylists: true, showLikes: true });
		assert.equal(e.profiles.read('me').handle, 'Sara.K');
		assert.deepEqual(e.channel_tabs.read('channel-handles/sara.k').kind, 'user');
		assert.equal(e.channel_tabs.read('channel-handles/sara.k').userId, 'me');
	});

	it('one namespace: a channel handle is taken for users, a user handle for channels', async () => {
		const e = env();
		const taken = await put(e, { handle: 'MyChannel' });
		assert.equal(taken.status, 409);
		assert.equal(taken.body.reason, 'taken');
		assert.equal((await put(e, { handle: 'noor' })).status, 200);
		const availability = await checkHandleAvailability(e.channel_tabs, 'noor', undefined);
		assert.equal(availability.available, false);
		assert.equal((await checkHandleAvailability(e.channel_tabs, 'noor', 'other')).available, false);
		assert.deepEqual(await claimHandle(e.channel_tabs, 'NOOR', { id: 'other', userId: 'you' }), { ok: false, reason: 'taken' });
		assert.equal(await resolveHandle(e.channel_tabs, 'noor'), null, 'channel lookups ignore user handles');
		assert.equal(await resolveUserHandle(e.channel_tabs, 'mychannel'), null, 'user lookups ignore channel handles');
		// Another user can't take it either
		assert.equal((await put(e, { handle: 'Noor' }, 'you')).status, 409);
	});

	it('rejects bad formats and reserved words', async () => {
		const e = env();
		assert.equal((await put(e, { handle: 'ab' })).body.reason, 'too_short');
		assert.equal((await put(e, { handle: 'bad handle' })).body.reason, 'invalid_characters');
		const reserved = await put(e, { handle: 'admin' });
		assert.equal(reserved.status, 400);
		assert.equal(reserved.body.reason, 'reserved');
		assert.equal(e.profiles.read('me').handle, undefined);
	});

	it('changing the handle frees the old one; re-casing keeps it; clearing removes the profile', async () => {
		const e = env();
		await put(e, { handle: 'first' });
		assert.equal((await put(e, { handle: 'second' })).status, 200);
		assert.equal(e.channel_tabs.read('channel-handles/first'), null);
		assert.equal(e.channel_tabs.read('channel-handles/second').userId, 'me');
		assert.equal((await put(e, { handle: 'SECOND' })).body.result.profile.handle, 'SECOND');
		assert.equal(e.channel_tabs.read('channel-handles/second').handle, 'SECOND');
		assert.equal((await call(e, '/api/users/by-handle/first')).status, 404);
		assert.equal((await put(e, { handle: null })).status, 200);
		assert.equal(e.profiles.read('me').handle, undefined);
		assert.equal(e.channel_tabs.read('channel-handles/second'), null);
		assert.equal((await call(e, '/api/users/by-handle/second')).status, 404);
	});

	it('toggles alone leave the handle; PUT /api/profile cannot set a handle', async () => {
		const e = env();
		await put(e, { handle: 'mine' });
		await put(e, { showSubscriptions: true });
		assert.equal(e.profiles.read('me').handle, 'mine');
		assert.deepEqual(e.profiles.read('me').publicProfile, { showSubscriptions: true });
		await call(e, '/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: 'sneaky', bio: 'x' }) }, 'me');
		assert.equal(e.profiles.read('me').handle, 'mine');
		assert.equal(e.channel_tabs.read('channel-handles/sneaky'), null);
	});

	it('availability: own handle available, others taken, needs sign-in', async () => {
		const e = env();
		await put(e, { handle: 'mine' });
		assert.equal((await call(e, '/api/profile/handle-availability?handle=mine', {}, 'me')).body.result.available, true);
		assert.equal((await call(e, '/api/profile/handle-availability?handle=MINE', {}, 'you')).body.result.reason, 'taken');
		assert.equal((await call(e, '/api/profile/handle-availability?handle=mychannel', {}, 'you')).body.result.available, false);
		assert.equal((await call(e, '/api/profile/handle-availability?handle=mine')).status, 401);
	});

	it('a concurrent claim of the same handle has one winner', async () => {
		const e = env();
		const [a, b] = await Promise.all([claimUserHandle(e.channel_tabs, 'race', 'me'), claimUserHandle(e.channel_tabs, 'race', 'you')]);
		assert.equal([a, b].filter((r) => r.ok).length, 1);
	});

	it('deleting the profile frees the handle', async () => {
		const e = env();
		await put(e, { handle: 'leaving' });
		assert.equal((await call(e, '/api/profile', { method: 'DELETE' }, 'me')).status, 200);
		assert.equal(e.channel_tabs.read('channel-handles/leaving'), null);
	});
});

describe('public profile reads', () => {
	it('no handle, no profile; unknown and channel handles are 404', async () => {
		const e = env();
		assert.equal((await call(e, '/api/users/by-handle/me')).status, 404);
		assert.equal((await call(e, '/api/users/by-handle/mychannel')).status, 404);
	});

	it('shows name, bio and public channels only (main first), case-insensitively', async () => {
		const e = env();
		await put(e, { handle: 'Sara' });
		const res = await call(e, '/api/users/by-handle/@sARA');
		assert.equal(res.status, 200);
		const p = res.body.result.profile;
		assert.equal(p.handle, 'Sara');
		assert.equal(p.resolvedDisplayName, 'Name me');
		assert.equal(p.bio, 'Hello');
		assert.deepEqual(p.channels.map((c: any) => c.id), ['pub']);
		assert.equal(p.channels[0].handle, 'mychannel');
		assert.deepEqual(p.sections, { subscriptions: false, playlists: true, likes: false });
		assert.equal(p.email, undefined, 'never the email');
		assert.equal(p.subscribedTo, undefined);
	});

	it('a profile an admin removed is not shown', async () => {
		const e = env();
		await put(e, { handle: 'Sara' });
		e.profiles.store.set('me', JSON.stringify({ ...e.profiles.read('me'), adminDeletion: { at: T, by: 'admin' } }));
		assert.equal((await call(e, '/api/users/by-handle/sara')).status, 404);
	});

	it('subscriptions: 404 while hidden; when shown, public channels only', async () => {
		const e = env();
		await put(e, { handle: 'Sara' });
		assert.equal((await call(e, '/api/users/by-handle/sara/subscriptions')).status, 404);
		await put(e, { showSubscriptions: true });
		const res = await call(e, '/api/users/by-handle/sara/subscriptions');
		assert.equal(res.status, 200);
		assert.deepEqual(res.body.result.items.map((c: any) => c.id), ['pub', 'other']);
		assert.equal(res.body.result.hasMore, false);
		assert.equal(res.body.result.items[0].email, undefined);
	});

	it('playlists: public personal playlists only; 404 when turned off', async () => {
		const e = env();
		await put(e, { handle: 'Sara' });
		const res = await call(e, '/api/users/by-handle/sara/playlists');
		assert.equal(res.status, 200);
		assert.deepEqual(res.body.result.items.map((p: any) => p.id), ['p1']);
		// Also for the owner: this is the visitor view
		assert.deepEqual((await call(e, '/api/users/by-handle/sara/playlists', {}, 'me')).body.result.items.map((p: any) => p.id), ['p1']);
		await put(e, { showPlaylists: false });
		assert.equal((await call(e, '/api/users/by-handle/sara/playlists')).status, 404);
	});

	it('likes: 404 while hidden; when shown, public videos only', async () => {
		const e = env();
		await put(e, { handle: 'Sara' });
		e.NOTIFICATIONS_DB.raw.prepare("INSERT INTO liked_videos VALUES ('me', 'v1', 2), ('me', 'v2', 1)").run();
		assert.equal((await call(e, '/api/users/by-handle/sara/likes')).status, 404);
		await put(e, { showLikes: true });
		const res = await call(e, '/api/users/by-handle/sara/likes');
		assert.equal(res.status, 200);
		assert.deepEqual(res.body.result.items.map((v: any) => v.id), ['v1']);
	});
});
