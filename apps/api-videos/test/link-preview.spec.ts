/** Link post previews (SS14, lib/link-preview.ts): URL safety, redirects, size limits, tag parsing. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_MAX_BYTES, PreviewError, checkUrl, fetchPreview, parseAttrs, parsePreview, unescapeHtml } from '../src/lib/link-preview';

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return e instanceof PreviewError ? e.code : 'other';
	}
	return 'ok';
};

const page = (html: string, init: ResponseInit = {}) => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

describe('link preview', () => {
	it('refuses unsafe addresses', () => {
		for (const u of ['ftp://x.com', 'javascript:alert(1)', 'not a url']) assert.equal(code(() => checkUrl(u)), 'bad_url', u);
		for (const u of [
			'http://localhost/',
			'http://127.0.0.1/',
			'http://10.1.2.3/',
			'http://172.20.0.1/',
			'http://192.168.1.1/',
			'http://169.254.169.254/latest',
			'http://100.64.0.1/',
			'http://0.0.0.0/',
			'http://[::1]/',
			'http://2130706433/',
			'http://0x7f.1/',
			'http://printer.local/',
			'http://intranet/',
			'https://example.com:8443/',
			'https://user:pw@example.com/',
		])
			assert.equal(code(() => checkUrl(u)), 'blocked', u);
		assert.equal(code(() => checkUrl('https://example.com/a?b=1')), 'ok');
		assert.equal(code(() => checkUrl('http://93.184.216.34/')), 'ok');
	});

	it('reads Open Graph tags, falls back to <title>, resolves relative images', () => {
		const html = `<!doctype html><html><head>
			<meta charset="utf-8"><title>Fallback &amp; title</title>
			<meta property="og:title" content="The &quot;real&quot; title">
			<meta property='og:site_name' content='Example News'>
			<meta name=description content="A short   description">
			<meta property="og:image" content="/img/card.png">
			</head><body><meta property="og:title" content="body tag ignored"></body></html>`;
		const p = parsePreview(html, 'https://news.example.com/story/1');
		assert.equal(p.title, 'The "real" title');
		assert.equal(p.siteName, 'Example News');
		assert.equal(p.description, 'A short description');
		assert.equal(p.imageUrl, 'https://news.example.com/img/card.png');
		const q = parsePreview('<head><title> Only &amp;lt;title&amp;gt; </title></head>', 'https://e.com/');
		assert.equal(q.title, 'Only &lt;title&gt;'); // unescaped once
		assert.equal(q.siteName, null);
		assert.equal(q.imageUrl, null);
		assert.equal(parsePreview('<meta property="og:image" content="javascript:x">', 'https://e.com/').imageUrl, null);
	});

	it('parses attributes in any quoting and unescapes entities once', () => {
		assert.deepEqual(parseAttrs(' property="og:title" content=\'a "b"\' data-x=y /'), { property: 'og:title', content: 'a "b"', 'data-x': 'y' });
		assert.equal(unescapeHtml('&#x41;&#66;&amp;amp;&lt;'), 'AB&amp;<');
	});

	it('follows checked redirects and refuses one into a private address', async () => {
		const calls: string[] = [];
		const ok: typeof fetch = async (u) => {
			calls.push(String(u));
			if (String(u).endsWith('/a')) return new Response(null, { status: 301, headers: { location: '/b' } });
			return page('<head><meta property="og:title" content="B"></head>');
		};
		const p = await fetchPreview('https://e.com/a', ok);
		assert.equal(p.title, 'B');
		assert.equal(p.url, 'https://e.com/a');
		assert.deepEqual(calls, ['https://e.com/a', 'https://e.com/b']);

		const evil: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
		await assert.rejects(fetchPreview('https://e.com/', evil), (e: PreviewError) => e.code === 'blocked');

		const loop: typeof fetch = async (u) => new Response(null, { status: 302, headers: { location: `${u}x` } });
		await assert.rejects(fetchPreview('https://e.com/', loop), (e: PreviewError) => e.code === 'too_many_redirects');
	});

	it('refuses non-HTML and reads only the first 512 KB of a page', async () => {
		const pdf: typeof fetch = async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } });
		await assert.rejects(fetchPreview('https://e.com/x.pdf', pdf), (e: PreviewError) => e.code === 'not_html');
		const big = '<head><meta property="og:title" content="Big"></head>' + 'x'.repeat(PAGE_MAX_BYTES * 2);
		const p = await fetchPreview('https://e.com/', async () => page(big));
		assert.equal(p.title, 'Big');
		const down: typeof fetch = async () => new Response('no', { status: 500 });
		await assert.rejects(fetchPreview('https://e.com/', down), (e: PreviewError) => e.code === 'unreachable');
	});
});
