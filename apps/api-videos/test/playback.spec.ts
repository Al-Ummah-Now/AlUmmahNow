import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoPlayback } from '../src/endpoints/video/videoPlayback';
import {
	BunnyPlaybackAuthorizer,
	canonicalPlaylistVideoId,
	PlaybackUnsupportedError,
	canPlay,
	type PlaybackAuthorizer,
	type PlaybackVideo,
} from '../src/lib/playback/authorizer';
import { signBunnyUrlsInText } from '../src/lib/bunny-signing';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

/** Playback authorization (Epic 9.6). */

const GUID = '0b5d3f8e-1a2b-4c3d-8e9f-001122334455';
const HOST = 'vz-test.b-cdn.net';
const PLAY_URL = `https://${HOST}/${GUID}/playlist.m3u8`;
const KEY = 'token-key';
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

/** What a future adapter (R2 after D2) must look like from the outside. */
class FakeAuthorizer implements PlaybackAuthorizer {
	readonly name = 'fake';
	async playback(video: PlaybackVideo) {
		return video.playUrl ? { manifestUrl: `https://cdn.fake/${video.id}.m3u8?sig=x`, expiresAt: Math.floor(NOW / 1000) + 3600, headers: { 'x-fake': '1' } } : null;
	}
	async download(): Promise<never> {
		throw new PlaybackUnsupportedError('no downloads');
	}
}

const adapters: Array<[string, PlaybackAuthorizer]> = [
	['bunny (signed)', new BunnyPlaybackAuthorizer({ signHost: HOST, tokenKey: KEY, now: () => NOW })],
	['fake', new FakeAuthorizer()],
];

