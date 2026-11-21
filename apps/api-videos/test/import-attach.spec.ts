/**
 * Admin Tools sidecars (wiki TOOLS-ADMIN TA-6, lib/admin/importAttach.ts): validation, captions and the
 * playlist at once, chapters / thumbnail / schedule only once the video is processed (waiting with a
 * delay), the owner's rules kept (thumbnail shape, never over a custom one), each part done once, and
 * the staged payload removed at the end.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminJob } from '@al-ummah/shared-types';
import { ATTACH_MAX_WAITS, ATTACH_WAIT_SECONDS, runImportAttach, validateSidecars } from '../src/lib/admin/importAttach';
import { clearMediaSettingsCache } from '../src/lib/media/settings';
import { MemoryBucket, MemoryQueue } from './helpers';

const OWNER = 'usr_' + 'b'.repeat(32);
const ADMIN = 'usr_' + 'a'.repeat(32);
const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nبسم الله\n';
const SRT = '1\n00:00:00,000 --> 00:00:02,000\nHello\n';

function png(width: number, height: number): Uint8Array {
	const b = new Uint8Array(33);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	new DataView(b.buffer).setUint32(16, width);
	new DataView(b.buffer).setUint32(20, height);
	return b;
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function harness(video: Record<string, unknown>) {
	const env = {
		videos: new MemoryBucket(),
		subtitles: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		playlists: new MemoryBucket(),
		channels: new MemoryBucket(),
		MEDIA: new MemoryBucket(),
		MEDIA_PUBLIC_HOST: 'media.test',
		queue: new MemoryQueue(),
		'scheduled-videos': new MemoryBucket(),
		Audience: 'https://videos.api.test/',
	};
	const v = { id: 'vid-1', userId: OWNER, channelId: 'ch1', title: 'Lesson', isPublic: false, uploadStatus: 'processing', ...video };
	return {
		env,
		async init(sidecars: unknown) {
			await env.videos.put('vid-1', JSON.stringify(v));
			await env.global_settings.put('ops/media-delivery.json', JSON.stringify({ version: 2, providers: { bunny: { enabled: true }, r2: { enabled: true } }, thumbnails: { store: 'r2' } }));
			const checked = validateSidecars(sidecars);
			assert.ok(checked.ok);
			await env.global_settings.put('admin-import/sidecars/vid-1/k.json', JSON.stringify((checked as { value: unknown }).value));
		},
		job(params: Record<string, unknown> = {}): AdminJob {
			return { id: 'job-1', kind: 'import.attach', targetKind: 'video', targetId: 'vid-1', params: { videoId: 'vid-1', key: 'admin-import/sidecars/vid-1/k.json', done: [], waits: 0, warnings: [], ...params }, status: 'running', attempts: 1, lastError: null, result: null, actorId: ADMIN, createdAt: '', updatedAt: '', finishedAt: null } as AdminJob;
		},
		video: () => JSON.parse(env.videos.store.get('vid-1')!),
	};
}

describe('validateSidecars', () => {
	it('accepts each kind and refuses what cannot be attached', () => {
		assert.equal(validateSidecars({}).ok, false);
		assert.equal(validateSidecars({ captions: [{ language: 'ar', content: VTT }, { language: 'ar', content: VTT }] }).ok, false, 'two tracks of one language');
		assert.equal(validateSidecars({ captions: [{ language: 'Arabic', content: VTT }] }).ok, false);
		assert.equal(validateSidecars({ thumbnail: { data: 'x', mimeType: 'image/gif' } }).ok, false);
		assert.equal(validateSidecars({ publishAt: 'soon' }).ok, false);
		assert.equal(validateSidecars({ playlistId: '../x' }).ok, false);
		const ok = validateSidecars({ captions: [{ language: 'en', content: SRT, label: ' English ' }], chapters: '0:00 Intro', publishAt: '2030-01-01T10:00:00+02:00', extra: 1 });
		assert.deepEqual(ok, { ok: true, value: { captions: [{ language: 'en', content: SRT, label: 'English' }], chapters: '0:00 Intro', publishAt: '2030-01-01T08:00:00.000Z' } });
	});
});

describe('runImportAttach', () => {
	beforeEach(() => clearMediaSettingsCache());
	afterEach(() => clearMediaSettingsCache());

	it('adds captions at once, then waits for processing before chapters and the thumbnail', async () => {
		const h = harness({});
		await h.init({ captions: [{ language: 'ar', content: VTT }, { language: 'en', content: SRT }], chapters: '0:00 Intro\n0:30 Part two\n1:00 End', thumbnail: { data: b64(png(1280, 720)), mimeType: 'image/png' } });
		const first = await runImportAttach(h.env as never, h.job());
		assert.equal(first.done, false);
		assert.equal((first as any).delaySeconds, ATTACH_WAIT_SECONDS);
		assert.deepEqual((first as any).params.done, ['captions']);
		assert.equal((first as any).params.waits, 1);
		assert.deepEqual(h.video().subtitleLanguages.sort(), ['ar', 'en']);
		assert.ok(h.env.subtitles.store.has('vid-1/en.vtt'), 'srt converted to WebVTT');
		// Processed: the rest goes on, captions are not added twice
		await h.env.videos.put('vid-1', JSON.stringify({ ...h.video(), uploadStatus: 'ready', duration: 120, width: 1920, height: 1080 }));
		const second = await runImportAttach(h.env as never, h.job((first as any).params));
		assert.equal(second.done, true);
		assert.deepEqual((second as any).result.done, ['captions', 'chapters', 'thumbnail']);
		assert.deepEqual((second as any).result.warnings, []);
		const v = h.video();
		assert.equal(v.chapters.chapters.length, 3);
		assert.equal(v.thumbnailType, 'custom');
		assert.match(v.thumbnailUrl, /^https:\/\/media\.test\//);
		assert.equal(h.env.global_settings.store.has('admin-import/sidecars/vid-1/k.json'), false, 'staged payload removed');
	});

	it('keeps the owner\'s rules: wrong-shape thumbnail and an existing custom one are left, with warnings', async () => {
		const shape = harness({ uploadStatus: 'ready', duration: 60, width: 1080, height: 1920 });
		await shape.init({ thumbnail: { data: b64(png(1280, 720)), mimeType: 'image/png' }, chapters: 'no times here' });
		const res = await runImportAttach(shape.env as never, shape.job());
		assert.deepEqual((res as any).result.warnings, ['chapters_invalid', 'thumbnail_shape']);
		assert.equal(shape.video().thumbnailType, undefined);
		const custom = harness({ uploadStatus: 'ready', duration: 60, width: 1280, height: 720, thumbnailType: 'custom', thumbnailUrl: 'https://img/own.jpg' });
		await custom.init({ thumbnail: { data: b64(png(1280, 720)), mimeType: 'image/png' } });
		const kept = await runImportAttach(custom.env as never, custom.job());
		assert.deepEqual((kept as any).result.warnings, ['thumbnail_kept_existing']);
		assert.equal(custom.video().thumbnailUrl, 'https://img/own.jpg');
	});

	it('adds to a playlist of the video\'s own channel only', async () => {
		const own = harness({ uploadStatus: 'ready', duration: 60 });
		await own.env.playlists.put('pl-other', JSON.stringify({ id: 'pl-other', channelId: 'ch2', videos: [] }));
		await own.init({ playlistId: 'pl-other' });
		const refused = await runImportAttach(own.env as never, own.job());
		assert.deepEqual((refused as any).result.warnings, ['playlist_other_channel']);
		assert.deepEqual(JSON.parse(own.env.playlists.store.get('pl-other')!).videos, []);
		const missing = harness({ uploadStatus: 'ready', duration: 60 });
		await missing.init({ playlistId: 'pl-none' });
		assert.deepEqual(((await runImportAttach(missing.env as never, missing.job())) as any).result.warnings, ['playlist_missing']);
	});

	it('schedules a private video for its publish date, and warns for a date in the past', async () => {
		const h = harness({ uploadStatus: 'ready', duration: 60 });
		const at = new Date(Date.now() + 3 * 86400_000).toISOString();
		await h.init({ publishAt: at });
		await runImportAttach(h.env as never, h.job());
		assert.equal(h.video().scheduledPublishStatus, 'scheduled');
		assert.equal(h.video().scheduledPublishDate, at);
		assert.equal(h.env['scheduled-videos'].store.size, 1);
		const past = harness({ uploadStatus: 'ready', duration: 60 });
		await past.init({ publishAt: '2020-01-01T00:00:00Z' });
		const res = await runImportAttach(past.env as never, past.job());
		assert.equal((res as any).result.warnings.length, 1);
		assert.match((res as any).result.warnings[0], /^schedule_/);
	});

	it('a failed video or a 12-hour wait throws (retry, then the Errors page); a deleted video ends quietly', async () => {
		const failed = harness({ uploadStatus: 'failed' });
		await failed.init({ chapters: '0:00 Intro' });
		await assert.rejects(runImportAttach(failed.env as never, failed.job()), /failed to process/);
		const slow = harness({});
		await slow.init({ chapters: '0:00 Intro' });
		await assert.rejects(runImportAttach(slow.env as never, slow.job({ waits: ATTACH_MAX_WAITS })), /12 hours/);
		const gone = harness({ isDeleted: true });
		await gone.init({ chapters: '0:00 Intro' });
		const res = await runImportAttach(gone.env as never, gone.job());
		assert.equal((res as any).result.skipped, 'video_deleted');
		assert.equal(gone.env.global_settings.store.has('admin-import/sidecars/vid-1/k.json'), false);
	});
});
