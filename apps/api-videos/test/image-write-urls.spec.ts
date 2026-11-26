import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelCreate } from '../src/endpoints/channel/channelCreate';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { PlaylistCreate } from '../src/endpoints/playlist/playlistCreate';
import { PlaylistUpdate } from '../src/endpoints/playlist/playlistUpdate';
import { ProfileCreate } from '../src/endpoints/profile/profileCreate';
import { ProfileUpdate } from '../src/endpoints/profile/profileUpdate';
import { recordImageOwner } from '../src/lib/csam/imageOwners';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ME = 'owner';
const IMAGE = 'https://images.alummahnow.net';
const LEGACY = 'https://legacy.example/image.jpg';
const UPLOAD = IMAGE + '/mine.jpg';
const FIELDS = ['avatarUrl', 'coverUrl', 'thumbnailUrl'] as const;
const MEDIA = 'media.example.test';

function setup({ profileExists = true, actorId = ME } = {}) {
	const record = { id: 'old', userId: ME, name: 'Old channel', title: 'Old playlist', videos: [], dateCreated: '2026-01-01T00:00:00.000Z' };
	const oldImages = Object.fromEntries(FIELDS.map((key) => [key, LEGACY]));
	const db = new SqliteD1();
	const SEARCH_DB = db as unknown as D1Database;
	const env = {
		SEARCH_DB, MEDIA_PUBLIC_HOST: MEDIA, queue: new MemoryQueue(),
		channels: new MemoryBucket({ old: { ...record, ...oldImages } }),
		playlists: new MemoryBucket({ old: { ...record, ...oldImages } }),
		profiles: new MemoryBucket(profileExists ? { [ME]: { id: ME, ...oldImages } } : {}),
		channel_tabs: new MemoryBucket(),
	};
	const app = buildApp((r) => {
		r.post('/channels', ChannelCreate);
		r.patch('/channels/:id', ChannelUpdate);
		r.post('/playlists', PlaylistCreate);
		r.patch('/playlists/:id', PlaylistUpdate);
		r.post('/profiles', ProfileCreate);
		r.patch('/profiles', ProfileUpdate);
	}, { userId: actorId, email: 'owner@example.test' });
	const send = (path: string, method: string, input: object) => app.request(path, {
		method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
	}, env);
	return { db, env, send, upload: (url: string, ownerId = ME) => recordImageOwner(SEARCH_DB, url, { kind: 'profile_avatar', ownerId }) };
}

const routes = [
	{ kind: 'channel', method: 'POST', path: '/channels', fields: FIELDS.slice(0, 2), input: { name: 'New channel' }, bucket: 'channels' },
	{ kind: 'channel', method: 'PATCH', path: '/channels/old', fields: FIELDS.slice(0, 2), input: {}, bucket: 'channels', key: 'old' },
	{ kind: 'playlist', method: 'POST', path: '/playlists', fields: FIELDS.slice(2), input: { title: 'New playlist' }, bucket: 'playlists' },
	{ kind: 'playlist', method: 'PATCH', path: '/playlists/old', fields: FIELDS.slice(2), input: {}, bucket: 'playlists', key: 'old' },
	{ kind: 'profile', method: 'POST', path: '/profiles', fields: FIELDS.slice(0, 2), input: {}, bucket: 'profiles', key: ME },
	{ kind: 'profile', method: 'PATCH', path: '/profiles', fields: FIELDS.slice(0, 2), input: {}, bucket: 'profiles', key: ME },
] as const;

