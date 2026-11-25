import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hdrKindOf, initColors } from '../src/hdr-check.ts';

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, body: number[]) => [...u32(8 + body.length), ...ascii(type), ...body];
const colr = (p: number, t: number, m: number, full = false) => box('colr', [...ascii('nclx'), 0, p, 0, t, 0, m, full ? 0x80 : 0]);
/** An init segment as ffmpeg's fMP4 muxer lays it out: ftyp, then moov … stsd → avc1 → colr. */
export function initWith(inner: number[], entry = 'avc1'): Uint8Array {
	const sampleEntry = box(entry, [...Array(78).fill(0), ...box('avcC', [1, 2, 3]), ...inner, ...box('pasp', [0, 0, 0, 1, 0, 0, 0, 1])]);
	const stsd = box('stsd', [0, 0, 0, 0, ...u32(1), ...sampleEntry]);
	const moov = box('moov', [...box('mvhd', Array(20).fill(0)), ...box('trak', [...box('tkhd', Array(20).fill(0)), ...box('mdia', [...box('mdhd', Array(8).fill(0)), ...box('minf', [...box('vmhd', [0, 0, 0, 0]), ...box('stbl', [...stsd, ...box('stts', [0, 0, 0, 0])])])])])]);
	return Uint8Array.from([...box('ftyp', ascii('iso5mp41')), ...moov]);
}

describe('initColors', () => {
	it('reads the colr box the report showed (9/18/9, limited), in HEVC and AV1 entries too', () => {
		assert.deepEqual(initColors(initWith(colr(9, 18, 9))), { primaries: 9, transfer: 18, matrix: 9, full: false });
		assert.equal(initColors(initWith(colr(9, 16, 9), 'hvc1'))?.transfer, 16);
		assert.equal(initColors(initWith(colr(1, 1, 1), 'av01'))?.primaries, 1);
	});
	it('reads full range, and QuickTime nclc without a range byte', () => {
		assert.equal(initColors(initWith(colr(1, 1, 1, true)))?.full, true);
		assert.deepEqual(initColors(initWith(box('colr', [...ascii('nclc'), 0, 9, 0, 18, 0, 9]))), { primaries: 9, transfer: 18, matrix: 9, full: false });
	});
	it('is null without one', () => {
		assert.equal(initColors(new Uint8Array(0)), null);
		assert.equal(initColors(initWith([])), null);
	});
	it('takes no colr from where the boxes do not put one', () => {
		// The letters inside another box's data
		assert.equal(initColors(initWith(box('uuid', [...Array(16).fill(0), ...colr(9, 18, 9)]))), null);
		assert.equal(initColors(Uint8Array.from([...box('free', colr(9, 18, 9))])), null);
		assert.equal(initColors(Uint8Array.from(colr(9, 18, 9))), null, 'a colr box at the top is no track');
	});
	it('refuses malformed boxes: an nclx one byte short, a box longer than what is left, a size below its header', () => {
		assert.equal(initColors(initWith(box('colr', [...ascii('nclx'), 0, 9, 0, 18, 0, 9]))), null);
		const whole = initWith(colr(9, 18, 9));
		assert.equal(initColors(whole.subarray(0, whole.length - 20)), null);
		const bad = Uint8Array.from(whole);
		bad.set(u32(4), 0);
		assert.equal(initColors(bad), null);
		const huge = Uint8Array.from(whole);
		huge.set(u32(0xfffffff0), 0);
		assert.equal(initColors(huge), null);
	});
});

describe('hdrKindOf', () => {
	it('tells HLG, PQ and BT.2020 from SDR and untagged', () => {
		assert.equal(hdrKindOf(initColors(initWith(colr(9, 18, 9)))), 'hlg');
		assert.equal(hdrKindOf(initColors(initWith(colr(9, 16, 9)))), 'pq');
		assert.equal(hdrKindOf(initColors(initWith(colr(9, 14, 9)))), 'bt2020');
		assert.equal(hdrKindOf(initColors(initWith(colr(1, 1, 1)))), null);
		assert.equal(hdrKindOf(null), null);
	});
});
