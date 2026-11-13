import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlImages, jsonImageUrls, jsonLdImages, judge, metaImages, sharedCacheable, signedUrlsInHtml, thumbnailCheck, tokenOf } from '../thumbnail-check.ts';

const ID = '0174501b-cbc9-41b4-b386-93f9bb8429a7';
const NOW = 1_794_500_000;
const dir = (exp: number, file = 'thumbnail_1.jpg') => `https://vz-x.b-cdn.net/bcdn_token=T&expires=${exp}&token_path=%2F${ID}%2F/${ID}/${file}`;
const file = (exp: number) => `https://vz-x.b-cdn.net/${ID}/thumbnail.jpg?token=T&expires=${exp}`;
const priv = (exp: number) => `https://media.alummahnow.net/priv/${exp}.SIG/${ID}/rev/thumb.jpg`;

describe('thumbnail check: tokens', () => {
	it('reads the expiry of every token form and ignores unsigned URLs', () => {
		assert.deepEqual(tokenOf(dir(5)), { form: 'bunny-directory', expires: 5 });
		assert.deepEqual(tokenOf(file(1794600000)), { form: 'bunny-file', expires: 1794600000 });
		assert.deepEqual(tokenOf(priv(1794600000)), { form: 'r2-private', expires: 1794600000 });
		for (const u of [`https://media.alummahnow.net/pub/${ID}/r/thumb.jpg`, 'https://images.alummahnow.net/thumbnails/x/custom.jpg?width=320', `https://videos.alummahnow.net/thumb/${ID}.jpg`]) {
			assert.equal(tokenOf(u).form, null, u);
		}
	});
});

describe('thumbnail check: judging', () => {
	it('fails an expired thumbnail anywhere, and a playback token on an image', () => {
		const f = judge('api', 'api', [file(NOW - 60), dir(NOW + 3600)], NOW, false);
		assert.deepEqual(f.map((x) => [x.level, x.rule]), [['fail', 'expired'], ['fail', 'playback token on an image']]);
	});
	it('does not flag the directory-signed playlist itself', () => {
		assert.deepEqual(judge('api', 'api', [dir(NOW + 3600, 'playlist.m3u8')], NOW, false), []);
	});
	it('fails any signed share image (crawlers keep them for days)', () => {
		const f = judge('meta', 'share', [file(NOW + 6 * 3600)], NOW, false);
		assert.deepEqual(f.map((x) => [x.level, x.rule]), [['fail', 'signed share image']]);
	});
	it('warns on signed URLs that www/CMS store, failing them only in strict mode', () => {
		assert.equal(judge('www', 'stored', [file(NOW + 3600)], NOW, false)[0].level, 'warn');
		assert.equal(judge('www', 'stored', [file(NOW + 3600)], NOW, true)[0].level, 'fail');
	});
	it('never prints a token', () => {
		for (const x of judge('s', 'share', [file(NOW - 1), dir(NOW - 1)], NOW, false)) assert.doesNotMatch(x.detail, /token=T\b|bcdn_token=T\b/);
	});
});

describe('thumbnail check: extraction', () => {
	it('reads image fields from JSON, meta tags, JSON-LD and src/poster attributes only', () => {
		assert.deepEqual(jsonImageUrls({ id: ID, thumbnailUrl: file(1), title: 'x https://vz-x.b-cdn.net/a.jpg', thumbnailSizes: { hd: file(2) }, cover: { thumbnailUrl: file(3) } }), [file(1), file(2), file(3)]);
		const html = `<meta property="og:image" content="${file(9).replace(/&/g, '&amp;')}"><meta name="twitter:image" content="x"><script type="application/ld+json">{"@type":"VideoObject","thumbnailUrl":"${file(8)}"}</script><img src="${file(7).replace(/&/g, '&amp;')}"><video poster="${priv(6)}"></video><script>self.__next_f.push(["${dir(5).slice(0, 60)}"])</script>`;
		assert.deepEqual(metaImages(html), [file(9), 'x']);
		assert.deepEqual(jsonLdImages(html), [file(8)]);
		assert.deepEqual(htmlImages(html), [file(7), priv(6)]);
	});
});

describe('thumbnail check: server-rendered HTML (#1209)', () => {
	it('finds signed URLs in markup and in the escaped RSC payload, never printing a token', () => {
		const html = `<img src="/thumb/${ID}.jpg?w=320"><img src="${file(1).replace(/&/g, '&amp;')}"><script>self.__next_f.push(["\\"${file(2).replace('&', '\\u0026')}\\""])</script><a href="${dir(3)}">x</a><img src="${priv(NOW)}">`;
		const found = signedUrlsInHtml(html);
		assert.equal(found.length, 4);
		for (const f of found) assert.doesNotMatch(f, /token=T\b|\.SIG/);
		assert.deepEqual(signedUrlsInHtml(`<img src="/thumb/${ID}.jpg" srcset="/thumb/${ID}.jpg?w=640 640w"><img src="https://images.alummahnow.net/a.jpg?width=320">`), []);
	});
	it('flags HTML that a shared cache may keep', () => {
		assert.equal(sharedCacheable('private, no-cache, no-store, max-age=0, must-revalidate'), false);
		assert.equal(sharedCacheable('public, max-age=600'), true);
		assert.equal(sharedCacheable('s-maxage=60'), true);
		assert.equal(sharedCacheable(null), false);
	});
});

