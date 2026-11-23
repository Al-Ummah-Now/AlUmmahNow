/**
 * Autoplay like YouTube (docs/specs/PLAYLIST-PLAYBACK.md, phase 1b): the viewer's "Autoplay next"
 * setting is kept on their account (GET/PUT /api/profile/playback), defaults to off (E21-D7), never shows on
 * public profile reads; and autoplayed views are flagged on the queued VideoView.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackSettingsGet, PlaybackSettingsUpdate } from '../src/endpoints/profile/playbackSettings';
import { ProfileFetch } from '../src/endpoints/profile/profileFetch';
import { VideoView } from '../src/endpoints/video/videoView';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const ROUTES = (r: any) => {
	r.get('/api/profile/playback', PlaybackSettingsGet);
	r.put('/api/profile/playback', PlaybackSettingsUpdate);
	r.get('/api/profiles/:id', ProfileFetch);
	r.post('/api/videos/:id/view', VideoView);
};

async function call(env: unknown, userId: string | null, method: string, path: string, body?: unknown) {
	const res = await buildApp(ROUTES, userId ? { userId } : null).request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, env as never);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('GET/PUT /api/profile/playback', () => {
	const base = { email: 'u@test.local', displayName: 'U', dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', channels: [] };

	it('defaults to autoplay off (E21-D7), saves the choice on the account, and keeps it off public reads', async () => {
		const profiles = new MemoryBucket({ u1: { id: 'u1', ...base } });
		const env = { profiles };
		assert.deepEqual((await call(env, 'u1', 'GET', '/api/profile/playback')).body, { autoplayNext: false, autoplayNextSetByUser: false });

		const on = await call(env, 'u1', 'PUT', '/api/profile/playback', { autoplayNext: true });
		assert.equal(on.status, 200);
		assert.deepEqual(on.body, { autoplayNext: true, autoplayNextSetByUser: true });
		// Another device of the same account reads the same choice
		assert.deepEqual((await call(env, 'u1', 'GET', '/api/profile/playback')).body, { autoplayNext: true, autoplayNextSetByUser: true });
		assert.equal(profiles.read('u1').displayName, 'U', 'the rest of the profile is kept');

		const pub = await call(env, null, 'GET', '/api/profiles/u1');
		assert.doesNotMatch(JSON.stringify(pub.body), /autoplayNext|playback/);

		assert.deepEqual((await call(env, 'u1', 'PUT', '/api/profile/playback', { autoplayNext: false })).body, { autoplayNext: false, autoplayNextSetByUser: true });
		assert.deepEqual(profiles.read('u1').playback, { autoplayNext: false, autoplayNextSetByUser: true });
	});

	it('keeps a choice saved before E21-D7 as an explicit choice, on or off', async () => {
		const profiles = new MemoryBucket({
			legacyOn: { id: 'legacyOn', ...base, playback: { autoplayNext: true } },
			legacyOff: { id: 'legacyOff', ...base, playback: { autoplayNext: false } },
		});
		const env = { profiles };
		assert.deepEqual((await call(env, 'legacyOn', 'GET', '/api/profile/playback')).body, { autoplayNext: true, autoplayNextSetByUser: true });
		assert.deepEqual((await call(env, 'legacyOff', 'GET', '/api/profile/playback')).body, { autoplayNext: false, autoplayNextSetByUser: true });
		assert.deepEqual(profiles.read('legacyOn').playback, { autoplayNext: true }, 'reads never rewrite the profile');

		// Saving the same value writes the flag once
		assert.deepEqual((await call(env, 'legacyOn', 'PUT', '/api/profile/playback', { autoplayNext: true })).body, { autoplayNext: true, autoplayNextSetByUser: true });
		assert.deepEqual(profiles.read('legacyOn').playback, { autoplayNext: true, autoplayNextSetByUser: true });
	});

	it('a user without a profile yet reads the default and gets one holding the setting; bad bodies are refused', async () => {
		const profiles = new MemoryBucket();
		const env = { profiles };
		assert.deepEqual((await call(env, 'u2', 'GET', '/api/profile/playback')).body, { autoplayNext: false, autoplayNextSetByUser: false });
		assert.deepEqual((await call(env, 'u2', 'PUT', '/api/profile/playback', { autoplayNext: false })).body, { autoplayNext: false, autoplayNextSetByUser: true });
		assert.deepEqual(profiles.read('u2').playback, { autoplayNext: false, autoplayNextSetByUser: true });
		assert.equal((await call(env, 'u2', 'PUT', '/api/profile/playback', { autoplayNext: 'no' })).status, 400);
	});
});

describe('autoplayed views', () => {
	it('are flagged on the queued view; anything but true is a chosen view', async () => {
		const env = { videos: new MemoryBucket({ v1: videoFixture() }), queue: new MemoryQueue() };
		assert.equal((await call(env, null, 'POST', '/api/videos/v1/view', { watchTime: 0, autoplay: true })).status, 200);
		assert.equal((await call(env, null, 'POST', '/api/videos/v1/view', { watchTime: 0 })).status, 200);
		assert.deepEqual(env.queue.messages.map((m: any) => m.payload.autoplay), [true, false]);
	});
});
