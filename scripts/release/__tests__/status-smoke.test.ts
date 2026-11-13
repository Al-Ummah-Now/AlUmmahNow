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
		const r = await statusSmoke('stage', { fetch: (async (u: string) => (urls.push(u), healthy(u))) as unknown as typeof fetch, sleep: async () => {} });
		assert.ok(r.every((x) => x.ok), JSON.stringify(r));
		assert.ok(urls.every((u) => u.startsWith('https://status.stage.alummahnow.net/')));
	});
	it('retries, then fails with the reason', async () => {
		let n = 0;
		const r = await statusSmoke('production', {
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
		assert.equal(n, 3);
		assert.deepEqual(r.filter((x) => !x.ok).map((x) => [x.name, x.detail]), [['healthz (Worker + D1)', 'HTTP 503']]);
	});
});
