import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hdrKindOf, initColors } from '../src/hdr-check.ts';

/** A colr box among other bytes, as ffmpeg's fMP4 muxer writes it. */
export function withColr(primaries: number, transfer: number, matrix: number, full = false): Uint8Array {
	const box = [0, 0, 0, 19, 0x63, 0x6f, 0x6c, 0x72, 0x6e, 0x63, 0x6c, 0x78, 0, primaries, 0, transfer, 0, matrix, full ? 0x80 : 0];
	return Uint8Array.from([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65, ...box, 0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]);
}

describe('initColors', () => {
	it('reads the colr box the report showed (9/18/9, limited)', () => assert.deepEqual(initColors(withColr(9, 18, 9)), { primaries: 9, transfer: 18, matrix: 9, full: false }));
	it('reads full range', () => assert.equal(initColors(withColr(1, 1, 1, true))?.full, true));
	it('is null without one, or with the letters but no box', () => {
		assert.equal(initColors(new Uint8Array(0)), null);
		assert.equal(initColors(new TextEncoder().encode('....colr and then some words')), null);
		assert.equal(initColors(withColr(9, 18, 9).subarray(0, 20)), null, 'cut short');
	});
});

describe('hdrKindOf', () => {
	it('tells HLG, PQ and BT.2020 from SDR and untagged', () => {
		assert.equal(hdrKindOf(initColors(withColr(9, 18, 9))), 'hlg');
		assert.equal(hdrKindOf(initColors(withColr(9, 16, 9))), 'pq');
		assert.equal(hdrKindOf(initColors(withColr(9, 14, 9))), 'bt2020');
		assert.equal(hdrKindOf(initColors(withColr(1, 1, 1))), null);
		assert.equal(hdrKindOf(null), null);
	});
});
