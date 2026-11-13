import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteVideoSideRecords, scheduleKey } from '../src/lib/videoSideRecords';
import { UPLOAD_MARKER_PREFIX } from '../src/lib/uploads/reaper';
import { MemoryBucket } from './helpers';

/**
 * A video deleted for good takes what it left outside its record: subtitles (uploadedBy), the
 * upload marker (userId), its playlist adds (requestedBy), its file claim (userId) and the
 * scheduler's entry (title, userId). Local E2E leftovers, 2026-11-13.
 */
describe('deleteVideoSideRecords', () => {
	function seed() {
		const subtitles = new MemoryBucket();
		const settings = new MemoryBucket();
		const scheduled = new MemoryBucket();
		const when = new Date('2026-11-23T12:00:00.000Z');
		for (const key of ['v1/metadata.json', 'v1/en.vtt', 'v10/en.vtt', 'v2/en.vtt']) subtitles.store.set(key, '{}');
		for (const key of [`${UPLOAD_MARKER_PREFIX}v1`, `${UPLOAD_MARKER_PREFIX}v2`, 'ops/upload-reaper/config.json', 'ops/playlist-adds/v1/p1.json', 'ops/playlist-adds/v1/p2.json', 'ops/playlist-adds/v10/p1.json']) settings.store.set(key, '{}');
		settings.store.set('ops/upload-fingerprints/fp1.json', JSON.stringify({ key: 'fp1', state: 'bound', videoId: 'v1', userId: 'usr_a' }));
		settings.store.set('ops/upload-fingerprints/fp2.json', JSON.stringify({ key: 'fp2', state: 'bound', videoId: 'v-newer', userId: 'usr_a' }));
		scheduled.store.set(scheduleKey(when, 'v1'), JSON.stringify({ videoId: 'v1', userId: 'usr_a', title: 'T' }));
		scheduled.store.set(scheduleKey(when, 'v2'), '{}');
		return { subtitles, settings, scheduled, when };
	}

	it('uses the scheduler key format', () => {
		assert.equal(scheduleKey(new Date('2026-01-05T03:59:00Z'), 'vid'), '2026-01-05/03/vid.json');
	});

	it("deletes this video's subtitles, upload marker and schedule entry, nobody else's", async () => {
		const { subtitles, settings, scheduled, when } = seed();
		await deleteVideoSideRecords({ subtitles, global_settings: settings, SCHEDULED_VIDEOS: scheduled } as never, 'v1', { scheduledPublishDate: when.toISOString(), uploadFingerprint: 'fp1' });
		assert.deepEqual([...subtitles.store.keys()].sort(), ['v10/en.vtt', 'v2/en.vtt']);
		assert.deepEqual(
			[...settings.store.keys()].sort(),
			['ops/playlist-adds/v10/p1.json', 'ops/upload-fingerprints/fp2.json', 'ops/upload-reaper/config.json', `${UPLOAD_MARKER_PREFIX}v2`].sort(),
		);
		// A claim another video took over stays
		await deleteVideoSideRecords({ global_settings: settings } as never, 'v1', { uploadFingerprint: 'fp2' });
		assert.ok(settings.store.has('ops/upload-fingerprints/fp2.json'));
		assert.deepEqual([...scheduled.store.keys()], [scheduleKey(when, 'v2')]);
		// Idempotent
		await deleteVideoSideRecords({ subtitles, global_settings: settings, SCHEDULED_VIDEOS: scheduled } as never, 'v1', { scheduledPublishDate: when.toISOString() });
	});

	it('skips the schedule without a date and works with no bindings', async () => {
		const { scheduled, when } = seed();
		await deleteVideoSideRecords({ 'scheduled-videos': scheduled } as never, 'v1', null);
		assert.ok(scheduled.store.has(scheduleKey(when, 'v1')));
		assert.deepEqual(await deleteVideoSideRecords({}, 'v1', { scheduledPublishDate: when.toISOString() }), []);
	});
});