for (const [name, authorizer] of adapters) {
	describe(`PlaybackAuthorizer contract: ${name}`, () => {
		const viewer = { userId: 'u1' };
		it('returns an https manifest that expires in the future', async () => {
			const grant = await authorizer.playback({ id: 'v1', playUrl: PLAY_URL }, viewer);
			assert.ok(grant);
			assert.match(grant.manifestUrl, /^https:\/\//);
			assert.ok(grant.expiresAt === null || grant.expiresAt > NOW / 1000);
		});
		it('returns null while there is no playable source', async () => {
			assert.equal(await authorizer.playback({ id: 'v1' }, viewer), null);
		});
		it('downloads are unsupported until D2', async () => {
			await assert.rejects(authorizer.download({ id: 'v1', playUrl: PLAY_URL }, viewer, 'install-0001', '720p'), PlaybackUnsupportedError);
		});
	});
}

describe('BunnyPlaybackAuthorizer', () => {
	it('signs exactly as the response-signing middleware does (web and apps share URLs)', async () => {
		const grant = await new BunnyPlaybackAuthorizer({ signHost: HOST, tokenKey: KEY, now: () => NOW }).playback({ id: GUID, playUrl: PLAY_URL });
		const viaMiddleware = JSON.parse(await signBunnyUrlsInText(JSON.stringify({ id: GUID, playUrl: PLAY_URL }), HOST, KEY, Math.floor(NOW / 1000)));
		assert.equal(grant!.manifestUrl, viaMiddleware.playUrl);
		assert.ok(grant!.expiresAt! - NOW / 1000 >= 6 * 3600, 'six hours, rounded up to the hour');
	});

	it('leaves the URL unsigned when signing is off or the URL is not the canonical playlist', async () => {
		assert.deepEqual(await new BunnyPlaybackAuthorizer({ signHost: HOST }).playback({ id: 'v', playUrl: PLAY_URL }), { manifestUrl: PLAY_URL, expiresAt: null });
		const other = `https://other.b-cdn.net/${GUID}/playlist.m3u8`;
		assert.equal((await new BunnyPlaybackAuthorizer({ signHost: HOST, tokenKey: KEY }).playback({ id: 'v', playUrl: other }))!.manifestUrl, other);
		const traversal = `https://${HOST}/${GUID}/../x/playlist.m3u8`;
		assert.equal((await new BunnyPlaybackAuthorizer({ signHost: HOST, tokenKey: KEY }).playback({ id: 'v', playUrl: traversal }))!.expiresAt, null);
	});
});

describe('canonicalPlaylistVideoId', () => {
	it('accepts only the exact canonical playlist of the signing host', () => {
		assert.equal(canonicalPlaylistVideoId(PLAY_URL, HOST), GUID);
		for (const url of [
			`http://${HOST}/${GUID}/playlist.m3u8`,
			`https://vz-testxb-cdn.net/${GUID}/playlist.m3u8`,
			`https://evil.example/${HOST}/${GUID}/playlist.m3u8`,
			`https://${HOST}.evil.example/${GUID}/playlist.m3u8`,
			`https://user@${HOST}/${GUID}/playlist.m3u8`,
			`https://${HOST}/${GUID}/playlist.m3u8?x=1`,
			`https://${HOST}/${GUID}/../${GUID}/playlist.m3u8`,
			`https://${HOST}/${GUID}/video.mp4`,
			'not a url',
		]) {
			assert.equal(canonicalPlaylistVideoId(url, HOST), null, url);
		}
	});
});

describe('canPlay', () => {
	it('removed: nobody; private: owner only; public: everyone', () => {
		assert.equal(canPlay(null, { userId: 'u' }), false);
		assert.equal(canPlay({ id: 'v', isDeleted: true, userId: 'u' }, { userId: 'u' }), false);
		assert.equal(canPlay({ id: 'v', isHidden: true, userId: 'u' }, { userId: 'u' }), false);
		assert.equal(canPlay({ id: 'livestream:1' }, { userId: 'u' }), false);
		assert.equal(canPlay({ id: 'v', isPublic: false, userId: 'owner' }, { userId: 'owner' }), true);
		assert.equal(canPlay({ id: 'v', isPublic: false, userId: 'owner' }, { userId: 'other' }), false);
		assert.equal(canPlay({ id: 'v', isPublic: false, userId: 'owner' }, { userId: null }), false);
		assert.equal(canPlay({ id: 'v' }, { userId: null }), true);
	});
});

describe('POST /api/videos/:id/playback', () => {
	const routes = (r: any) => r.post('/api/videos/:id/playback', VideoPlayback);
	const env = (videos: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ videos: new MemoryBucket(videos), ...extra }) as any;
	const play = (e: any, userId?: string) => buildApp(routes, userId ? { userId } : {}).request('/api/videos/v1/playback', { method: 'POST' }, e);

	it('returns a signed grant when token auth is on', async () => {
		const e = env({ v1: videoFixture({ playUrl: PLAY_URL }) }, { bunny_hostname: HOST, BUNNY_SIGN_URLS: 'true', BUNNY_TOKEN_KEY: KEY });
		const res = await play(e);
		assert.equal(res.status, 200, await res.clone().text());
		const { result } = (await res.json()) as any;
		assert.equal(result.provider, 'bunny');
		assert.equal(result.videoId, 'v1');
		assert.ok(result.manifestUrl.startsWith(`https://${HOST}/bcdn_token=`), result.manifestUrl);
		assert.equal(typeof result.expiresAt, 'number');
	});

	it('returns the plain URL while signing is off', async () => {
		const res = await play(env({ v1: videoFixture({ playUrl: PLAY_URL }) }, { bunny_hostname: HOST }));
		assert.deepEqual(((await res.json()) as any).result, { videoId: 'v1', provider: 'bunny', manifestUrl: PLAY_URL, expiresAt: null });
	});

	it('404 for missing, removed or another user\'s private video; the owner can play it', async () => {
		assert.equal((await play(env({}))).status, 404);
		assert.equal((await play(env({ v1: videoFixture({ playUrl: PLAY_URL, isHidden: true }) }))).status, 404);
		const priv = env({ v1: videoFixture({ playUrl: PLAY_URL, isPublic: false }) });
		assert.equal((await play(priv)).status, 404);
		assert.equal((await play(priv, 'someone')).status, 404);
		assert.equal((await play(priv, 'owner')).status, 200);
	});

	it('409 while the video is still processing', async () => {
		assert.equal((await play(env({ v1: videoFixture({ playUrl: undefined }) }))).status, 409);
	});
});
