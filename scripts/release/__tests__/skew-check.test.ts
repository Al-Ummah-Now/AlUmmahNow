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

	it('has nothing to check for a build from before skew protection', async () => {
		const r = await checkOldBuildServed({ ...before, deploymentId: null }, fakeFetch(() => 500));
		assert.equal(r.ok, true);
	});
});
