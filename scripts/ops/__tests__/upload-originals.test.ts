import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BATCHES_SQL, HASH_GROUPS_SQL, HASH_SIZES_SQL, JOBS_SQL, kindOf, itemsSql, nameShape, plan, RESOURCES, streamsOf } from '../upload-originals.ts';

const bytes = (s: string) => Uint8Array.from(Buffer.from(s.padEnd(16, '\0'), 'latin1'));

test('every statement is a bounded SELECT, no LIKE', () => {
	for (const sql of [JOBS_SQL, BATCHES_SQL, itemsSql(5), HASH_GROUPS_SQL, HASH_SIZES_SQL]) {
		assert.match(sql, /^\s*SELECT\b/i);
		assert.match(sql, /\bLIMIT \d+/);
		assert.doesNotMatch(sql, /\bLIKE\b|\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i);
	}
	assert.match(itemsSql(2), /IN \(\?2, \?3\)/);
});

test('the script only reads: GETs of R2 and one POST, the D1 SELECT', () => {
	const src = readFileSync(new URL('../upload-originals.ts', import.meta.url), 'utf8');
	assert.deepEqual([...src.matchAll(/method: '(\w+)'/g)].map((m) => m[1]), ['POST']);
	assert.ok(Object.values(RESOURCES).every((r) => r.bucket.startsWith('al-ummah-now-media-originals')));
});

test('kindOf reads the first bytes', () => {
	assert.equal(kindOf(new Uint8Array(16)), 'zeros');
	assert.equal(kindOf(bytes('\0\0\0\x20ftypM4A ')), 'mp4/mov (M4A)');
	assert.equal(kindOf(bytes('\x1a\x45\xdf\xa3')), 'matroska/webm');
	assert.equal(kindOf(bytes('ID3\x04')), 'mp3/aac');
	assert.equal(kindOf(bytes('RIFF\0\0\0\0WAVE')), 'riff (WAVE)');
	assert.equal(kindOf(bytes('<html>')), 'unknown');
	assert.equal(kindOf(new Uint8Array(3)), 'too short');
});

test('streamsOf tells a cover picture from a video', () => {
	assert.equal(
		streamsOf(JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'aac' }, { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }], format: { format_name: 'mov,mp4', duration: '812.4' } })),
		'mov,mp4: audio aac, cover mjpeg, 812 s',
	);
	assert.equal(streamsOf('{}'), '?: no streams, 0 s');
});

test('nameShape prints the extension and a downloader part, never the name', () => {
	assert.equal(nameShape('درس خاص.f251.webm'), '.webm (downloader part)');
	assert.equal(nameShape('private lesson.mp4'), '.mp4');
	assert.equal(nameShape('private'), '.none');
});

test('plan joins the parts once each, tolerates overlap and refuses a gap', () => {
	const key = (n: number) => `src/v/u/${String(n).padStart(15, '0')}`;
	const parts = [{ key: key(8), size: 8 }, { key: key(0), size: 8 }, { key: key(6), size: 4 }, { key: 'src/v/u/manifest.json', size: 9 }];
	const steps = plan(parts, 'src/v/u/', 16)!;
	assert.deepEqual(steps, [
		{ key: key(0), skip: 0, take: 8 },
		{ key: key(6), skip: 2, take: 2 },
		{ key: key(8), skip: 2, take: 6 },
	]);
	assert.equal(steps.reduce((n, s) => n + s.take, 0), 16);
	assert.equal(plan([{ key: key(0), size: 8 }, { key: key(9), size: 8 }], 'src/v/u/', 16), null);
	assert.equal(plan([{ key: key(0), size: 8 }], 'src/v/u/', 16), null);
});
