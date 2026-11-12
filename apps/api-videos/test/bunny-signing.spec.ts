/**
 * Bunny CDN token authentication: URL signing for Stream video URLs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bunnyDirectoryToken, isSignedBunnyUrl, signBunnyUrlsInText, signedBunnyUrl, tokenExpiry, unsignedBunnyUrl } from '../src/lib/bunny-signing';

const HOST = 'vz-cb79844a-c5d.b-cdn.net';
const KEY = 'test-security-key';
const VID = '443418c1-dc70-43d9-944d-5388ab7dc4c3';

function referenceToken(key: string, videoId: string, expires: number): string {
	const tokenPath = `/${videoId}/`;
	return createHash('sha256')
		.update(`${key}${tokenPath}${expires}token_path=${tokenPath}`)
		.digest('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function referenceFileToken(key: string, path: string, expires: number): string {
	return createHash('sha256')
		.update(`${key}${path}${expires}`)
		.digest('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

describe('bunny signing', () => {
	it('computes the directory token as base64url(sha256(key + path + expires + token_path=path))', async () => {
		assert.equal(await bunnyDirectoryToken(KEY, VID, 1800000000), referenceToken(KEY, VID, 1800000000));
	});

	it('rounds expiry up to the hour, at least 6h ahead', () => {
		const now = 1_794_070_000;
		const exp = tokenExpiry(now);
		assert.equal(exp % 3600, 0);
		assert.ok(exp - now >= 6 * 3600 && exp - now < 7 * 3600);
	});

	it('builds the path-form URL so playlist-relative segments inherit the token', () => {
		const url = signedBunnyUrl(HOST, VID, 'playlist.m3u8', 'TOKEN', 1800000000);
		assert.equal(
			url,
			`https://${HOST}/bcdn_token=TOKEN&expires=1800000000&token_path=%2F${VID}%2F/${VID}/playlist.m3u8`,
		);
	});

	it('signs every URL for the host in a JSON body, one token per video', async () => {
		const now = 1_794_070_000;
		const exp = tokenExpiry(now);
		const body = JSON.stringify({
			video: {
				id: VID,
				playUrl: `https://${HOST}/${VID}/playlist.m3u8`,
				thumbnailUrl: `https://${HOST}/${VID}/thumbnail.jpg`,
				otherHost: `https://vz-25839d05-80d.b-cdn.net/${VID}/playlist.m3u8`,
				image: 'https://images.alummahnow.net/x_avatar.png',
			},
		});
		const signed = JSON.parse(await signBunnyUrlsInText(body, HOST, KEY, now));
		const token = referenceToken(KEY, VID, exp);
		const prefix = `https://${HOST}/bcdn_token=${token}&expires=${exp}&token_path=%2F${VID}%2F/${VID}/`;
		assert.equal(signed.video.playUrl, `${prefix}playlist.m3u8`);
		// Images get a token for that one file, so a thumbnail never unlocks playback
		const thumbToken = referenceFileToken(KEY, `/${VID}/thumbnail.jpg`, exp);
		assert.equal(signed.video.thumbnailUrl, `https://${HOST}/${VID}/thumbnail.jpg?token=${thumbToken}&expires=${exp}`);
		// Other hosts and non-video URLs are untouched
		assert.equal(signed.video.otherHost, `https://vz-25839d05-80d.b-cdn.net/${VID}/playlist.m3u8`);
		assert.equal(signed.video.image, 'https://images.alummahnow.net/x_avatar.png');
	});

	it('leaves already-signed URLs alone and is a no-op without a key or host', async () => {
		const record = JSON.stringify({ id: VID, playUrl: `https://${HOST}/${VID}/playlist.m3u8`, thumbnailUrl: `https://${HOST}/${VID}/thumbnail_3.jpg` });
		const once = await signBunnyUrlsInText(record, HOST, KEY);
		assert.match(JSON.parse(once).thumbnailUrl, /thumbnail_3\.jpg\?token=[^&]+&expires=\d+$/);
		assert.equal(await signBunnyUrlsInText(once, HOST, KEY), once);
		const plain = record;
		assert.equal(await signBunnyUrlsInText(plain, HOST, ''), plain);
		assert.equal(await signBunnyUrlsInText(plain, '', KEY), plain);
	});

	it('is not a signing oracle: only known URL fields of the matching record are signed', async () => {
		const OTHER = '11111111-2222-3333-4444-555555555555';
		const now = 1_794_070_000;
		const body = JSON.stringify({
			data: [
				{
					id: VID,
					// User-written text is never signed
					description: `watch https://${HOST}/${OTHER}/playlist.m3u8`,
					// A record cannot obtain tokens for another video
					thumbnailUrl: `https://${HOST}/${OTHER}/thumbnail.jpg`,
					thumbnailSizes: { hd: `https://${HOST}/${VID}/thumbnail.jpg`, sd: `https://${HOST}/${OTHER}/thumbnail.jpg` },
				},
				// Only the canonical playlist gets a directory token
				{ id: VID, playUrl: `https://${HOST}/${VID}/play_720p.mp4` },
				// Comments etc. carry no matching id
				{ id: 'comment-1', videoId: OTHER, text: `https://${HOST}/${OTHER}/playlist.m3u8` },
				// Watch history style: the video id is in videoId
				{ id: 'wh-1', videoId: VID, videoThumbnail: `https://${HOST}/${VID}/thumbnail.jpg` },
			],
		});
		const out = JSON.parse(await signBunnyUrlsInText(body, HOST, KEY, now));
		const [rec, mp4, comment, history] = out.data;
		assert.equal(rec.description, `watch https://${HOST}/${OTHER}/playlist.m3u8`);
		assert.equal(rec.thumbnailUrl, `https://${HOST}/${OTHER}/thumbnail.jpg`);
		assert.match(rec.thumbnailSizes.hd, /\?token=/);
		assert.equal(rec.thumbnailSizes.sd, `https://${HOST}/${OTHER}/thumbnail.jpg`);
		assert.equal(mp4.playUrl, `https://${HOST}/${VID}/play_720p.mp4`);
		assert.equal(comment.text, `https://${HOST}/${OTHER}/playlist.m3u8`);
		assert.match(history.videoThumbnail, /\?token=/);
	});

	it('returns non-JSON bodies unchanged', async () => {
		const text = `not json https://${HOST}/${VID}/playlist.m3u8`;
		assert.equal(await signBunnyUrlsInText(text, HOST, KEY), text);
	});

	it('signs only a single plain file name (no traversal or encoded segments)', async () => {
		const OTHER = '11111111-2222-3333-4444-555555555555';
		const bad = [
			`https://${HOST}/${VID}/../${OTHER}/thumbnail.jpg`,
			`https://${HOST}/${VID}/%2e%2e/${OTHER}/thumbnail.jpg`,
			`https://${HOST}/${VID}/sub/thumbnail.jpg`,
			`https://${HOST}/${VID}/..jpg`,
		];
		for (const url of bad) {
			const out = JSON.parse(await signBunnyUrlsInText(JSON.stringify({ id: VID, thumbnailUrl: url }), HOST, KEY));
			assert.equal(out.thumbnailUrl, url, url);
		}
		const ok = JSON.parse(await signBunnyUrlsInText(JSON.stringify({ id: VID, thumbnailUrl: `https://${HOST}/${VID}/thumbnail_767db498.jpg` }), HOST, KEY));
		assert.match(ok.thumbnailUrl, /thumbnail_767db498\.jpg\?token=/);
	});

	// 2026-11-12 incident: Studio's frame picker saved thumbnail URLs that still
	// carried the playUrl's directory token, so the stored token expired and
	// Bunny answered 403 for the thumbnail.
	describe('stored tokens', () => {
		const NOW = 1_794_500_000;
		const STALE = 1_794_459_600;
		const pathSigned = (file: string) => `https://${HOST}/bcdn_token=OLDTOKEN&expires=${STALE}&token_path=%2F${VID}%2F/${VID}/${file}`;
		const querySigned = (file: string) => `https://${HOST}/${VID}/${file}?token=OLDTOKEN&expires=${STALE}`;

		it('unsignedBunnyUrl drops the path-form and query-form tokens and nothing else', () => {
			assert.equal(unsignedBunnyUrl(pathSigned('thumbnail_1.jpg')), `https://${HOST}/${VID}/thumbnail_1.jpg`);
			assert.equal(unsignedBunnyUrl(querySigned('thumbnail_1.jpg')), `https://${HOST}/${VID}/thumbnail_1.jpg`);
			assert.equal(unsignedBunnyUrl(`https://${HOST}/${VID}/a.jpg?v=2&token=x&expires=1`), `https://${HOST}/${VID}/a.jpg?v=2`);
			const plain = `https://${HOST}/${VID}/thumbnail.jpg`;
			assert.equal(unsignedBunnyUrl(plain), plain);
			assert.equal(unsignedBunnyUrl('https://cdn.example.com/tokenizer.jpg'), 'https://cdn.example.com/tokenizer.jpg');
			assert.ok(isSignedBunnyUrl(pathSigned('thumbnail_4.jpg')));
			assert.ok(!isSignedBunnyUrl(plain));
		});

		it('serves a stored thumbnail with an expired token with a fresh single-file signature', async () => {
			for (const stored of [pathSigned('thumbnail_1.jpg'), querySigned('thumbnail_1.jpg')]) {
				const out = JSON.parse(await signBunnyUrlsInText(JSON.stringify({ id: VID, thumbnailUrl: stored }), HOST, KEY, NOW));
				const exp = tokenExpiry(NOW);
				const path = `/${VID}/thumbnail_1.jpg`;
				// Query form (never a directory token: an image URL must not unlock playback)
				assert.equal(out.thumbnailUrl, `https://${HOST}${path}?token=${referenceFileToken(KEY, path, exp)}&expires=${exp}`, stored);
				assert.ok(!out.thumbnailUrl.includes('bcdn_token'));
			}
		});

		it('re-signs a stored signed playUrl with a fresh directory token', async () => {
			const out = JSON.parse(await signBunnyUrlsInText(JSON.stringify({ id: VID, playUrl: pathSigned('playlist.m3u8') }), HOST, KEY, NOW));
			const exp = tokenExpiry(NOW);
			assert.equal(out.playUrl, signedBunnyUrl(HOST, VID, 'playlist.m3u8', referenceToken(KEY, VID, exp), exp));
		});

		it("still never signs another video's stored URL", async () => {
			const OTHER = '11111111-2222-3333-4444-555555555555';
			const stored = `https://${HOST}/bcdn_token=OLD&expires=${STALE}&token_path=%2F${OTHER}%2F/${OTHER}/thumbnail_1.jpg`;
			const out = JSON.parse(await signBunnyUrlsInText(JSON.stringify({ id: VID, thumbnailUrl: stored }), HOST, KEY, NOW));
			assert.equal(out.thumbnailUrl, stored);
		});

		// Contract: whatever a record holds, no response carries a Bunny URL whose
		// `expires` is in the past (single video, lists, search, related,
		// playlists, watch history, channel pages, admin: every body goes through
		// signBunnyUrlsInText in bunnySigningMiddleware).
		it('contract: no Bunny URL in a signed response has expires in the past', async () => {
			const record = (id: string) => ({
				id,
				playUrl: pathSigned('playlist.m3u8').replaceAll(VID, id),
				thumbnailUrl: pathSigned('thumbnail_4.jpg').replaceAll(VID, id),
				thumbnail: querySigned('thumbnail.jpg').replaceAll(VID, id),
				previewUrl: querySigned('preview.webp').replaceAll(VID, id),
				poster: pathSigned('thumbnail.jpg').replaceAll(VID, id),
				thumbnailSizes: { hd: pathSigned('thumbnail_1.jpg').replaceAll(VID, id), sd: querySigned('thumbnail_2.jpg').replaceAll(VID, id) },
			});
			const ids = [VID, '22222222-3333-4444-5555-666666666666', '33333333-4444-5555-6666-777777777777'];
			const body = {
				video: record(ids[0]),
				data: ids.map(record),
				related: { items: ids.map(record) },
				history: ids.map((id) => ({ videoId: id, videoThumbnail: pathSigned('thumbnail_1.jpg').replaceAll(VID, id) })),
				playlist: { id: 'pl', cover: { videoId: ids[1], thumbnailUrl: pathSigned('thumbnail_3.jpg').replaceAll(VID, ids[1]) } },
			};
			const out = await signBunnyUrlsInText(JSON.stringify(body), HOST, KEY, NOW);
			const urls = out.match(new RegExp(`https://${HOST.replace(/\./g, '\\.')}[^"]*`, 'g')) ?? [];
			assert.ok(urls.length >= 30, `found ${urls.length} URLs`);
			for (const url of urls) {
				const expires = /expires=(\d+)/.exec(url);
				assert.ok(expires, `unsigned: ${url}`);
				assert.ok(Number(expires[1]) > NOW, `expired: ${url}`);
			}
		});
	});
});
