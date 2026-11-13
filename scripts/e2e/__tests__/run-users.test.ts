import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRunUserEmail, parseRunUsers, runId, runUserAddress, runUserEmail, runUserName } from '../../../apps/web/e2e/test-utils/run-users.ts';
import { assertAuthUrl, CONCURRENCY, deleteRunUser, inPool, MIN_STEP_MINUTES, parseArgs, run, STALE_PAGE, stepMinutes } from '../teardown-run-users.ts';

const ENV = { E2E_RUN_ID: '42887909300-2' } as NodeJS.ProcessEnv;
const SECRETS = { E2E_CODE_SINK_SECRET: 'sink-secret-value', TEST_PROMOTE_SECRET: 'promote-secret-value' } as NodeJS.ProcessEnv;

describe('run users', () => {
	it('builds e2e+<run>-<attempt>-<name> addresses the auth server accepts', () => {
		assert.equal(runUserAddress('web-chromium-single', ENV), 'e2e+42887909300-2-web-chromium-single@e2e.alummahnow.net');
		assert.equal(runUserAddress('Mobile Chrome / Single', ENV), 'e2e+42887909300-2-mobile-chrome-single@e2e.alummahnow.net');
		assert.ok(isRunUserEmail(runUserAddress('x'.repeat(200), ENV)));
	});

	it('is off without E2E_RUN_ID and refuses a malformed one', () => {
		assert.equal(runId({} as NodeJS.ProcessEnv), null);
		assert.throws(() => runId({ E2E_RUN_ID: 'abc' } as NodeJS.ProcessEnv));
		assert.throws(() => runUserAddress('x', {} as NodeJS.ProcessEnv));
		assert.throws(() => runUserName('---'));
	});

	it('records every generated address before it is used', () => {
		const dir = mkdtempSync(join(tmpdir(), 'run-users-'));
		try {
			const file = join(dir, 'users.txt');
			const env = { ...ENV, E2E_RUN_USERS_FILE: file };
			const a = runUserEmail('admin-chromium-admin', env);
			runUserEmail('admin-chromium-viewer', env);
			runUserEmail('admin-chromium-admin', env);
			assert.deepEqual(parseRunUsers(readFileSync(file, 'utf8')), [a, 'e2e+42887909300-2-admin-chromium-viewer@e2e.alummahnow.net']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('only treats run addresses as run accounts', () => {
		assert.deepEqual(parseRunUsers('qa-admin@e2e.alummahnow.net\ntest-single-1795000000001@e2e.alummahnow.net\nE2E+1-1-A@e2e.alummahnow.net\n\n'), [
			'e2e+1-1-a@e2e.alummahnow.net',
		]);
		assert.equal(isRunUserEmail('e2e+1-1-a@e2e.alummahnow.net.evil.com'), false);
	});
});

function fakeDeps(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const lines: string[] = [];
	return {
		calls,
		lines,
		deps: {
			fetch: (async (url: string, init?: RequestInit) => {
				calls.push({ url, init });
				const r = responses.shift() ?? { status: 200, body: { found: 1 } };
				return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
			}) as typeof fetch,
			sleep: async () => undefined,
			log: (line: string) => lines.push(line),
		},
	};
}

describe('teardown-run-users', () => {
	it('only talks to QA or stage auth over https', () => {
		assertAuthUrl('https://auth.qa.alummahnow.net');
		assertAuthUrl('https://auth.stage.alummahnow.net/');
		assert.throws(() => assertAuthUrl('https://auth.alummahnow.net'));
		assert.throws(() => assertAuthUrl('http://auth.qa.alummahnow.net'));
		// The local E2E stack's issuer, and nothing else on plain http
		assertAuthUrl('http://localhost:3301');
		assert.throws(() => assertAuthUrl('http://localhost:3302'));
		assert.throws(() => assertAuthUrl('http://evil.example.com:3301'));
		assert.throws(() => parseArgs(['--auth-url', 'https://auth.qa.alummahnow.net']));
	});

	it('posts the encoded address with both secrets, and retries a rate limit', async () => {
		const { calls, deps } = fakeDeps([{ status: 429, headers: { 'Retry-After': '1' } }, { status: 200, body: { found: 1, purged: 1 } }]);
		const out = await deleteRunUser('https://auth.qa.alummahnow.net', 'e2e+1-1-a@e2e.alummahnow.net', SECRETS, deps);
		assert.equal(out, 'deleted');
		assert.equal(calls.length, 2);
		assert.equal(calls[1].url, 'https://auth.qa.alummahnow.net/test/run-users/delete/e2e%2B1-1-a%40e2e.alummahnow.net');
		const h = calls[1].init!.headers as Record<string, string>;
		assert.equal(h['X-E2E-Secret'], 'sink-secret-value');
		assert.equal(h['X-Test-Secret'], 'promote-secret-value');
	});

	it('reports a missing route as unavailable and refuses non-run addresses', async () => {
		const { deps } = fakeDeps([{ status: 404 }]);
		assert.equal(await deleteRunUser('https://auth.qa.alummahnow.net', 'e2e+1-1-a@e2e.alummahnow.net', SECRETS, deps), 'unavailable');
		await assert.rejects(deleteRunUser('https://auth.qa.alummahnow.net', 'qa-admin@e2e.alummahnow.net', SECRETS, deps));
	});

	it('deletes the recorded accounts and the stale ones once each, never printing a secret', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'teardown-'));
		try {
			const file = join(dir, 'users.txt');
			writeFileSync(file, 'e2e+1-1-a@e2e.alummahnow.net\ne2e+1-1-b@e2e.alummahnow.net\ne2e+1-1-a@e2e.alummahnow.net\n');
			const { calls, lines, deps } = fakeDeps([
				{ status: 200, body: { emails: ['e2e+1-1-b@e2e.alummahnow.net', 'e2e+0-1-old@e2e.alummahnow.net', 'qa-admin@e2e.alummahnow.net'] } },
				{ status: 200, body: { found: 1 } },
				{ status: 200, body: { found: 0 } },
				{ status: 403, body: { error: 'not_provisioned' } },
			]);
			const counts = await run(
				parseArgs(['--auth-url', 'https://auth.qa.alummahnow.net', '--file', file, '--file', join(dir, 'missing.txt'), '--stale-hours', '24']),
				SECRETS,
				deps,
			);
			assert.deepEqual(counts, { deleted: 1, absent: 1, unavailable: 0, failed: 1 });
			assert.equal(calls.length, 4);
			assert.ok(!lines.join('\n').includes('secret-value'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('lists stale accounts again while a listing comes back full (#929)', async () => {
		const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => `e2e+9-1-s${from + i}@e2e.alummahnow.net`);
		const responses: Array<{ status: number; body?: unknown }> = [{ status: 200, body: { emails: page(0, STALE_PAGE) } }];
		for (let i = 0; i < STALE_PAGE; i++) responses.push({ status: 200, body: { found: 1 } });
		responses.push({ status: 200, body: { emails: page(STALE_PAGE, 3) } });
		const { calls, deps } = fakeDeps(responses);
		const counts = await run(parseArgs(['--auth-url', 'https://auth.qa.alummahnow.net', '--stale-hours', '24']), SECRETS, deps);
		assert.equal(counts.deleted, STALE_PAGE + 3);
		// 2 listings, 203 deletes; the short second listing ends the run
		assert.equal(calls.filter((c) => c.url.includes('/stale')).length, 2);
		assert.equal(calls.length, STALE_PAGE + 3 + 2);
	});

	it('deletes CONCURRENCY accounts at a time, every one once', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'teardown-'));
		try {
			const file = join(dir, 'users.txt');
			const emails = Array.from({ length: 11 }, (_, i) => `e2e+1-1-p${i}@e2e.alummahnow.net`);
			writeFileSync(file, `${emails.join('\n')}\n`);
			let inFlight = 0;
			let most = 0;
			const seen: string[] = [];
			const deps = {
				fetch: (async (url: string) => {
					seen.push(decodeURIComponent(url.split('/').pop() as string));
					inFlight++;
					most = Math.max(most, inFlight);
					await new Promise((r) => setTimeout(r, 5));
					inFlight--;
					return new Response(JSON.stringify({ found: 1 }), { status: 200 });
				}) as typeof fetch,
				sleep: async () => undefined,
				log: () => undefined,
			};
			const counts = await run(parseArgs(['--auth-url', 'https://auth.stage.alummahnow.net', '--file', file]), SECRETS, deps);
			assert.equal(counts.deleted, 11);
			assert.equal(most, CONCURRENCY);
			assert.deepEqual([...seen].sort(), [...emails].sort());
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('the pool never runs more than its limit, and runs everything with fewer items than lanes', async () => {
		let inFlight = 0;
		let most = 0;
		const done: number[] = [];
		await inPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
			inFlight++;
			most = Math.max(most, inFlight);
			await new Promise((r) => setTimeout(r, 1 + (n % 3)));
			inFlight--;
			done.push(n);
		});
		assert.equal(most, 3);
		assert.deepEqual(done.sort(), [1, 2, 3, 4, 5, 6, 7]);
		const few: number[] = [];
		await inPool([1], 4, async (n) => void few.push(n));
		assert.deepEqual(few, [1]);
		await inPool([], 4, async () => assert.fail('no work'));
	});

	it('gives up on a request that hangs past its timeout, retries it, then reports it failed', async () => {
		let calls = 0;
		const lines: string[] = [];
		const deps = {
			// Never answers: only the request's timeout ends it
			fetch: ((_url: string, init?: RequestInit) => {
				calls++;
				return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
			}) as typeof fetch,
			sleep: async () => undefined,
			log: (line: string) => lines.push(line),
			requestTimeoutMs: 20,
		};
		const started = Date.now();
		assert.equal(await deleteRunUser('https://auth.stage.alummahnow.net', 'e2e+1-1-a@e2e.alummahnow.net', SECRETS, deps), 'failed');
		assert.equal(calls, 5);
		assert.ok(Date.now() - started < 5000, 'bounded by the per-request timeout');
		assert.ok(lines.some((l) => l.includes('attempt 5')));
	});

	it('sizes the step timeout to the accounts: 5 minutes at least, 15 s per account per lane', () => {
		assert.equal(stepMinutes(0), MIN_STEP_MINUTES);
		assert.equal(stepMinutes(12), MIN_STEP_MINUTES);
		// 100 accounts, 4 lanes: 25 x 15 s = 6.25 min, + 2
		assert.equal(stepMinutes(100), 9);
		assert.equal(stepMinutes(400), 2 + Math.ceil((100 * 15) / 60));
		assert.ok(stepMinutes(100, 1) > stepMinutes(100));
	});

	it('--step-minutes needs the files and counts each recorded run account once', () => {
		assert.throws(() => parseArgs(['--auth-url', 'https://auth.qa.alummahnow.net', '--stale-hours', '24', '--step-minutes']));
		assert.equal(parseArgs(['--auth-url', 'https://auth.qa.alummahnow.net', '--file', 'x', '--step-minutes']).stepMinutes, true);
	});
});
