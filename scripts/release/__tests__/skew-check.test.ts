import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkOldBuildServed, parseBuild } from '../skew-check.ts';

const HTML = `<html data-dpl-id="abc-1-1"><script src="/_next/static/chunks/webpack-1.js?dpl=abc-1-1"></script><script src="/_next/static/chunks/app/%5Blocale%5D/page-2.js"></script><script src="/_next/static/chunks/webpack-1.js"></script></html>`;

const fakeFetch = (status: (url: string) => number) =>
	(async (url: string | URL) => new Response('x', { status: status(String(url)) })) as unknown as typeof fetch;

describe('skew check', () => {
	it('reads the deployment id and unique chunks of a page', () => {
		assert.deepEqual(parseBuild(HTML), { deploymentId: 'abc-1-1', chunks: ['/_next/static/chunks/webpack-1.js', '/_next/static/chunks/app/%5Blocale%5D/page-2.js'] });
		assert.deepEqual(parseBuild('<html>'), { deploymentId: null, chunks: [] });
	});

	const before = { app: 'web', url: 'https://videos.stage.alummahnow.net/en', ...parseBuild(HTML) };

	it('passes when the old chunks load with ?dpl, and counts the ones only the old build has', async () => {
		const r = await checkOldBuildServed(before, fakeFetch((u) => (u.includes('dpl=') ? 200 : u.includes('page-2') ? 404 : 200)));
		assert.equal(r.ok, true);
		assert.match(r.detail, /2 chunk\(s\) served, 1 of them only through skew protection/);
	});

	it('fails when an old chunk is gone', async () => {
		const r = await checkOldBuildServed(before, fakeFetch((u) => (u.includes('page-2') ? 404 : 200)));
		assert.equal(r.ok, false);
		assert.match(r.detail, /page-2\.js\?dpl=abc-1-1 answered 404/);
	});

	const noWait = { attempts: 3, delayMs: 0, sleep: async () => {} };

	it('retries an old chunk while its preview URL is still starting (5xx, network error)', async () => {
		let calls = 0;
		const flaky = (async (url: string | URL) => {
			if (String(url).includes('dpl=')) {
				calls++;
				if (calls === 1) return new Response('x', { status: 522 });
				if (calls === 2) throw new Error('fetch failed');
			}
			return new Response('x', { status: 200 });
		}) as unknown as typeof fetch;
		const r = await checkOldBuildServed(before, flaky, 8, noWait);
		assert.equal(r.ok, true, r.detail);
	});

	it('fails when the old chunk keeps answering 5xx', async () => {
		const r = await checkOldBuildServed(before, fakeFetch((u) => (u.includes('dpl=') ? 522 : 200)), 8, noWait);
		assert.equal(r.ok, false);
		assert.match(r.detail, /answered 522 \(after 3 tries\)/);
	});

	it('does not retry a 404: the old chunk is gone', async () => {
		let dplCalls = 0;
		const r = await checkOldBuildServed(
			before,
			fakeFetch((u) => (u.includes('dpl=') && u.includes('page-2') ? (dplCalls++, 404) : 200)),
			8,
			noWait,
		);
		assert.equal(r.ok, false);
		assert.equal(dplCalls, 1);
	});

	it('has nothing to check for a build from before skew protection', async () => {
		const r = await checkOldBuildServed({ ...before, deploymentId: null }, fakeFetch(() => 500));
		assert.equal(r.ok, true);
	});

	it('sends the version override to reach a candidate at 0%', async () => {
		const seen: string[] = [];
		const f = (async (_u: string | URL, init?: RequestInit) => {
			seen.push(String((init?.headers as Record<string, string>)['Cloudflare-Workers-Version-Overrides']));
			return new Response('x', { status: 200 });
		}) as unknown as typeof fetch;
		await checkOldBuildServed(before, f, 1, noWait, { 'Cloudflare-Workers-Version-Overrides': 'w="v"' });
		assert.deepEqual(seen, ['w="v"', 'w="v"']);
	});
});
