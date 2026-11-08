/**
 * Reads must not write to the processor queue. GET /videos/:id, search, and
 * channel/profile reads each used to enqueue a "view" message that the
 * processor only logged or archived; with E2E and browser traffic on QA that
 * was over half of ~350k queue writes a day. Real views go through
 * POST /videos/:id/view.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelFetch } from '../src/endpoints/channel/channelFetch';
import { ProfileFetch } from '../src/endpoints/profile/profileFetch';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { VideoSearch } from '../src/endpoints/video/videoSearch';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const channel = {
	id: 'ch1',
	userId: 'owner',
	name: 'Channel',
	handle: 'Channel1',
	isMain: true,
	dateCreated: '2026-01-01T00:00:00.000Z',
	dateModified: '2026-01-01T00:00:00.000Z',
	playlists: [],
	videos: ['v1'],
	subscribers: [],
	subscriptions: [],
	likes: [],
};

const profile = {
	id: 'owner',
	userName: 'owner',
	displayName: 'Owner',
	dateCreated: '2026-01-01T00:00:00.000Z',
	dateModified: '2026-01-01T00:00:00.000Z',
	channels: ['ch1'],
};

function env() {
	return {
		channels: new MemoryBucket({ ch1: channel }),
		profiles: new MemoryBucket({ owner: profile }),
		videos: new MemoryBucket({ v1: videoFixture({ channelId: 'ch1', title: 'quran recitation', uploadStatus: 'ready' }) }),
		queue: new MemoryQueue(),
	};
}

describe('read endpoints do not enqueue messages', () => {
	for (const auth of [null, { userId: 'viewer' }]) {
		const who = auth ? 'signed in' : 'signed out';

		it(`GET /api/videos/:id (${who})`, async () => {
			const e = env();
			const res = await buildApp((r) => r.get('/api/videos/:id', VideoFetch), auth).request('/api/videos/v1', {}, e);
			assert.equal(res.status, 200);
			assert.equal(e.queue.messages.length, 0);
		});

		it(`GET /api/videos/search (${who})`, async () => {
			const e = env();
			const res = await buildApp((r) => r.get('/api/videos/search', VideoSearch), auth).request('/api/videos/search?q=quran', {}, e);
			assert.equal(res.status, 200);
			assert.equal(e.queue.messages.length, 0);
		});

		it(`GET /api/channels/:id (${who})`, async () => {
			const e = env();
			const res = await buildApp((r) => r.get('/api/channels/:id', ChannelFetch), auth).request('/api/channels/ch1', {}, e);
			assert.equal(res.status, 200);
			assert.equal(e.queue.messages.length, 0);
		});

		it(`GET /api/profiles/:id (${who})`, async () => {
			const e = env();
			const res = await buildApp((r) => r.get('/api/profiles/:id', ProfileFetch), auth).request('/api/profiles/owner', {}, e);
			assert.equal(res.status, 200);
			assert.equal(e.queue.messages.length, 0);
		});
	}
});
