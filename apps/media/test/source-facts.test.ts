import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { containerKind, SourceFacts, streamFacts } from '../container/source-facts.mjs';

const head = (s: string) => Buffer.from(s.padEnd(16, '.'), 'latin1');

test('containerKind reads the first bytes', () => {
	assert.equal(containerKind(head('\0\0\0\x20ftypM4A ')), 'mp4');
	assert.equal(containerKind(head('\x1a\x45\xdf\xa3')), 'matroska');
	assert.equal(containerKind(head('RIFF\0\0\0\0WAVE')), 'wav');
	assert.equal(containerKind(head('ID3\x04')), 'mp3_aac');
	assert.equal(containerKind(Buffer.alloc(16)), 'zeros');
	assert.equal(containerKind(head('<html>')), 'unknown');
	assert.equal(containerKind(Buffer.alloc(3)), 'too_short');
});

test('streamFacts tells a cover picture from a video and keeps no tags', () => {
	const facts = streamFacts({
		streams: [{ codec_type: 'audio', codec_name: 'aac', tags: { title: 'private' } }, { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }, { codec_type: 'data' }],
		format: { format_name: 'mov,mp4,m4a', duration: '812.4', filename: '/work/private.mp4', tags: { title: 'private' } },
	});
	assert.deepEqual(facts, { format: 'mov,mp4,m4a', streams: [{ kind: 'audio', codec: 'aac' }, { kind: 'cover', codec: 'mjpeg' }, { kind: 'other', codec: 'unknown' }], durationSeconds: 812 });
	assert.deepEqual(streamFacts({}), { streams: [] });
});

test('SourceFacts hashes the whole file and measures zeros at both ends, whatever the chunk sizes', () => {
	const MB = 1024 * 1024;
	const file = Buffer.concat([Buffer.alloc(MB, 7), Buffer.alloc(MB / 2, 7), Buffer.alloc(MB / 2), Buffer.alloc(MB / 2, 7)]);
	const sha256 = createHash('sha256').update(file).digest('hex');
	for (const size of [file.length, 3 * MB, 64 * 1024, 700_001]) {
		const f = new SourceFacts();
		for (let i = 0; i < file.length; i += size) f.update(file.subarray(i, i + size));
		assert.deepEqual(f.finish(file.length), { bytes: file.length, container: 'unknown', zeroStartPercent: 0, zeroEndPercent: 50, sha256 }, `chunks of ${size}`);
	}
});

test('a failed job reports what the probe saw', () => {
	const server = readFileSync(new URL('../container/server.mjs', import.meta.url), 'utf8');
	assert.match(server, /sourceFacts = \{ \.\.\.sourceFacts, \.\.\.streamFacts\(json\) \};\s*const v =/);
	assert.match(server, /\.\.\.\(sourceFacts \? \{ sourceFacts \} : \{\}\)/);
});
