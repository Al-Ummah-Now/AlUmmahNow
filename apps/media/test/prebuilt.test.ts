import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ladderFor } from '../container/ladder.mjs';
import { avcCodec, contentMatches, correlation, envelope, frameDistance, masterPlaylist, matchTimes, mediaPlaylist, parseMediaPlaylist, stagedPathAllowed, verifyRenditions } from '../container/prebuilt.mjs';

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
	it('refuses any tag outside the allowlist (nothing unknown is ever passed on)', () => {
		for (const tag of ['#EXT-X-DISCONTINUITY', '#EXT-X-BYTERANGE:100@0', '#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00Z', '#EXT-X-DATERANGE:ID="a"', '#EXT-X-SESSION-DATA:DATA-ID="x"', '#EXT-X-START:TIME-OFFSET=5', '#EXT-X-CUSTOM']) {
			assert.equal((parseMediaPlaylist(playlist([6], tag)) as any).reason, 'playlist_features', tag);
		}
	});
	it('refuses a playlist that is not VOD, has trailing content or a dangling EXTINF', () => {
		assert.equal((parseMediaPlaylist(playlist([6]).replace('#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-PLAYLIST-TYPE:EVENT')) as any).reason, 'playlist_not_vod');
		assert.equal((parseMediaPlaylist(`${playlist([6])}\nseg_00009.m4s`) as any).reason, 'playlist_not_vod');
		assert.equal((parseMediaPlaylist(playlist([6]).replace('#EXTINF:6,', '#EXTINF:6,\n#EXTINF:6,')) as any).reason, 'playlist_extinf');
		assert.equal((parseMediaPlaylist(playlist([6]).replace('#EXTINF:6,', '#EXTINF:6,title')) as any).reason, 'playlist_extinf');
	});
});

describe('mediaPlaylist', () => {
	it('publishes our own playlist built from the parsed upload, which parses back the same', () => {
		const parsed = parseMediaPlaylist(playlist([6, 6, 3.25])) as any;
		const text = mediaPlaylist(parsed);
		assert.equal(text, ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:6', '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:6.000000,', 'seg_00001.m4s', '#EXTINF:6.000000,', 'seg_00002.m4s', '#EXTINF:3.250000,', 'seg_00003.m4s', '#EXT-X-ENDLIST', ''].join('\n'));
		const again = parseMediaPlaylist(text) as any;
		assert.deepEqual(again.segments, parsed.segments);
		assert.equal(again.init, 'init.mp4');
	});
});

describe('content match (renditions must be the source, not just well formed)', () => {
	const frame = (fill: (i: number) => number) => Uint8Array.from({ length: 576 }, (_, i) => fill(i));
	const pcm = (f: (i: number) => number, n: number) => {
		const b = Buffer.alloc(n * 2);
		for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f(i) * 32767))), i * 2);
		return b;
	};
	it('spreads the compared frames over the video, never at 0 or the end', () => {
		const t = matchTimes(120, 12);
		assert.equal(t.length, 12);
		assert.equal(t[0], 5);
		assert.equal(t[11], 115);
		assert.deepEqual(matchTimes(0), []);
	});
	it('a re-encode is close, a different picture is far', () => {
		const a = frame((i) => (i * 7) % 256);
		assert.ok(frameDistance(a, frame((i) => Math.min(255, ((i * 7) % 256) + 3))) <= 3);
		assert.ok(frameDistance(a, frame((i) => 255 - ((i * 7) % 256))) > 60);
		assert.equal(frameDistance(a, new Uint8Array(10)), 255);
	});
	it('loudness envelopes follow the speech, and correlation tells a re-encode from other audio', () => {
		const speech = (i: number) => Math.sin(i / 3) * (Math.floor(i / 400) % 3 === 0 ? 0.6 : 0.05);
		const other = (i: number) => Math.sin(i / 3) * (Math.floor(i / 400) % 3 === 1 ? 0.6 : 0.05);
		const src = envelope(pcm(speech, 40_000));
		assert.equal(src.length, 200);
		assert.ok((correlation(src, envelope(pcm((i) => speech(i) * 0.9, 40_000))) ?? 0) > 0.99);
		assert.ok((correlation(src, envelope(pcm(other, 40_000))) ?? 1) < 0.8);
		assert.equal(correlation([1, 1, 1], [2, 2, 2]), null);
	});
	it('passes matching content and refuses swapped pictures or audio', () => {
		const env = Array.from({ length: 100 }, (_, i) => (i % 10) / 10);
		assert.deepEqual(contentMatches({ frameDistances: Array(12).fill(4), sourceEnvelope: env, renditionEnvelope: env.map((v) => v * 0.95) }), { ok: true });
		assert.deepEqual(contentMatches({ frameDistances: Array(12).fill(40) }), { ok: false, reason: 'content_mismatch' });
		// One scene swapped between two samples still shows as one far frame
		assert.deepEqual(contentMatches({ frameDistances: [...Array(11).fill(3), 90] }), { ok: false, reason: 'content_mismatch' });
		assert.deepEqual(contentMatches({ frameDistances: [] }), { ok: false, reason: 'content_mismatch' });
		assert.deepEqual(contentMatches({ frameDistances: Array(12).fill(3), sourceEnvelope: env, renditionEnvelope: [...env].reverse() }), { ok: false, reason: 'audio_mismatch' });
		assert.deepEqual(contentMatches({ frameDistances: Array(12).fill(3), sourceEnvelope: env, renditionEnvelope: env.slice(0, 40) }), { ok: false, reason: 'audio_mismatch' });
		assert.deepEqual(contentMatches({ frameDistances: Array(12).fill(3), sourceEnvelope: Array(50).fill(0), renditionEnvelope: Array(50).fill(0.3) }), { ok: false, reason: 'audio_mismatch' });
		assert.deepEqual(contentMatches({ frameDistances: Array(12).fill(3), sourceEnvelope: Array(50).fill(0), renditionEnvelope: Array(50).fill(0) }), { ok: true });
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
