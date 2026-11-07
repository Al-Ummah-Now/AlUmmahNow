/**
 * Bunny CDN token authentication: URL signing for Stream video URLs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bunnyDirectoryToken, signBunnyUrlsInText, signedBunnyUrl, tokenExpiry } from '../src/lib/bunny-signing';

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
		const once = await signBunnyUrlsInText(`"https://${HOST}/${VID}/playlist.m3u8"`, HOST, KEY);
		assert.equal(await signBunnyUrlsInText(once, HOST, KEY), once);
		const thumb = await signBunnyUrlsInText(`"https://${HOST}/${VID}/thumbnail_3.jpg"`, HOST, KEY);
		assert.match(thumb, /thumbnail_3\.jpg\?token=[^&]+&expires=\d+"$/);
		assert.equal(await signBunnyUrlsInText(thumb, HOST, KEY), thumb);
		const plain = `"https://${HOST}/${VID}/playlist.m3u8"`;
		assert.equal(await signBunnyUrlsInText(plain, HOST, ''), plain);
		assert.equal(await signBunnyUrlsInText(plain, '', KEY), plain);
	});
});
