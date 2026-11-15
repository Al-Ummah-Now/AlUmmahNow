import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesFor } from '../media-diagnostics.ts';

test('production names are the al-ummah media resources only', () => {
	const n = namesFor('production');
	assert.equal(n.media, 'al-ummah-now-media');
	assert.equal(n.queue, 'al-ummah-now-transcode');
	assert.equal(n.dlq, 'al-ummah-now-transcode-dlq');
	assert.equal(n.videos, 'videos');
	assert.equal(n.admin, 'al-ummah-admin-api');
});

test('stage names carry the -stage suffix', () => {
	const n = namesFor('stage');
	assert.equal(n.media, 'al-ummah-now-media-stage');
	assert.equal(n.queue, 'al-ummah-now-transcode-stage');
	assert.equal(n.dlq, 'al-ummah-now-transcode-dlq-stage');
});

test('scrub drops signed URL queries and credentials', async () => {
	const { scrub } = await import('../media-diagnostics.ts');
	assert.equal(scrub('src https://vz-1.b-cdn.net/a/play_720p.mp4?token=abc&expires=1 ok'), 'src https://vz-1.b-cdn.net/a/play_720p.mp4?… ok');
	assert.doesNotMatch(scrub('Authorization: Bearer abc.def'), /abc/);
	assert.match(scrub('{"apiKey":"s3cr3t","videoId":"v1"}'), /"apiKey":"…","videoId":"v1"/);
	assert.equal(scrub('jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig'), 'jwt …jwt…');
});
