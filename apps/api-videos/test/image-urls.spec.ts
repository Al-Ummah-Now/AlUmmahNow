/**
 * Legacy imported thumbnails are stored scheme-less and unencoded; responses carry https URLs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteImageUrl, absoluteImageUrlsInText } from '../src/lib/image-urls';

const LEGACY = 'images.alummahnow.net/(في نصف دقيقة) موقف المسلم ｜ مصطفى.jpg';

describe('absolute image URLs', () => {
	it('adds https and percent-encodes a scheme-less path on our domain', () => {
		const out = absoluteImageUrl(LEGACY);
		assert.match(out, /^https:\/\/images\.alummahnow\.net\//);
		assert.doesNotMatch(out, /\s/);
		assert.equal(decodeURIComponent(out.slice('https://images.alummahnow.net/'.length)), LEGACY.slice('images.alummahnow.net/'.length));
	});
	it('does not double-encode, and leaves absolute and foreign values alone', () => {
		const once = absoluteImageUrl(LEGACY);
		assert.equal(absoluteImageUrl(once), once);
		assert.equal(absoluteImageUrl(once.slice('https://'.length)), once);
		for (const v of ['https://vz-x.b-cdn.net/id/thumbnail.jpg?token=a&expires=1', 'example.com/a.jpg', 'not a url', '']) assert.equal(absoluteImageUrl(v), v);
	});
	it('rewrites only image fields of a JSON body', () => {
		const body = JSON.stringify({ data: [{ id: 'v', title: LEGACY, thumbnailUrl: LEGACY, thumbnailSizes: { hd: LEGACY } }] });
		const out = JSON.parse(absoluteImageUrlsInText(body));
		assert.match(out.data[0].thumbnailUrl, /^https:\/\//);
		assert.match(out.data[0].thumbnailSizes.hd, /^https:\/\//);
		assert.equal(out.data[0].title, LEGACY);
	});
	it('returns bodies without legacy values, and non-JSON, unchanged', () => {
		const clean = JSON.stringify({ thumbnailUrl: 'https://images.alummahnow.net/a.jpg' });
		assert.equal(absoluteImageUrlsInText(clean), clean);
		assert.equal(absoluteImageUrlsInText(`oops "${LEGACY}`), `oops "${LEGACY}`);
	});
});
