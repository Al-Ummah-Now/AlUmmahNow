/** The public MP4 search engines get as VideoObject contentUrl (D-SEO-11, wiki AUN-SEO). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { publicMp4Url } from '../src/lib/media/r2-delivery';

const env = { MEDIA_PUBLIC_HOST: 'media.alummahnow.net' };
const ready = (over: Record<string, unknown> = {}) => ({
	status: 'ready', jobId: 'j', rev: 'abc12345', access: 'pub', attempts: 1, queuedAt: 't',
	result: { mp4: { file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 1 } }, ...over,
});

describe('publicMp4Url', () => {
	it('is the stable pub/ URL of a public ready video with an MP4', () => {
		assert.equal(publicMp4Url(env, { id: 'v1', r2: ready() as never, isPublic: true }), 'https://media.alummahnow.net/pub/v1/abc12345/video.mp4');
	});
	it('is null for private, unlisted, removed, unready or Bunny-only videos', () => {
		assert.equal(publicMp4Url(env, { id: 'v1', r2: ready({ access: 'priv' }) as never, isPublic: true }), null);
		assert.equal(publicMp4Url(env, { id: 'v1', r2: ready() as never, isPublic: false }), null);
		assert.equal(publicMp4Url(env, { id: 'v1', r2: ready() as never, isDeleted: true }), null);
		assert.equal(publicMp4Url(env, { id: 'v1', r2: ready({ status: 'transcoding' }) as never }), null);
		assert.equal(publicMp4Url(env, { id: 'v1', r2: ready({ result: { thumbnail: 'thumb.jpg' } }) as never }), null);
		assert.equal(publicMp4Url(env, { id: 'v1', r2: undefined as never }), null);
		assert.equal(publicMp4Url({}, { id: 'v1', r2: ready() as never }), null);
	});
	it('never builds a URL from a strange file name', () => {
		assert.equal(publicMp4Url(env, { id: 'v1', r2: ready({ result: { mp4: { file: '../x.mp4' } } }) as never }), null);
	});
});
