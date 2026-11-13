import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { channelNameFields, channelNameParams, localizedChannelNames } from '../src/lib/channelName';
import { channelNamesByIds } from '../src/lib/channelNames';
import { VideosList } from '../src/endpoints/video/videoList';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

/**
 * Arabic pages showed English channel names under Arabic titles: lists sent the default name only.
 * Every payload now carries the channel's names per language (owner, 2026-11-13).
 */
const channel = { id: 'ch-1', name: 'Al Ummah Now', nameLocalized: { en: 'Al Ummah Now', ar: 'الأمة الآن' } };

describe('channelNameFields', () => {
	it('sends the default name and every language it has', () => {
		assert.deepEqual(channelNameFields(channel), { channelName: 'Al Ummah Now', channelNameLocalized: { en: 'Al Ummah Now', ar: 'الأمة الآن' } });
	});

	it('drops empty names, and a channel without localized names sends the default only', () => {
		assert.deepEqual(localizedChannelNames({ nameLocalized: { en: ' ', ar: 'قناة' } }), { ar: 'قناة' });
		assert.deepEqual(channelNameFields({ name: 'Noor' }), { channelName: 'Noor' });
	});

	it('falls back to a localized name, then the given fallback', () => {
		assert.equal(channelNameFields({ name: '', nameLocalized: { ar: 'قناة' } }).channelName, 'قناة');
		assert.equal(channelNameFields(null, 'Stored').channelName, 'Stored');
	});

	it('flattens to notification params', () => {
		assert.deepEqual(channelNameParams(channel), { channelName: 'Al Ummah Now', channelName_en: 'Al Ummah Now', channelName_ar: 'الأمة الآن' });
	});
});

describe('channel names in payloads', () => {
	it('channelNamesByIds reads each channel once', async () => {
		const channels = new MemoryBucket({ 'ch-1': channel });
		const names = await channelNamesByIds(channels as never, ['ch-1', 'ch-1', 'missing', null]);
		assert.deepEqual([...names.keys()], ['ch-1']);
		assert.equal(names.get('ch-1')?.channelNameLocalized?.ar, 'الأمة الآن');
	});

	it('GET /api/videos sends the channel name in every language', async () => {
		const env = {
			videos: new MemoryBucket({ v1: videoFixture({ id: 'v1', channelId: 'ch-1' }) }),
			channels: new MemoryBucket({ 'ch-1': channel }),
		};
		const app = buildApp((r: any) => r.get('/api/videos', VideosList), null);
		const res = await app.request('/api/videos?limit=5', {}, env as never);
		assert.equal(res.status, 200);
		const [video] = ((await res.json()) as { data: Array<{ channelName: string; channelNameLocalized?: Record<string, string> }> }).data;
		assert.equal(video.channelName, 'Al Ummah Now');
		assert.deepEqual(video.channelNameLocalized, { en: 'Al Ummah Now', ar: 'الأمة الآن' });
	});
});
