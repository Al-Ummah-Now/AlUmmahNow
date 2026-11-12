import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	deliveryBucket,
	mediaPlayUrl,
	mediaToken,
	mediaTokenExpiry,
	MEDIA_ACCESS_FOR,
	newMediaRev,
	normaliseDeliverySettings,
	parsePrivatePath,
	pickDeliverySource,
	verifyMediaToken,
} from '@al-ummah/shared-types';

const VID = '0b3c2a1e-1111-2222-3333-444455556666';
const REV = 'abcdefgh12345678';

describe('private media tokens', () => {
	it('round-trips through the URL and the edge parser', async () => {
		const now = 1_800_000_000;
		const expires = mediaTokenExpiry(now);
		const url = await mediaPlayUrl('media.qa.alummahnow.net', 'priv', VID, REV, 'master.m3u8', { key: 'k', expires });
		const parsed = parsePrivatePath(new URL(url).pathname);
		assert.ok(parsed);
		assert.equal(parsed.rest, 'master.m3u8');
		assert.ok(await verifyMediaToken('k', parsed.token, VID, REV, now));
	});
	it('rejects another key, another video, an expired token and a far-future one', async () => {
		const now = 1_800_000_000;
		const token = await mediaToken('k', VID, REV, mediaTokenExpiry(now));
		assert.ok(!(await verifyMediaToken('other', token, VID, REV, now)));
		assert.ok(!(await verifyMediaToken('k', token, VID.replace('0b', '0c'), REV, now)));
		assert.ok(!(await verifyMediaToken('k', token, VID, REV, now + 8 * 3600)));
		const far = await mediaToken('k', VID, REV, now + 30 * 24 * 3600);
		assert.ok(!(await verifyMediaToken('k', far, VID, REV, now)));
	});
	it('keeps the expiry stable within the hour (cacheable URLs)', () => {
		assert.equal(mediaTokenExpiry(1_800_000_100), mediaTokenExpiry(1_800_000_100 + 60));
	});
	it('refuses traversal and odd paths', () => {
		assert.equal(parsePrivatePath(`/priv/t/${VID}/${REV}/../x`), null);
		assert.equal(parsePrivatePath(`/priv/t/${VID}/${REV}/a//b`), null);
		assert.equal(parsePrivatePath(`/priv/t/${VID}/BADREV/master.m3u8`), null);
		assert.ok(parsePrivatePath(`/priv/t/${VID}/${REV}/720p/seg_00001.m4s`));
	});
	it('public URLs need no key', async () => {
		assert.equal(await mediaPlayUrl('m.example', 'pub', VID, REV), `https://m.example/pub/${VID}/${REV}/master.m3u8`);
		await assert.rejects(mediaPlayUrl('m.example', 'priv', VID, REV));
	});
	it('makes valid revs', () => {
		for (let i = 0; i < 20; i++) assert.match(newMediaRev(), /^[a-z0-9]{16}$/);
	});
	it('maps visibility to access', () => {
		assert.equal(MEDIA_ACCESS_FOR({ isPublic: true }), 'pub');
		assert.equal(MEDIA_ACCESS_FOR({ isPublic: false }), 'priv');
		assert.equal(MEDIA_ACCESS_FOR({ visibility: 'unlisted' }), 'priv');
		assert.equal(MEDIA_ACCESS_FOR(null), 'priv');
	});
});

describe('delivery switch', () => {
	it('normalises bad input to safe values', () => {
		assert.deepEqual(normaliseDeliverySettings({ mode: 'nope' as never, r2Percent: 250, assign: 'x' as never }), { mode: 'bunny', r2Percent: 100, assign: 'video', transcode: true });
	});
	it('always plays Bunny when R2 is not ready', () => {
		assert.equal(pickDeliverySource({ mode: 'r2', r2Percent: 100, assign: 'video', transcode: true }, false, VID), 'bunny');
	});
	it('splits close to the requested share over many keys', () => {
		const s = normaliseDeliverySettings({ mode: 'split', r2Percent: 10 });
		let r2 = 0;
		for (let i = 0; i < 10_000; i++) if (pickDeliverySource(s, true, `video-${i}`) === 'r2') r2++;
		assert.ok(r2 > 800 && r2 < 1200, `got ${r2}`);
		assert.equal(deliveryBucket('x'), deliveryBucket('x'));
	});
});

describe('failure details are scrubbed', () => {
	it('strips Bunny tokens, signed query strings, API keys and URL paths', async () => {
		const { scrubMediaText, sanitizeFailure } = await import('@al-ummah/shared-types');
		const dirty = 'GET https://vz-215a1ffd-a5a.b-cdn.net/bcdn_token=SECRET&expires=1794474000&token_path=%2Fx%2F/x/original 403; X-API-Key: abc123; https://m.example/priv/1999999999.AAAA/v/r/master.m3u8?token=zzz';
		const clean = scrubMediaText(dirty, 1000);
		for (const secret of ['SECRET', 'abc123', 'zzz', '1999999999.AAAA', '/x/original']) assert.ok(!clean.includes(secret), `${secret} in ${clean}`);
		const f = sanitizeFailure({ stage: 'encode', error: 'ffmpeg exited 1', attempt: 2, elapsedMs: 1234.5, at: 'now', stderrTail: Array.from({ length: 30 }, (_, i) => `line ${i} https://h.example/a?token=t${i}`) });
		assert.equal(f.stderrTail?.length, 20);
		assert.ok(f.stderrTail!.every((l) => !/token=t/.test(l)));
		assert.equal(f.elapsedMs, 1235);
	});
});
