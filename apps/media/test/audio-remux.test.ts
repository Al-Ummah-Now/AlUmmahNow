import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_FILE, audioRemuxArgs, audioRung, ladderFor } from '../container/ladder.mjs';
import { isAudioExtractJobMessage, MEDIA_AUDIO, mediaContentType, publicAudioPath, sanitizeAudio } from '@al-ummah/shared-types';

describe('audio-only M4A remux (E14-S2)', () => {
	it('picks 480p (128k AAC, compact to fetch) first, then 720p/1080p, then 360p', () => {
		assert.equal(audioRung(ladderFor({ width: 1920, height: 1080 }))?.name, '480p');
		assert.equal(audioRung(ladderFor({ width: 640, height: 360 }))?.name, '360p');
		assert.equal(audioRung([{ name: '720p', width: 1280, height: 720 }, { name: '360p', width: 640, height: 360 }])?.name, '720p');
		assert.equal(audioRung([{ name: '1080p', width: 1920, height: 1080 }])?.name, '1080p');
		assert.equal(audioRung([]), null);
	});

	it('stream-copies AAC audio with +faststart and drops video/subs/data (zero re-encoding)', () => {
		const args = audioRemuxArgs({ out: '/tmp/out', rung: '480p' });
		assert.deepEqual(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2), ['-i', '/tmp/out/480p/index.m3u8']);
		assert.ok(args.includes('-vn'));
		assert.ok(args.includes('-sn'));
		assert.ok(args.includes('-dn'));
		assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2), ['-c:a', 'copy']);
		assert.ok(!args.includes('aac'), 'must stream-copy, never re-encode');
		assert.ok(!args.includes('libx264'));
		assert.deepEqual(args.slice(-3), ['-movflags', '+faststart', `/tmp/out/${AUDIO_FILE}`]);
		assert.equal(AUDIO_FILE, MEDIA_AUDIO);
		assert.equal(mediaContentType(AUDIO_FILE), 'audio/mp4');
	});

	it('sanitizes audio metadata strictly', () => {
		assert.deepEqual(sanitizeAudio({ file: 'audio.m4a', rung: '480p', bytes: 12_345_678, bitrate: 128_000 }), {
			file: 'audio.m4a',
			rung: '480p',
			bytes: 12_345_678,
			bitrate: 128_000,
		});
		assert.deepEqual(sanitizeAudio({ file: 'audio.m4a', rung: '360p', bytes: 5000 }), {
			file: 'audio.m4a',
			rung: '360p',
			bytes: 5000,
		});
		assert.equal(sanitizeAudio({ file: '../evil.m4a', rung: '480p', bytes: 5000 }), undefined);
		assert.equal(sanitizeAudio({ file: 'video.mp4', rung: '480p', bytes: 5000 }), undefined);
		assert.equal(sanitizeAudio({ file: 'audio.m4a', rung: '480p', bytes: 0 }), undefined);
		assert.equal(sanitizeAudio({ file: 'audio.m4a', rung: '480p', bytes: -1 }), undefined);
	});

	it('validates AudioExtractJobMessage payloads', () => {
		const valid = {
			kind: 'audio_extract',
			videoId: '0b3c2a1e-1111-2222-3333-444455556666',
			jobId: 'job-audio-1',
			rev: 'abcdefgh12345678',
			access: 'pub',
			rungs: [{ name: '480p', width: 854, height: 480 }],
			queuedAt: '2026-11-23T00:00:00.000Z',
		};
		assert.equal(isAudioExtractJobMessage(valid), true);
		assert.equal(isAudioExtractJobMessage({ ...valid, kind: 'mp4' }), false);
		assert.equal(isAudioExtractJobMessage({ ...valid, rungs: [] }), false);
		assert.equal(isAudioExtractJobMessage({ ...valid, videoId: '../bad' }), false);
	});

	it('derives publicAudioPath only for ready public visible videos', () => {
		const base = {
			id: '0b3c2a1e-1111-2222-3333-444455556666',
			isPublic: true,
			isDeleted: false,
			isHidden: false,
			r2: {
				status: 'ready',
				access: 'pub',
				rev: 'abcdefgh12345678',
				result: { audio: { file: 'audio.m4a', rung: '480p', bytes: 1024 } },
			},
		};
		assert.equal(publicAudioPath(base), 'pub/0b3c2a1e-1111-2222-3333-444455556666/abcdefgh12345678/audio.m4a');
		assert.equal(publicAudioPath({ ...base, isPublic: false }), null);
		assert.equal(publicAudioPath({ ...base, isHidden: true }), null);
		assert.equal(publicAudioPath({ ...base, isDeleted: true }), null);
		assert.equal(publicAudioPath({ ...base, r2: { ...base.r2, access: 'priv' } }), null);
	});
});
