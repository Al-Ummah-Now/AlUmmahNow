import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HOSTS, parseRobots, headLinks, runSmoke, type SmokeEnv } from '../smoke.ts';
import { seoHostResponse, type SeoHostFaults } from './seo-host-fixture.ts';

/** Every host healthy; the web host's crawler answers come from the fixture. */
function fakeEnv(env: SmokeEnv, faults: SeoHostFaults = {}) {
	return (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
		if (url.pathname === '/health') return json({ status: 'healthy', deployment: 'v1' });
		if (url.pathname === '/api/videos') return json({ videos: [] });
		if (url.pathname === '/api/callback') return new Response(null, { status: 307, headers: { location: '/auth/error?error=access_denied' } });
		if (url.origin === HOSTS[env].web) {
			const seo = seoHostResponse(url.origin, env === 'production', url.pathname, faults);
			if (seo) return seo;
		}
		return new Response('<html><body>ok</body></html>');
	}) as typeof fetch;
}

const seoChecks = async (env: SmokeEnv, faults?: SeoHostFaults) =>
	(await runSmoke({ env, fetchImpl: fakeEnv(env, faults) })).filter((r) => /robots|sitemap|home page head/.test(r.name));

describe('release smoke: what crawlers see', () => {
	it('production: indexable, sitemap listed, self-canonical home with hreflang and og:image', async () => {
		const results = await seoChecks('production');
		assert.equal(results.length, 3);
		assert.deepEqual(results.filter((r) => !r.ok), []);
	});
	it('stage: robots disallow everything and the home is noindex', async () => {
		const results = await seoChecks('stage');
		assert.deepEqual(results.filter((r) => !r.ok), []);
		assert.match(results.find((r) => r.name === 'web: robots.txt')!.detail, /non-production/);
	});
	it('fails production that disallows everything', async () => {
		const results = await seoChecks('production', { disallowAll: true });
		assert.equal(results.find((r) => r.name === 'web: robots.txt')!.ok, false);
	});
	it('fails a noindex production home, and an indexable stage home', async () => {
		assert.equal((await seoChecks('production', { wrongRobotsHeader: true })).find((r) => r.name.startsWith('web: home'))!.ok, false);
		assert.equal((await seoChecks('stage', { wrongRobotsHeader: true })).find((r) => r.name.startsWith('web: home'))!.ok, false);
	});
	it('fails a sitemap <loc> off the host, a canonical on another scheme or no og:image', async () => {
		assert.equal((await seoChecks('production', { foreignLoc: true })).find((r) => r.name.includes('sitemap'))!.ok, false);
		const http = (await seoChecks('production', { canonical: 'http://videos.alummahnow.net/en' })).find((r) => r.name.startsWith('web: home'))!;
		assert.match(http.detail, /canonical http:/);
		assert.equal((await seoChecks('production', { noOgImage: true })).find((r) => r.name.startsWith('web: home'))!.ok, false);
	});
});

describe('robots.txt and head parsing', () => {
	it('groups consecutive User-agent lines and keeps Sitemap lines apart', () => {
		const { groups, sitemaps } = parseRobots('User-agent: a\nUser-agent: b\nDisallow: /x # why\n\nUser-agent: *\nAllow: /\nSitemap: https://h/sitemap.xml\n');
		assert.deepEqual(groups, [{ agents: ['a', 'b'], rules: ['disallow: /x'] }, { agents: ['*'], rules: ['allow: /'] }]);
		assert.deepEqual(sitemaps, ['https://h/sitemap.xml']);
	});
	it('reads canonical, hreflang and og:image in any attribute order', () => {
		const head = headLinks('<link href="https://h/en" rel="canonical"/><link hreflang="ar" rel="alternate" href="https://h/ar?a=1&amp;b=2"/><meta content="https://h/i.png" property="og:image"/>');
		assert.deepEqual(head, { canonical: ['https://h/en'], alternates: { ar: 'https://h/ar?a=1&b=2' }, ogImage: ['https://h/i.png'] });
	});
});
