import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortLinksReport, shortLinksSmoke } from '../short-links-smoke.ts';

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

describe('short links smoke on a new custom domain', () => {
	it('waits for DNS/TLS, then checks (the v2026.11.13.6 stage case)', async () => {
		let calls = 0;
		const ok = fakeFetch();
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			if (new URL(String(input)).hostname.endsWith('.link') && ++calls <= 5) throw new TypeError('fetch failed');
			return ok(input, init);
		}) as typeof fetch;
		const report = await shortLinksReport('stage', { fetch: fetchImpl, sleep: async () => {} });
		assert.equal(report.unreachable, false);
		assert.ok(report.results.every((x) => x.ok), JSON.stringify(report.results));
	});
	it('a host that never answers is reported unreachable, nothing checked', async () => {
		const report = await shortLinksReport('production', { fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, sleep: async () => {}, reachAttempts: 4 });
		assert.equal(report.unreachable, true);
		assert.equal(report.results.length, 1);
	});
	it('a wrong answer still fails once the host is up', async () => {
		const report = await shortLinksReport('stage', { fetch: fakeFetch({ broken: true }), sleep: async () => {} });
		assert.equal(report.unreachable, false);
		assert.ok(report.results.some((x) => !x.ok));
	});
});
