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