for (const { kind, method, path, fields, input, bucket, key } of routes) {
	describe(`${method} ${path}`, () => {
		for (const field of fields) {
			it(`checks ${field} against the image host and the authenticated uploader`, async () => {
				const { db, env, send, upload } = setup();
				await upload(UPLOAD);
				await upload(IMAGE + '/other.jpg', 'another-account');
				db.db.prepare("INSERT INTO image_owners (path, kind, owner_id, created_at) VALUES ('/legacy.jpg', 'profile_avatar', ?, '2026-01-01T00:00:00.000Z')").run(ME);
				for (const url of [
					'https://outside.example/mine.jpg', IMAGE + '.outside.example/mine.jpg',
					'https://images.alummahnow.net@outside.example/mine.jpg',
					'https://outside.example@images.alummahnow.net/mine.jpg',
					'https://images.alummahnow.net:444/mine.jpg', 'http://images.alummahnow.net/mine.jpg',
					'//images.alummahnow.net/mine.jpg', 'data:image/png;base64,eA==',
					IMAGE + '/unknown.jpg', IMAGE + '/other.jpg', IMAGE + '/legacy.jpg',
				]) {
					const response = await send(path, method, { ...input, [field]: url });
					assert.equal(response.status, 400, url);
					assert.deepEqual(await response.json(), { success: false, code: 'invalid_request', field });
					if (key) assert.equal(env[bucket].read(key)[field], LEGACY);
				}
				const response = await send(path, method, { ...input, [field]: UPLOAD });
				assert.equal(response.status, 200, await response.clone().text());
				const data = await response.json() as { result: Record<string, { id: string }> };
				assert.equal(env[bucket].read(key ?? data.result[kind].id)[field], UPLOAD);
			});
		}

		it('accepts omitted fields and both clearing values', async () => {
			for (const value of [undefined, null, '']) {
				const { env, send } = setup();
				const response = await send(path, method, { ...input, ...Object.fromEntries(fields.map((field) => [field, value])) });
				assert.equal(response.status, 200, await response.clone().text());
				const data = await response.json() as { result: Record<string, { id: string }> };
				for (const field of fields) assert.equal(env[bucket].read(key ?? data.result[kind].id)[field], value === undefined ? (key ? LEGACY : undefined) : '');
			}
		});

		if (key) {
			it('accepts the existing value only in the field that already holds it', async () => {
				const { env, send } = setup();
				const record = env[bucket].read(key);
				record[fields[0]] = LEGACY;
				if (fields[1]) record[fields[1]] = 'https://other.example/cover.jpg';
				await env[bucket].put(key, JSON.stringify(record));
				assert.equal((await send(path, method, { ...input, [fields[0]]: LEGACY })).status, 200);
				if (fields[1]) assert.equal((await send(path, method, { ...input, [fields[1]]: LEGACY })).status, 400);
			});
		}
	});
}

it('accepts a verified media thumbnail on the configured prefix and host', async () => {
	const { env, send } = setup();
	const path = '/pub/thumbs/video-id/upload.jpg';
	await recordImageOwner(env.SEARCH_DB, 'https://' + MEDIA + path, { kind: 'video_thumbnail', ownerId: ME, mediaHost: MEDIA });
	assert.equal((await send('/playlists/old', 'PATCH', { thumbnailUrl: 'https://another-media.example' + path })).status, 400);
	assert.equal((await send('/playlists/old', 'PATCH', { thumbnailUrl: 'https://' + MEDIA + path })).status, 200);
});

it('does not create a profile with an unverified image', async () => {
	const { env, send, upload } = setup({ profileExists: false });
	assert.equal((await send('/profiles', 'POST', { avatarUrl: LEGACY })).status, 400);
	assert.equal(env.profiles.read(ME), null);
	await upload(UPLOAD);
	assert.equal((await send('/profiles', 'POST', { avatarUrl: UPLOAD })).status, 200);
	assert.equal(env.profiles.read(ME).avatarUrl, UPLOAD);
});

it('checks the uploading account even when a channel editor acts for the owner', async () => {
	const actorId = 'channel-admin';
	const { env, send, upload } = setup({ actorId });
	const channel = env.channels.read('old');
	await env.channels.put('old', JSON.stringify({ ...channel, members: [{ userId: actorId, role: 'admin' }] }));
	await upload(UPLOAD, actorId);
	const ownerUpload = IMAGE + '/owner.jpg';
	await upload(ownerUpload, ME);
	assert.equal((await send('/channels/old', 'PATCH', { avatarUrl: ownerUpload })).status, 400);
	assert.equal((await send('/channels/old', 'PATCH', { avatarUrl: UPLOAD })).status, 200);
	assert.equal(env.channels.read('old').avatarUrl, UPLOAD);
});
