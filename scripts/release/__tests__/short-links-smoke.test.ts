import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortLinksSmoke } from '../short-links-smoke.ts';

const VID = '5edb5575-2ed0-4d92-a82a-9b7cf8186470';

function fakeFetch(opts: { broken?: boolean } = {}) {
	return (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (url.hostname.startsWith('videos.api')) return Response.json({ data: [{ id: VID }] });
		const headers = { 'x-robots-tag': 'noindex, nofollow' };
		if (opts.broken) return new Response('origin down', { status: 522 });
		if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers });
		if (url.pathname === '/') return new Response(null, { status: 301, headers: { ...headers, location: 'https://www.stage.alummahnow.net/' } });
		if (url.pathname === `/v/${VID}`) {
			const lang = url.searchParams.get('lang');
			const t = url.searchParams.get('t');
			return new Response(null, { status: 301, headers: { ...headers, location: `https://videos.stage.alummahnow.net${lang ? `/${lang}` : ''}/video/${VID}${t ? `?t=${t}` : ''}` } });
		}
		return new Response('Link not found', { status: 404, headers });
	}) as typeof fetch;
}

describe('short links smoke', () => {
	it('passes when the Worker serves robots, 404s, the root and a video redirect', async () => {
		const r = await shortLinksSmoke('stage', { fetch: fakeFetch() });
		assert.deepEqual(r.map((x) => [x.name, x.ok]), r.map((x) => [x.name, true]));
	});
	it('fails every check when the host is down', async () => {
		const r = await shortLinksSmoke('stage', { fetch: fakeFetch({ broken: true }) });
		assert.deepEqual(r.map((x) => x.ok), [false, false, false, false]);
	});
});
