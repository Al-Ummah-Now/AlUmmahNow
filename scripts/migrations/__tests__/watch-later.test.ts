import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearedWatchLater } from '../watch-later.ts';

const wl = { id: 'watch-later-u1', userId: 'u1', channelId: 'ch-1', systemType: 'watch_later', videos: ['a', 'b'], isPublic: false };

test('clears the channel and keeps every other field', () => {
	const next = clearedWatchLater(JSON.stringify(wl));
	assert.deepEqual(JSON.parse(next!), { ...wl, channelId: '' });
});

test('idempotent: a cleared list is left alone', () => {
	assert.equal(clearedWatchLater(clearedWatchLater(JSON.stringify(wl))!), null);
	assert.equal(clearedWatchLater(JSON.stringify({ ...wl, channelId: null })), null);
});

test('never touches anything but a Watch later list', () => {
	assert.equal(clearedWatchLater(JSON.stringify({ id: 'pl-1', channelId: 'ch-1' })), null);
	assert.equal(clearedWatchLater('not json'), null);
	assert.equal(clearedWatchLater('[]'), null);
});