describe('thumbnail check: end to end with a fake site', () => {
	const stable = `https://videos.alummahnow.net/thumb/${ID}.jpg`;
	const site = (overrides: Record<string, () => Response> = {}) =>
		(async (input: string | URL | Request) => {
			const url = String(input);
			// Override keys are a host ("b-cdn.net" matches *.b-cdn.net) or a host/path prefix
			const { hostname } = new URL(url);
			const hostPath = hostname + new URL(url).pathname;
			for (const [k, make] of Object.entries(overrides)) if (k.startsWith('/') ? new URL(url).pathname.startsWith(k) : hostname === k || hostname.endsWith(`.${k}`) || hostPath.startsWith(k)) return make();
			const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.includes('/thumb/00000000')) return new Response('nf', { status: 404 });
			if (url.includes('/thumb/')) return new Response('img', { status: 200, headers: { 'content-type': 'image/jpeg' } });
			if (url.includes('/oembed')) return j({ thumbnail_url: stable });
			if (url.includes('/api/videos?')) return j({ data: [{ id: ID, channelId: 'c1', thumbnailUrl: file(NOW + 6 * 3600) }] });
			if (url.includes('/api/playlists?')) return j({ data: [{ id: 'p1' }] });
			if (url.includes('videos.api')) return j({ id: ID, thumbnailUrl: file(NOW + 6 * 3600) });
			const page = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' } });
			if (url.includes('/video/')) return page(`<meta property="og:image" content="${stable}"><img src="/thumb/${ID}.jpg" srcset="/thumb/${ID}.jpg?w=320 320w">`);
			if (url.includes('/embed/')) return new Response(`<img src="${stable}">`, { status: 200 });
			if (url.includes('cms.')) return j({ items: [] });
			if (new URL(url).hostname.endsWith('.b-cdn.net')) return new Response('x', { status: 206 });
			return page('<html></html>');
		}) as typeof fetch;

	it('passes a healthy site', async () => {
		const { findings } = await thumbnailCheck('production', { fetch: site(), now: () => NOW * 1000 }, { strictStored: false });
		assert.deepEqual(findings.filter((f) => f.level === 'fail'), []);
	});
	it('fails when the watch page shares a signed thumbnail, or /thumb leaks an unknown id', async () => {
		const { findings } = await thumbnailCheck('production', {
			fetch: site({
				'/en/video/': () => new Response(`<meta property="og:image" content="${file(NOW + 3600).replace(/&/g, '&amp;')}">`, { status: 200 }),
				'/thumb/00000000': () => new Response('img', { status: 200, headers: { 'content-type': 'image/jpeg' } }),
			}),
			now: () => NOW * 1000,
		}, { strictStored: false });
		const rules = new Set(findings.filter((f) => f.level === 'fail').map((f) => f.rule));
		assert.ok(rules.has('signed share image'));
		assert.ok(rules.has('share image not the stable /thumb URL'));
		assert.ok(rules.has('stable share image leaks or errors'));
	});
	it('fails when a server-rendered page carries a signed thumbnail or is publicly cacheable', async () => {
		const { findings } = await thumbnailCheck('production', {
			fetch: site({
				'/en/channels/': () => new Response(`<img src="${file(NOW + 3600).replace(/&/g, '&amp;')}">`, { status: 200, headers: { 'cache-control': 'private, no-store' } }),
				'/en/playlist/': () => new Response('<html></html>', { status: 200, headers: { 'cache-control': 'public, max-age=86400' } }),
			}),
			now: () => NOW * 1000,
		}, { strictStored: false });
		const fails = findings.filter((f) => f.level === 'fail');
		assert.ok(fails.some((f) => f.rule === 'signed URL in server-rendered HTML' && f.surface.startsWith('web SSR /en/channels/')));
		assert.ok(fails.some((f) => f.rule === 'server-rendered HTML cacheable by shared caches' && f.surface.startsWith('web SSR /en/playlist/')));
	});
	it('fails when the API serves an expired thumbnail or Bunny refuses a fresh one', async () => {
		const { findings } = await thumbnailCheck('production', {
			fetch: site({ 'videos.api.alummahnow.net/api/videos/': () => new Response(JSON.stringify({ id: ID, thumbnailUrl: file(NOW - 10) }), { status: 200 }), 'b-cdn.net': () => new Response('', { status: 403 }) }),
			now: () => NOW * 1000,
		}, { strictStored: false });
		const rules = new Set(findings.filter((f) => f.level === 'fail').map((f) => f.rule));
		assert.ok(rules.has('expired'));
		assert.ok(rules.has('thumbnail unreachable'));
	});
});
