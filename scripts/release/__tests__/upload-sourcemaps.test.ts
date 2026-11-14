import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backoffMs, findSourceMaps, isRetryableStatus, keyPath, objectKey, parseArgs, put, PUT_ATTEMPTS, PUT_CONCURRENCY, uploadSourceMaps } from '../upload-sourcemaps.ts';

function assets() {
	const dir = mkdtempSync(join(tmpdir(), 'maps-'));
	mkdirSync(join(dir, '_next/static/chunks/app'), { recursive: true });
	writeFileSync(join(dir, '_next/static/chunks/app/page-abc.js'), '1');
	writeFileSync(join(dir, '_next/static/chunks/app/page-abc.js.map'), '{"version":3}');
	writeFileSync(join(dir, '_next/static/chunks/main-1.js.map'), '{"version":3}');
	writeFileSync(join(dir, 'favicon.ico'), 'x');
	return dir;
}

describe('upload-sourcemaps', () => {
	it('finds only browser chunk maps and keys them like admin-api', () => {
		const dir = assets();
		const files = findSourceMaps(dir);
		assert.equal(files.length, 2);
		assert.equal(objectKey('web', 'abc123def456', dir, files[0]), 'web/abc123def456/_next/static/chunks/app/page-abc.js.map');
	});

	it('uploads to the environment bucket, then deletes the maps from the assets', async () => {
		const dir = assets();
		const puts: string[] = [];
		const r = await uploadSourceMaps({ env: 'qa', app: 'web', release: 'abc123def456', dir }, { token: 't', accountId: 'a', put: async (_t, _a, bucket, key) => void puts.push(`${bucket}/${key}`) });
		assert.equal(r.uploaded, 2);
		assert.ok(puts.includes('al-ummah-now-sourcemaps-qa/web/abc123def456/_next/static/chunks/main-1.js.map'));
		assert.equal(existsSync(join(dir, '_next/static/chunks/main-1.js.map')), false);
		assert.equal(existsSync(join(dir, '_next/static/chunks/app/page-abc.js')), true);
	});

	it('validates arguments', () => {
		assert.throws(() => parseArgs(['--env', 'prod', '--app', 'web', '--release', 'x']), /--env/);
		assert.throws(() => parseArgs(['--env', 'qa', '--app', 'cms', '--release', 'x']), /--app/);
		assert.deepEqual(parseArgs(['--env', 'qa', '--app', 'admin-web', '--release', 'abc']).dir, 'apps/admin-web/.open-next/assets');
	});
});

describe('keyPath', () => {
	it('encodes each segment, dots included, so a catch-all route\'s "..." is never a path segment', () => {
		assert.equal(keyPath('web/abc/_next/static/chunks/app/[locale]/studio/[channelId]/[...rest]/page-1.js.map'),
			'web/abc/_next/static/chunks/app/%5Blocale%5D/studio/%5BchannelId%5D/%5B%2E%2E%2Erest%5D/page-1%2Ejs%2Emap');
	});
});

describe('put retries', () => {
	const ok = () => new Response(null, { status: 200 });
	const status = (code: number, headers: Record<string, string> = {}) => new Response('x', { status: code, headers });
	function harness(responses: Array<() => Response | Promise<Response>>, attempts = PUT_ATTEMPTS) {
		const waits: number[] = [];
		let calls = 0;
		const deps = {
			attempts,
			sleep: async (ms: number) => void waits.push(ms),
			fetch: (async () => responses[Math.min(calls++, responses.length - 1)]()) as typeof fetch,
		};
		return { deps, waits, calls: () => calls };
	}

	it('retries 429, 5xx and network errors, then succeeds', async () => {
		const h = harness([() => status(429, { 'Retry-After': '3' }), () => status(502), () => Promise.reject(new TypeError('fetch failed')), ok]);
		await put('t', 'a', 'b', 'k.js.map', new Uint8Array([1]), h.deps);
		assert.equal(h.calls(), 4);
		assert.equal(h.waits[0], 3000, 'honours Retry-After');
		assert.equal(h.waits.length, 3);
	});

	it('does not retry 401 or 403', async () => {
		for (const code of [401, 403]) {
			const h = harness([() => status(code), ok]);
			await assert.rejects(put('t', 'a', 'b', 'k.js.map', new Uint8Array([1]), h.deps), new RegExp(`-> ${code}$`));
			assert.equal(h.calls(), 1);
		}
	});

	it('gives up after the attempt limit with the last error', async () => {
		const h = harness([() => Promise.reject(new TypeError('fetch failed'))], 3);
		await assert.rejects(put('t', 'a', 'b', 'k.js.map', new Uint8Array([1]), h.deps), /fetch failed \(after 3 attempts\)/);
		assert.equal(h.calls(), 3);
	});

	it('backs off exponentially with jitter, capped', () => {
		assert.ok(isRetryableStatus(429) && isRetryableStatus(503) && !isRetryableStatus(401) && !isRetryableStatus(404));
		assert.equal(backoffMs(1, null, () => 0), 500);
		assert.equal(backoffMs(3, null, () => 1), 4000);
		assert.equal(backoffMs(10, null, () => 1), 30_000);
		assert.equal(backoffMs(1, '120'), 30_000);
	});

	it('runs at most PUT_CONCURRENCY uploads at once', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'maps-'));
		mkdirSync(join(dir, '_next/static/chunks'), { recursive: true });
		for (let i = 0; i < 20; i++) writeFileSync(join(dir, `_next/static/chunks/c${i}.js.map`), '{}');
		let active = 0;
		let peak = 0;
		const r = await uploadSourceMaps({ env: 'qa', app: 'web', release: 'r', dir }, {
			token: 't', accountId: 'a',
			put: async () => { active++; peak = Math.max(peak, active); await new Promise((res) => setTimeout(res, 5)); active--; },
		});
		assert.equal(r.uploaded, 20);
		assert.equal(peak, PUT_CONCURRENCY);
	});
});
