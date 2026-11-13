import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_COUNT, statusSmoke } from '../status-smoke.ts';

const comps = Array.from({ length: COMPONENT_COUNT }, (_, i) => `<li data-component="c${i}">`).join('');
const healthy = (url: string) => {
	if (url.endsWith('/healthz')) return Response.json({ status: 'ok', environment: 'stage' });
	if (url.endsWith('/ar')) return new Response('<html lang="ar" dir="rtl">');
	if (url.endsWith('/api/status.json')) return Response.json({ overall: 'operational', components: Array(COMPONENT_COUNT).fill({}) });
	if (url.endsWith('/feed.atom')) return new Response('<feed xmlns="http://www.w3.org/2005/Atom">');
	return new Response(`<html lang="en" dir="ltr">${comps}`);
};

describe('status smoke', () => {
	it('passes a healthy page on the env host', async () => {
		const urls: string[] = [];
		const { unreachable, results: r } = await statusSmoke('stage', { fetch: (async (u: string) => (urls.push(u), healthy(u))) as unknown as typeof fetch, sleep: async () => {} });
		assert.equal(unreachable, false);
		assert.ok(r.every((x) => x.ok), JSON.stringify(r));
		assert.ok(urls.every((u) => u.startsWith('https://status.stage.alummahnow.net/')));
	});
	it('retries, then fails with the reason', async () => {
		let n = 0;
		const { results: r } = await statusSmoke('production', {
			attempts: 3,
			sleep: async () => {},
			fetch: (async (u: string) => {
				if (u.endsWith('/healthz')) {
					n++;
					return Response.json({ status: 'error' }, { status: 503 });
				}
				return healthy(u);
			}) as unknown as typeof fetch,
		});
		assert.equal(n, 4, 'one reachability probe, then 3 attempts');
		assert.deepEqual(r.filter((x) => !x.ok).map((x) => [x.name, x.detail]), [['healthz (Worker + D1)', 'HTTP 503']]);
	});
});

describe('status smoke on a new custom domain', () => {
	it('waits for DNS/TLS, then checks (the v2026.11.13.5 stage case)', async () => {
		let calls = 0;
		const fetchImpl = (async (u: string) => {
			calls++;
			if (calls <= 12) throw new TypeError('fetch failed');
			return healthy(u);
		}) as unknown as typeof fetch;
		const report = await statusSmoke('stage', { fetch: fetchImpl, sleep: async () => {} });
		assert.equal(report.unreachable, false);
		assert.ok(report.results.every((x) => x.ok), JSON.stringify(report.results));
	});
	it('a host that never answers is reported unreachable, not failed checks', async () => {
		const report = await statusSmoke('production', { fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, sleep: async () => {}, reachAttempts: 5 });
		assert.equal(report.unreachable, true);
		assert.equal(report.results.length, 1);
	});
	it('a wrong answer still fails once the host is up', async () => {
		const report = await statusSmoke('stage', { attempts: 2, sleep: async () => {}, fetch: (async (u: string) => (u.endsWith('/api/status.json') ? Response.json({ components: [] }) : healthy(u))) as unknown as typeof fetch });
		assert.equal(report.unreachable, false);
		assert.deepEqual(report.results.filter((x) => !x.ok).map((x) => x.name), ['JSON']);
	});
});
