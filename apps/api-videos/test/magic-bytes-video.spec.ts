/**
 * The magic-byte check of the multipart video upload (POST /api/videos/upload) takes every format
 * the web upload forms accept (#1938): MP4, M4V, MOV, WebM, MKV and AVI, with the type a browser
 * really reports for each, and nothing else.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateVideoMagicBytes } from '../src/lib/security/magic-bytes';

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
const pad = (bytes: number[], length = 64): Uint8Array => Uint8Array.from([...bytes, ...new Array(Math.max(0, length - bytes.length)).fill(0)]);

/** An ISO base media file: size, 'ftyp', major brand, minor version, compatible brands */
const iso = (brand: string, compatible: string[] = []): Uint8Array =>
	pad([0, 0, 0, 16 + compatible.length * 4, ...ascii('ftyp'), ...ascii(brand.padEnd(4, ' ')), 0, 0, 2, 0, ...compatible.flatMap((b) => ascii(b.padEnd(4, ' ')))]);
/** An EBML header with its DocType element */
const ebml = (docType: string): Uint8Array => pad([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x80 + docType.length, ...ascii(docType)]);
const riff = (kind: string): Uint8Array => pad([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii(kind)]);

describe('validateVideoMagicBytes', () => {
	const accepted: Array<[string, Uint8Array, string, string]> = [
		['MP4 (isom)', iso('isom'), 'video/mp4', 'video/mp4'],
		['MP4 (mp42)', iso('mp42'), 'video/mp4', 'video/mp4'],
		['M4V', iso('M4V'), 'video/x-m4v', 'video/x-m4v'],
		['MOV', iso('qt'), 'video/quicktime', 'video/quicktime'],
		['WebM', ebml('webm'), 'video/webm', 'video/webm'],
		['MKV', ebml('matroska'), 'video/x-matroska', 'video/x-matroska'],
		['AVI', riff('AVI '), 'video/x-msvideo', 'video/x-msvideo'],
	];

	for (const [name, bytes, browserType, detected] of accepted) {
		it(`accepts ${name} and names it ${detected}, with no mismatch for the browser's type`, () => {
			const r = validateVideoMagicBytes(bytes, browserType);
			assert.equal(r.isValid, true);
			assert.equal(r.detectedMimeType, detected);
			assert.equal(r.mimeTypeMismatch, false);
		});

		it(`accepts ${name} when the browser sends no type`, () => {
			const r = validateVideoMagicBytes(bytes, '');
			assert.equal(r.isValid, true);
			assert.equal(r.mimeTypeMismatch, false);
		});
	}

	it('treats the old names for MOV and AVI as the same format, not a mismatch', () => {
		assert.equal(validateVideoMagicBytes(iso('qt'), 'video/mov').mimeTypeMismatch, false);
		assert.equal(validateVideoMagicBytes(riff('AVI '), 'video/avi').mimeTypeMismatch, false);
	});

	it('tells WebM from MKV by the DocType, and calls an EBML header it cannot read WebM', () => {
		assert.equal(validateVideoMagicBytes(ebml('webm')).detectedMimeType, 'video/webm');
		assert.equal(validateVideoMagicBytes(ebml('matroska')).detectedMimeType, 'video/x-matroska');
		assert.equal(validateVideoMagicBytes(pad([0x1a, 0x45, 0xdf, 0xa3], 12)).detectedMimeType, 'video/webm');
	});

	it('takes the video brands cameras and tools write, including 3GP and an unknown brand that is compatible with a video one', () => {
		for (const brand of ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'MSNV', 'XAVC', '3gp5', '3g2a', 'f4v ']) {
			const r = validateVideoMagicBytes(iso(brand));
			assert.equal(r.isValid, true, brand);
			assert.equal(r.detectedMimeType, 'video/mp4', brand);
		}
		assert.equal(validateVideoMagicBytes(iso('M4VH')).detectedMimeType, 'video/x-m4v');
		assert.equal(validateVideoMagicBytes(iso('CAMX', ['isom', 'mp42'])).detectedMimeType, 'video/mp4');
	});

	it('refuses the ISO files that are not video: HEIC and AVIF photos, M4A and M4B audio, each by its brand', () => {
		for (const brand of ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis', 'M4A', 'M4B', 'M4P', 'F4A', 'crx', 'jp2']) {
			assert.equal(validateVideoMagicBytes(iso(brand)).isValid, false, brand);
		}
		// M4A and HEIC list video-looking compatible brands; the major brand still decides
		assert.equal(validateVideoMagicBytes(iso('M4A', ['mp42', 'isom'])).isValid, false);
		assert.equal(validateVideoMagicBytes(iso('heic', ['mif1', 'mp42'])).isValid, false);
		assert.equal(validateVideoMagicBytes(iso('mif1', ['heic', 'avif'])).isValid, false);
	});

	it('refuses an ISO file with an unknown brand and no video brand, and one with no brand list at all', () => {
		assert.equal(validateVideoMagicBytes(iso('ZZZZ')).isValid, false);
		assert.equal(validateVideoMagicBytes(iso('ZZZZ', ['mif1', 'heic'])).isValid, false);
	});

	it('refuses other RIFF files (WAV, WebP), which the old check took for AVI', () => {
		assert.equal(validateVideoMagicBytes(riff('WAVE')).isValid, false);
		assert.equal(validateVideoMagicBytes(riff('WEBP')).isValid, false);
	});

	it('refuses files that are not videos', () => {
		assert.equal(validateVideoMagicBytes(pad([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a])).isValid, false);
		assert.equal(validateVideoMagicBytes(pad(ascii('#!/bin/sh\necho hi\n'))).isValid, false);
		assert.equal(validateVideoMagicBytes(pad([0x50, 0x4b, 0x03, 0x04])).isValid, false);
		assert.equal(validateVideoMagicBytes(new Uint8Array(4)).isValid, false);
	});

	it('reports a real mismatch: a WebM file sent as video/mp4', () => {
		const r = validateVideoMagicBytes(ebml('webm'), 'video/mp4');
		assert.equal(r.isValid, true);
		assert.equal(r.mimeTypeMismatch, true);
	});
});
