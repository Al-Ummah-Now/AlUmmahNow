import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { audioStreams, folderUploadOrder, masterVariants, normaliseArgs, packageMaster, parseAttributes, splitRungArgs, trackHlsArgs, uniqueNames, videoCodecs } from '../container/audio.mjs';
import { audioPartsFromKeys, audioQueueAction, AUDIO_MAX_ATTEMPTS, packageKeyAllowed, serveAudioUpload } from '../src/audio';

// Workers' FixedLengthStream, for Node (length checks are the runtime's job)
(globalThis as Record<string, unknown>).FixedLengthStream ??= class {
	constructor() {
		return new TransformStream();
	}
};

const RENDITION_MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=1012400,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=3080800,AVERAGE-BANDWIDTH=2000000,RESOLUTION=1280x720,FRAME-RATE=30.000,CODECS="avc1.64001f,mp4a.40.2"
720p/index.m3u8
`;

const TRACKS = [
	{ id: 'orig', language: 'ar', label: 'العربية', kind: 'original', isDefault: true },
	{ id: 'tabc123def456', language: 'en', label: 'English', kind: 'dub', isDefault: false },
	{ id: 'tdesc12345678', language: 'en', label: 'English', kind: 'description', isDefault: false },
];

describe('normaliseArgs', () => {
	it('pads or cuts to the video length, stereo 48 kHz AAC 128k, moov first', () => {
		const args = normaliseArgs({ input: '/w/source', out: '/w/track.m4a', durationSeconds: 61.5 });
		assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 2), ['-map', '0:a:0']);
		assert.equal(args[args.indexOf('-af') + 1], 'apad');
		assert.equal(args[args.indexOf('-t') + 1], '61.500');
		assert.equal(args[args.indexOf('-b:a') + 1], '128000');
		assert.equal(args[args.indexOf('-ar') + 1], '48000');
		assert.ok(args.includes('+faststart'));
		assert.equal(args.at(-1), '/w/track.m4a');
	});
	it('maps the chosen stream of a multi-track source', () => {
		const args = normaliseArgs({ input: '/w/source', out: '/w/t.m4a', stream: 2, durationSeconds: 10 });
		assert.equal(args[args.indexOf('-map') + 1], '0:a:2');
	});
});

describe('splitRungArgs / trackHlsArgs', () => {
	it('copies the video and (for the top rung) the audio into separate 6 s fMP4 renditions', () => {
		const args = splitRungArgs({ input: '/w/in/720p/index.m3u8', videoDir: '/w/out/v/720p', audioDir: '/w/out/orig' });
		assert.ok(args.includes('-allowed_extensions'));
		assert.deepEqual(args.filter((a: string) => a === '-c'), ['-c', '-c']);
		assert.ok(args.includes('0:v:0') && args.includes('0:a:0'));
		assert.ok(args.includes('/w/out/v/720p/index.m3u8') && args.includes('/w/out/orig/index.m3u8'));
		assert.equal(args[args.indexOf('-hls_time') + 1], '6');
		assert.ok(!args.includes('libx264'));
	});
	it('copies only the video for the other rungs', () => {
		const args = splitRungArgs({ input: '/w/in/360p/index.m3u8', videoDir: '/w/out/v/360p' });
		assert.ok(!args.includes('0:a:0'));
	});
	it('packages a track by stream copy', () => {
		const args = trackHlsArgs({ input: '/w/t.m4a', dir: '/w/out/t1' });
		assert.equal(args[args.indexOf('-c') + 1], 'copy');
		assert.equal(args.at(-1), '/w/out/t1/index.m3u8');
	});
});

describe('masterVariants / parseAttributes', () => {
	it('reads our rungs with their attributes (quoted commas kept)', () => {
		const v = masterVariants(RENDITION_MASTER);
		assert.deepEqual(v.map((x: { rung: string }) => x.rung), ['360p', '720p']);
		assert.equal(v[1].attrs.CODECS, 'avc1.64001f,mp4a.40.2');
		assert.equal(v[1].attrs.RESOLUTION, '1280x720');
		assert.equal(parseAttributes('A=1,B="x,y",C=z').B, 'x,y');
	});
	it('ignores a variant outside our layout', () => {
		assert.deepEqual(masterVariants('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://evil.example/x.m3u8\n'), []);
	});
	it('drops the audio codec from CODECS', () => {
		assert.equal(videoCodecs('avc1.64001f,mp4a.40.2'), 'avc1.64001f');
		assert.equal(videoCodecs(''), 'avc1.640028');
	});
});

describe('packageMaster', () => {
	const master = packageMaster({ variants: masterVariants(RENDITION_MASTER), tracks: TRACKS });
	const media = master.split('\n').filter((l: string) => l.startsWith('#EXT-X-MEDIA:'));
	it('lists every track in one audio group with one default', () => {
		assert.equal(media.length, 3);
		assert.ok(media.every((l: string) => l.includes('TYPE=AUDIO') && l.includes('GROUP-ID="aud"')));
		assert.equal(media.filter((l: string) => l.includes('DEFAULT=YES')).length, 1);
		assert.ok(media[0].includes('DEFAULT=YES') && media[0].includes('URI="a/orig/index.m3u8"') && media[0].includes('LANGUAGE="ar"'));
	});
	it('marks audio description and never auto-selects it', () => {
		assert.ok(media[2].includes('CHARACTERISTICS="public.accessibility.describes-video"'));
		assert.ok(media[2].includes('AUTOSELECT=NO'));
		assert.ok(media[1].includes('AUTOSELECT=YES'));
	});
	it('keeps NAME unique within the group', () => {
		assert.ok(media[1].includes('NAME="English"'));
		assert.ok(media[2].includes('NAME="English (description)"'));
		assert.deepEqual(uniqueNames([{ label: 'A', kind: 'dub' }, { label: 'A', kind: 'dub' }, { label: 'A', kind: 'dub' }]), ['A', 'A (dub)', 'A (dub) 2']);
	});
	it('points every rung at its video-only copy with the audio group and the audio bitrate added', () => {
		const lines = master.split('\n');
		const i = lines.findIndex((l: string) => l.includes('RESOLUTION=1280x720'));
		assert.ok(lines[i].includes('AUDIO="aud"'));
		assert.ok(lines[i].includes('CODECS="avc1.64001f,mp4a.40.2"'));
		assert.ok(lines[i].includes('BANDWIDTH=3208800'));
		assert.ok(lines[i].includes('AVERAGE-BANDWIDTH=2128000'));
		assert.ok(lines[i].includes('FRAME-RATE=30.000'));
		assert.equal(lines[i + 1], 'a/v/720p/index.m3u8');
	});
	it('defaults to the first track when none is marked', () => {
		const m = packageMaster({ variants: masterVariants(RENDITION_MASTER), tracks: TRACKS.map((t) => ({ ...t, isDefault: false })) });
		assert.ok(m.split('\n').find((l: string) => l.includes('DEFAULT=YES'))!.includes('a/orig/'));
	});
	it('strips quotes and line breaks from labels', () => {
		const m = packageMaster({ variants: masterVariants(RENDITION_MASTER), tracks: [{ ...TRACKS[0], label: 'x"\nURI="evil' }] });
		assert.ok(m.includes('NAME="xURI=evil"'));
	});
});

describe('audioStreams', () => {
	it('indexes audio streams among audio streams and keeps their tags', () => {
		const out = audioStreams({
			streams: [
				{ codec_type: 'video' },
				{ codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'ara', title: 'Original' } },
				{ codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'und' } },
			],
		});
		assert.deepEqual(out, [
			{ index: 0, language: 'ara', title: 'Original', channels: 2, codec: 'aac' },
			{ index: 1, channels: 2, codec: 'aac' },
		]);
	});
});

describe('folderUploadOrder', () => {
	it('puts the playlist last', () => {
		assert.deepEqual(folderUploadOrder(['index.m3u8', 'seg_00002.m4s', 'init.mp4', 'seg_00001.m4s']), ['init.mp4', 'seg_00001.m4s', 'seg_00002.m4s', 'index.m3u8']);
	});
});

describe('packageKeyAllowed', () => {
	const prefix = 'priv/vid1/r1';
	it('allows the package folders and the versioned master', () => {
		for (const k of ['a/v/720p/index.m3u8', 'a/v/360p/seg_00001.m4s', 'a/orig/init.mp4', 'a/tabc123def456/seg_00010.m4s', 'master_a3.m3u8']) assert.ok(packageKeyAllowed(prefix, `${prefix}/${k}`), k);
	});
	it('refuses the rendition itself, other prefixes and odd names', () => {
		for (const k of ['master.m3u8', '720p/index.m3u8', 'video.mp4', 'a/v/../720p/index.m3u8', 'a/x/index.m3u8', 'a/orig/evil.js', 'a/v/720p/x/index.m3u8']) assert.ok(!packageKeyAllowed(prefix, `${prefix}/${k}`), k);
		assert.ok(!packageKeyAllowed(prefix, 'priv/other/r1/a/orig/index.m3u8'));
	});
});

describe('audioQueueAction', () => {
	it('acks ready, retries busy and passing failures, gives up on fatal or the last attempt', () => {
		assert.deepEqual(audioQueueAction({ outcome: 'ready' }, 1), { ack: true, giveUp: false });
		assert.deepEqual(audioQueueAction({ outcome: 'busy' }, 2), { ack: false, delaySeconds: 120 });
		assert.deepEqual(audioQueueAction({ outcome: 'failed', fatal: true }, 1), { ack: true, giveUp: true });
		assert.deepEqual(audioQueueAction({ outcome: 'failed' }, 1), { ack: false, delaySeconds: 60 });
		// Below the queue's max_retries (8): the failure is reported, never left to the DLQ
		assert.deepEqual(audioQueueAction({ outcome: 'busy' }, AUDIO_MAX_ATTEMPTS), { ack: true, giveUp: true });
		assert.ok(AUDIO_MAX_ATTEMPTS < 8);
	});
});

describe('uploaded track file', () => {
	const prefix = 'audio/vid1/tabc123def456/up-12345678/';
	it('orders chunks by offset and ignores foreign keys', () => {
		const parts = audioPartsFromKeys(
			[
				{ key: `${prefix}000000000005`, size: 5 },
				{ key: `${prefix}000000000000`, size: 5 },
				{ key: 'audio/vid1/tabc123def456/track.m4a', size: 9 },
				{ key: `${prefix}junk`, size: 1 },
			],
			'vid1',
			'tabc123def456',
			'up-12345678',
		);
		assert.deepEqual(parts.map((p) => p.offset), [0, 5]);
	});

	function bucket(objects: Record<string, string>) {
		return {
			async list({ prefix }: { prefix: string }) {
				return { objects: Object.keys(objects).filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: objects[key]!.length })), truncated: false };
			},
			async get(key: string, opts?: { range?: { offset: number; length: number } }) {
				const v = objects[key];
				if (v === undefined) return null;
				const slice = opts?.range ? v.slice(opts.range.offset, opts.range.offset + opts.range.length) : v;
				return { body: new Blob([slice]).stream() };
			},
		} as unknown as R2Bucket;
	}

	it('serves the chunks as one file, with ranges across chunk borders', async () => {
		const env = { MEDIA_ORIGINALS: bucket({ [`${prefix}000000000000`]: 'hello', [`${prefix}000000000005`]: 'world' }) };
		const p = { videoId: 'vid1', trackId: 'tabc123def456', uploadId: 'up-12345678', bytes: 10 };
		const whole = await serveAudioUpload(env, p, null);
		assert.equal(whole.status, 200);
		assert.equal(await whole.text(), 'helloworld');
		const part = await serveAudioUpload(env, p, 'bytes=3-6');
		assert.equal(part.status, 206);
		assert.equal(part.headers.get('content-range'), 'bytes 3-6/10');
		assert.equal(await part.text(), 'lowo');
	});

	it('answers 404 while chunks are missing', async () => {
		const env = { MEDIA_ORIGINALS: bucket({ [`${prefix}000000000000`]: 'hello' }) };
		const res = await serveAudioUpload(env, { videoId: 'vid1', trackId: 'tabc123def456', uploadId: 'up-12345678', bytes: 10 }, null);
		assert.equal(res.status, 404);
	});
});
