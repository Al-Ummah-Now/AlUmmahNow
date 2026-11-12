/**
 * Public channel and profile responses are built from an allow-list, so account
 * details in the stored record never reach anonymous callers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelFetch } from '../src/endpoints/channel/channelFetch';
import { ChannelOwnerFetch } from '../src/endpoints/channel/channelOwnerFetch';
import { ChannelsList } from '../src/endpoints/channel/channelList';
import { ChannelByHandleFetch } from '../src/endpoints/channel/channelHandle';
import { SubscriptionsList } from '../src/endpoints/channel/SubscriptionsList';
import { ProfileFetch } from '../src/endpoints/profile/profileFetch';
import { ProfilesList } from '../src/endpoints/profile/profileList';
import { ProfileCurrentFetch } from '../src/endpoints/profile/profileCurrentFetch';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { toPublicChannel, toPublicProfile } from '../src/lib/public-views';
import { handleKey } from '../src/lib/channelHandles';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const OWNER_EMAIL = 'owner.account@example.org';

const channel = {
	id: 'ch1',
	userId: 'owner',
	email: OWNER_EMAIL,
	contactEmail: 'published@example.org',
	name: 'Channel',
	handle: 'Channel1',
	isMain: true,
	dateCreated: '2026-01-01T00:00:00.000Z',
	dateModified: '2026-01-01T00:00:00.000Z',
	playlists: ['p1'],
	videos: ['v1'],
	subscribers: [{ id: 's1', userId: 'fan', channelId: 'fan-ch', entityId: 'ch1', dateCreated: '2026-01-01T00:00:00.000Z' }],
	subscriptions: [],
	likes: [],
	hiddenReason: 'moderator note',
	internalNote: 'a field added to the record later',
};

const profile = {
	id: 'owner',
	email: OWNER_EMAIL,
	userName: 'owner',
	displayName: 'Owner',
	firstName: 'Legal',
	lastName: 'Name',
	timezone: 'Asia/Dubai',
	dateCreated: '2026-01-01T00:00:00.000Z',
	dateModified: '2026-01-01T00:00:00.000Z',
	channels: ['ch1'],
	watchHistory: [{ videoId: 'v9', watchedAt: '2026-01-01T00:00:00.000Z', completed: false }],
	subscribedTo: ['ch1'],
};

function env() {
	return {
		channels: new MemoryBucket({ ch1: channel }),
		profiles: new MemoryBucket({ owner: profile }),
		videos: new MemoryBucket({ v1: videoFixture({ channelId: 'ch1', uploadStatus: 'ready' }) }),
		channel_tabs: new MemoryBucket({ [handleKey('Channel1')]: { handle: 'Channel1', channelId: 'ch1', userId: 'owner', dateClaimed: '2026-01-01T00:00:00.000Z' } }),
		queue: new MemoryQueue(),
	};
}

function assertNoAccountDetails(body: unknown) {
	const text = JSON.stringify(body);
	assert.ok(!/"email"\s*:/.test(text), `has an email key: ${text}`);
	assert.ok(!text.includes(OWNER_EMAIL), `has the owner address: ${text}`);
}

describe('public channel output', () => {
	it('toPublicChannel returns exactly the allow-listed fields', () => {
		assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(toPublicChannel(channel as never)))).sort(), [
			'dateCreated', 'dateModified', 'handle', 'id', 'isMain', 'isVerified', 'likesCount', 'name', 'playlistsCount',
			'subscribersCount', 'subscriptionsCount', 'userId', 'videosCount',
		]);
	});

	it('GET /api/channels/:id has no account details, signed out or signed in', async () => {
		for (const auth of [null, { userId: 'owner' }, { userId: 'someone' }]) {
			const app = buildApp((r) => r.get('/api/channels/:id', ChannelFetch), auth);
			const res = await app.request('/api/channels/ch1', {}, env());
			assert.equal(res.status, 200);
			const body = await res.json() as Record<string, unknown>;
			assertNoAccountDetails(body);
			for (const key of ['contactEmail', 'subscribers', 'internalNote', 'hiddenReason']) assert.ok(!(key in body), key);
			assert.equal(body.subscribersCount, 1);
		}
	});

	it('GET /api/channels and /by-handle have no account details', async () => {
		const app = buildApp((r) => {
			r.get('/api/channels', ChannelsList);
			r.get('/api/channels/by-handle/:handle', ChannelByHandleFetch);
		}, null);
		const list = await app.request('/api/channels?limit=10', {}, env());
		const listBody = await list.json() as { data: unknown[] };
		assert.equal(listBody.data.length, 1);
		assertNoAccountDetails(listBody);
		const byHandle = await app.request('/api/channels/by-handle/Channel1', {}, env());
		assert.equal(byHandle.status, 200);
		assertNoAccountDetails(await byHandle.json());
	});

	it('GET /api/profile/subscriptions has no account details of other owners', async () => {
		const e = env();
		await e.profiles.put('fan', JSON.stringify({ ...profile, id: 'fan', subscribedTo: ['ch1'] }));
		const app = buildApp((r) => r.get('/api/profile/subscriptions', SubscriptionsList), { userId: 'fan' });
		const res = await app.request('/api/profile/subscriptions', {}, e);
		const body = await res.json() as { data: unknown[] };
		assert.equal(body.data.length, 1);
		assertNoAccountDetails(body);
	});

	it('GET /api/videos/:id has no channel account details', async () => {
		const app = buildApp((r) => r.get('/api/videos/:id', VideoFetch), null);
		const res = await app.request('/api/videos/v1', {}, env());
		assert.equal(res.status, 200);
		assertNoAccountDetails(await res.json());
	});
});

describe('GET /api/channels/:id/owner', () => {
	const request = (auth: { userId: string; roles?: string[] } | null) =>
		buildApp((r) => r.get('/api/channels/:id/owner', ChannelOwnerFetch), auth).request('/api/channels/ch1/owner', {}, env());

	it('rejects anonymous callers and other users', async () => {
		assert.equal((await request({ userId: 'someone' })).status, 403);
		assert.equal((await request(null)).status, 401);
	});

	it('returns private fields to the owner and to admins, uncached', async () => {
		for (const auth of [{ userId: 'owner' }, { userId: 'staff', roles: ['Admin'] }]) {
			const res = await request(auth);
			assert.equal(res.status, 200);
			assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
			const body = await res.json() as Record<string, unknown>;
			assert.equal(body.email, OWNER_EMAIL);
			assert.equal(body.contactEmail, 'published@example.org');
		}
	});
});

describe('public profile output', () => {
	it('toPublicProfile returns exactly the allow-listed fields', () => {
		assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(toPublicProfile(profile as never)))).sort(), [
			'channelsCount', 'dateCreated', 'dateModified', 'displayName', 'id', 'resolvedDisplayName', 'userName',
		]);
	});

	// Owner rule 2026-11-12: "display name should be the first and last as a fallback"
	it('a profile with only first and last names shows them as its display name, without the raw fields or the email', async () => {
		const namesOnly = { ...profile, id: 'names', userName: undefined, displayName: '', displayNameLocalized: { en: '', ar: ' ' }, firstName: 'Mahmoud', lastName: 'Darwish', firstNameLocalized: { ar: 'محمود' }, lastNameLocalized: { ar: 'درويش' } };
		const app = buildApp((r) => {
			r.get('/api/profiles', ProfilesList);
			r.get('/api/profiles/:id', ProfileFetch);
		}, null);
		const e = { ...env(), profiles: new MemoryBucket({ names: namesOnly }) };
		const res = await app.request('/api/profiles/names', {}, e);
		assert.equal(res.status, 200);
		const body = await res.json() as { result: { profile: Record<string, unknown> } };
		assert.equal(body.result.profile.displayName, 'Mahmoud Darwish');
		assert.equal(body.result.profile.resolvedDisplayName, 'Mahmoud Darwish');
		for (const key of ['firstName', 'lastName', 'firstNameLocalized', 'lastNameLocalized', 'email']) assert.ok(!(key in body.result.profile), key);
		assertNoAccountDetails(body);

		const ar = await (await app.request('/api/profiles/names?lang=ar', {}, e)).json() as { result: { profile: Record<string, unknown> } };
		assert.equal(ar.result.profile.displayName, 'محمود درويش');

		const list = await (await app.request('/api/profiles?limit=10', {}, e)).json() as { result: { profiles?: Array<Record<string, unknown>> } } & Record<string, unknown>;
		assert.ok(JSON.stringify(list).includes('"displayName":"Mahmoud Darwish"'));
	});

	it('a profile with no name at all has an empty resolved name, never the email', () => {
		const view = toPublicProfile({ ...profile, userName: undefined, displayName: ' ', firstName: '', lastName: '' } as never);
		assert.equal(view.resolvedDisplayName, '');
		assert.equal(view.displayName, undefined);
	});

	it('GET /api/profile keeps the typed display name for the edit form and adds the resolved one', async () => {
		const owner = buildApp((r) => r.get('/api/profile', ProfileCurrentFetch), { userId: 'owner' });
		const e = { ...env(), profiles: new MemoryBucket({ owner: { ...profile, displayName: '', userName: undefined, firstName: 'Mahmoud', lastName: 'Darwish' } }) };
		const body = await (await owner.request('/api/profile', {}, e)).json() as { result: { profile: Record<string, unknown> } };
		assert.equal(body.result.profile.displayName, '');
		assert.equal(body.result.profile.resolvedDisplayName, 'Mahmoud Darwish');
		assert.equal(body.result.profile.email, OWNER_EMAIL);
	});

	it('GET /api/profiles and /api/profiles/:id have no account details, even for the profile owner', async () => {
		for (const auth of [null, { userId: 'owner' }]) {
			const app = buildApp((r) => {
				r.get('/api/profiles', ProfilesList);
				r.get('/api/profiles/:id', ProfileFetch);
			}, auth);
			const list = await app.request('/api/profiles?limit=10', {}, env());
			assertNoAccountDetails(await list.json());
			const res = await app.request('/api/profiles/owner', {}, env());
			assert.equal(res.status, 200);
			const body = await res.json() as { result: { profile: Record<string, unknown> } };
			assertNoAccountDetails(body);
			for (const key of ['firstName', 'lastName', 'timezone']) assert.ok(!(key in body.result.profile), key);
		}
	});

	it('GET /api/profile returns account details to the signed-in user only', async () => {
		const owner = buildApp((r) => r.get('/api/profile', ProfileCurrentFetch), { userId: 'owner' });
		const res = await owner.request('/api/profile', {}, env());
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
		const body = await res.json() as { result: { profile: { email: string } } };
		assert.equal(body.result.profile.email, OWNER_EMAIL);

		const anonymous = buildApp((r) => r.get('/api/profile', ProfileCurrentFetch), null);
		assert.equal((await anonymous.request('/api/profile', {}, env())).status, 401);
	});
});
