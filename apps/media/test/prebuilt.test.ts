import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ladderFor } from '../container/ladder.mjs';
import { avcCodec, decodeSamples, masterPlaylist, parseMediaPlaylist, stagedPathAllowed, verifyRenditions } from '../container/prebuilt.mjs';

function playlist(segs: number[], extra = '') {
	return ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:6', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MAP:URI="init.mp4"', ...segs.flatMap((s, i) => [`#EXTINF:${s},`, `seg_${String(i + 1).padStart(5, '0')}.m4s`]), extra, '#EXT-X-ENDLIST'].filter(Boolean).join('\n');
}

const SOURCE = { durationSeconds: 30, hasAudio: true };
const LADDER = ladderFor({ width: 1280, height: 720 });

function rung(r: { name: string; width: number; height: number }, over: Record<string, unknown> = {}) {
	const pl = parseMediaPlaylist(playlist([6, 6, 6, 6, 6]));
	const sizes: Record<string, number> = { 'init.mp4': 800 };
	for (let i = 1; i <= 5; i++) sizes[`seg_0000${i}.m4s`] = 200_000;
	return {
		name: r.name,
		playlist: pl,
		sizes,
		probe: { video: { codec: 'h264', width: r.width, height: r.height, pixFmt: 'yuv420p', keyframeSeconds: [0, 2, 4, 6] }, audio: { codec: 'aac', channels: 2 } },
		...over,
	};
}
const good = () => LADDER.map((r: any) => rung(r));

describe('parseMediaPlaylist', () => {
	it('reads an fMP4 VOD playlist', () => {
		const p = parseMediaPlaylist(playlist([6, 6, 3.2])) as any;
		assert.equal(p.ok, true);
		assert.equal(p.init, 'init.mp4');
		assert.deepEqual(p.segments.map((s: any) => s.seconds), [6, 6, 3.2]);
	});
	it('refuses live, encrypted, paths and missing init', () => {
		assert.equal((parseMediaPlaylist(playlist([6]).replace('#EXT-X-ENDLIST', '')) as any).reason, 'playlist_not_vod');
		assert.equal((parseMediaPlaylist(playlist([6], '#EXT-X-KEY:METHOD=AES-128,URI="k"')) as any).reason, 'playlist_features');
		assert.equal((parseMediaPlaylist(playlist([6]).replace('seg_00001.m4s', '../x.m4s')) as any).reason, 'playlist_names');
		assert.equal((parseMediaPlaylist(playlist([6]).replace('#EXT-X-MAP:URI="init.mp4"\n', '')) as any).reason, 'playlist_names');
	});
});

describe('verifyRenditions', () => {
	it('accepts renditions that match the ladder for this source', () => {
		assert.deepEqual(verifyRenditions({ ladder: LADDER, source: SOURCE, rungs: good() }), { ok: true });
	});
	it('refuses a missing or extra rung', () => {
		assert.equal((verifyRenditions({ ladder: LADDER, source: SOURCE, rungs: good().slice(1) }) as any).reason, 'rungs_mismatch');
		const extra = [...good(), rung({ name: '1080p', width: 1920, height: 1080 })];
		assert.equal((verifyRenditions({ ladder: LADDER, source: SOURCE, rungs: extra }) as any).reason, 'rungs_mismatch');
	});
	const cases: Array<[string, (r: any) => void]> = [
		['size', (r) => (r.probe.video.width = 1278)],
		['video_codec', (r) => (r.probe.video.codec = 'hevc')],
		['pixel_format', (r) => (r.probe.video.pixFmt = 'yuv444p')],
		['audio', (r) => (r.probe.audio = undefined)],
		['file_missing', (r) => delete r.sizes['seg_00003.m4s']],
		['segment_length', (r) => (r.playlist = parseMediaPlaylist(playlist([12, 12, 6])))],
		['duration', (r) => (r.playlist = parseMediaPlaylist(playlist([6, 6])))],
		['keyframes', (r) => (r.probe.video.keyframeSeconds = [0, 10])],
		['bitrate', (r) => (r.sizes['seg_00002.m4s'] = 20_000_000)],
		['no_video', (r) => (r.probe = null)],
	];
	for (const [reason, mutate] of cases) {
		it(`refuses ${reason}, naming the rung`, () => {
			const rungs = good();
			mutate(rungs[1]);
			assert.deepEqual(verifyRenditions({ ladder: LADDER, source: SOURCE, rungs }), { ok: false, reason, rung: rungs[1].name });
		});
	}
	it('audio is not required for a silent source', () => {
		const rungs = good().map((r: any) => ({ ...r, probe: { video: r.probe.video } }));
		assert.deepEqual(verifyRenditions({ ladder: LADDER, source: { durationSeconds: 30, hasAudio: false }, rungs }), { ok: true });
	});
});

describe('helpers', () => {
	it('decodes first, middle and last segments', () => {
		const segs = Array.from({ length: 9 }, (_, i) => ({ file: `s${i}`, seconds: 6 }));
		assert.deepEqual(decodeSamples(segs), ['s0', 's4', 's8']);
		assert.deepEqual(decodeSamples(segs.slice(0, 2)), ['s0', 's1']);
	});
	it('writes codec strings and our own master playlist, lowest rung first', () => {
		assert.equal(avcCodec('High', 40), 'avc1.640028');
		assert.equal(avcCodec('Main', 31), 'avc1.4d001f');
		assert.equal(avcCodec('Constrained Baseline', 30), 'avc1.42e01e');
		const m = masterPlaylist([
			{ name: '720p', width: 1280, height: 720, bandwidth: 2_000_000, codecs: 'avc1.64001f,mp4a.40.2' },
			{ name: '360p', width: 640, height: 360, bandwidth: 600_000, codecs: 'avc1.4d001e,mp4a.40.2' },
		]);
		assert.ok(m.startsWith('#EXTM3U\n'));
		assert.ok(m.indexOf('360p/index.m3u8') < m.indexOf('720p/index.m3u8'));
		assert.match(m, /BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.4d001e,mp4a.40.2"/);
	});
	it('only <rung>/<file> paths of known rungs may be fetched', () => {
		assert.equal(stagedPathAllowed('720p/seg_00001.m4s', ['720p']), true);
		assert.equal(stagedPathAllowed('720p/../x', ['720p']), false);
		assert.equal(stagedPathAllowed('1080p/init.mp4', ['720p']), false);
		assert.equal(stagedPathAllowed('master.m3u8', ['720p']), false);
	});
});
