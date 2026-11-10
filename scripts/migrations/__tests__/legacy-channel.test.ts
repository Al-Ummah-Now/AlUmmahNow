import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	LEGACY_PLACEHOLDER_USER,
	backupKey,
	buildChannel,
	handleCandidates,
	handleKey,
	isLegacyCandidate,
	isMigrated,
	migrateVideo,
	pickAvatar,
	rollupDeltas,
	rowKey,
	sumRows,
	type CounterRow,
} from '../legacy-channel.ts';

const match = { channelName: 'Mostafa Elbadry', legacyUserId: LEGACY_PLACEHOLDER_USER };
const target = { channelId: 'ch-1', ownerId: 'usr_0123456789abcdef0123456789abcdef' };
const legacy = { id: 'v1', channelId: null, userId: LEGACY_PLACEHOLDER_USER, channel: 'Mostafa Elbadry', views: 3, title: 't' };

test('only unmigrated legacy videos of the channel name are candidates', () => {
	assert.equal(isLegacyCandidate(legacy, match), true);
	assert.equal(isLegacyCandidate({ ...legacy, channel: ' mostafa elbadry ' }, match), true);
	assert.equal(isLegacyCandidate({ ...legacy, channel: 'Other' }, match), false);
	assert.equal(isLegacyCandidate({ ...legacy, userId: 'usr_x' }, match), false);
	assert.equal(isLegacyCandidate({ ...legacy, channelId: 'ch-9' }, match), false);
	assert.equal(isLegacyCandidate(null, match), false);
});

test('migrateVideo sets channelId and userId only, and is idempotent', () => {
	const next = migrateVideo(legacy, match, target)!;
	assert.deepEqual(next, { ...legacy, channelId: 'ch-1', userId: target.ownerId });
	assert.equal(isMigrated(next, target), true);
	assert.equal(migrateVideo(next, match, target), null);
});

test('handle candidates match api-videos defaults', () => {
	const c = handleCandidates('Mostafa Elbadry', 'abcd1234-ef56-7890');
	assert.deepEqual(c.slice(0, 3), ['MostafaElbadry', 'MostafaElbadry-abcd', 'MostafaElbadry-abcd1234']);
	assert.equal(handleKey('@MostafaElbadry'), 'channel-handles/mostafaelbadry');
	assert.deepEqual(handleCandidates('مصطفى', 'abcd1234ef56'), ['channel-abcd1234', 'channel-abcd1234ef56']);
});

test('pickAvatar takes the most common https channel thumbnail', () => {
	assert.equal(pickAvatar([
		{ channelThumbnailUrl: 'https://a/x.jpg' },
		{ channelThumbnailUrl: 'https://a/y.jpg' },
		{ channelThumbnailUrl: 'https://a/y.jpg' },
		{ channelThumbnailUrl: 'images.alummahnow.net/z.jpg' },
	]), 'https://a/y.jpg');
	assert.equal(pickAvatar([{}]), undefined);
});

test('buildChannel has the ChannelCreate shape', () => {
	const ch = buildChannel({ id: 'c', now: 'T', ownerId: 'u', email: 'e', name: 'N', handle: 'N1' });
	assert.equal(ch.isMain, false);
	assert.deepEqual([ch.videos, ch.subscribers, ch.playlists, ch.subscriptions, ch.likes], [[], [], [], [], []]);
	assert.equal(ch.handle, 'N1');
	assert.equal('avatarUrl' in ch, false);
});

const v = (entityId: string, day: string, value: number, metric = 'views', dim = ''): CounterRow => ({ entityType: 'video', entityId, day, metric, dim, value });

test('rollupDeltas fills missing video days and sets the channel to the sum', () => {
	const archive = sumRows([v('a', '2025-11-09', 1), v('a', '2025-11-09', 1), v('b', '2025-11-09', 1), v('a', '2026-11-08', 3)]);
	const effective = sumRows([v('a', '2026-11-08', 3)]);
	const deltas = rollupDeltas(archive, effective, 'ch', new Set(['a', 'b']));
	const byKey = Object.fromEntries(deltas.map((d) => [rowKey(d), d.value]));
	assert.equal(byKey[rowKey(v('a', '2025-11-09', 0))], 2);
	assert.equal(byKey[rowKey(v('b', '2025-11-09', 0))], 1);
	assert.equal(byKey[rowKey(v('a', '2026-11-08', 0))], undefined);
	assert.equal(byKey[rowKey({ entityType: 'channel', entityId: 'ch', day: '2025-11-09', metric: 'views' })], 3);
	assert.equal(byKey[rowKey({ entityType: 'channel', entityId: 'ch', day: '2026-11-08', metric: 'views' })], 3);
});

test('rollupDeltas is idempotent and never lowers counts', () => {
	const archive = sumRows([v('a', '2025-11-09', 2)]);
	const first = rollupDeltas(archive, new Map(), 'ch', new Set(['a']));
	const after = sumRows(first);
	assert.deepEqual(rollupDeltas(archive, after, 'ch', new Set(['a'])), []);
	// D1 already ahead of the archive: nothing added, channel follows the video
	const ahead = sumRows([v('a', '2025-11-09', 5)]);
	const d = rollupDeltas(archive, ahead, 'ch', new Set(['a']));
	assert.deepEqual(d.map((r) => [r.entityType, r.value]), [['channel', 5]]);
	// Rows of other videos are ignored
	assert.deepEqual(rollupDeltas(sumRows([v('z', '2025-11-09', 1)]), new Map(), 'ch', new Set(['a'])), []);
});

test('backupKey', () => {
	assert.equal(backupKey('qa', 'r1', 'videos', 'v1'), 'migrations/issue-245/qa/r1/videos/v1.json');
});
