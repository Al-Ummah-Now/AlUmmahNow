import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { currentVersion, isMissingWorker, parseVersionId, promote, releaseApps, ReleaseError, addressLine, type PromoteDeps, type ReleaseApp } from '../promote.ts';
import { parseRollbackArgs, rollbackCommands, rollbackTarget } from '../rollback.ts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { REQUEST_TIMEOUT_MS, runSmoke, VERSION_PAUSE_MS, VERSION_WAIT_MS, type CheckResult } from '../smoke.ts';
import { seoHostResponse } from './seo-host-fixture.ts';
import { attachWhenMissing, ensureCustomDomains, expectedDomains, type DomainRecord } from '../custom-domains.ts';
import { CfApiError } from '../cf-api.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const V = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const status = (...versions: [string, number][]) => JSON.stringify({ versions: versions.map(([version_id, percentage]) => ({ version_id, percentage })) });

describe('releaseApps', () => {
	it('promotes consumers and APIs before the front ends', () => {
		assert.deepEqual(
			releaseApps(ROOT, 'production').map((a) => a.app),
			['processor', 'websocket-server', 'api-videos', 'admin-api', 'scheduler', 'web', 'admin-web']
		);
	});
	it('uses the production config at the top level and env.stage for stage', () => {
		const prod = Object.fromEntries(releaseApps(ROOT, 'production').map((a) => [a.app, a]));
		const stage = Object.fromEntries(releaseApps(ROOT, 'stage').map((a) => [a.app, a]));
		assert.deepEqual(prod.web.configArgs, ['-c', 'wrangler.production.jsonc']);
		assert.deepEqual(stage.web.configArgs, ['-c', 'wrangler.production.jsonc', '--env', 'stage']);
		assert.deepEqual(prod['api-videos'].configArgs, ['-c', 'wrangler.jsonc']);
		assert.deepEqual(stage['api-videos'].configArgs, ['-c', 'wrangler.jsonc', '--env', 'stage']);
		assert.equal(prod['api-videos'].worker, 'videos');
		assert.equal(stage['api-videos'].worker, 'videos-stage');
	});
	it('uploads the one prebuilt bundle for plain workers, the OpenNext output for Next apps', () => {
		const apps = Object.fromEntries(releaseApps(ROOT, 'stage').map((a) => [a.app, a]));
		assert.equal(apps.processor.bundle, resolve(ROOT, 'dist/processor/index.js'));
		assert.equal(apps.web.bundle, null);
		assert.equal(apps['admin-web'].bundle, null);
	});
});

describe('wrangler output parsing', () => {
	it('reads the version id from versions upload and from deploy', () => {
		assert.equal(parseVersionId(`Uploaded videos\nWorker Version ID: ${V(1)}\n`), V(1));
		assert.equal(parseVersionId(`Deployed videos-stage triggers\nCurrent Version ID: ${V(2)}`), V(2));
		assert.throws(() => parseVersionId('nothing here'), /could not find the version id/);
	});
	it('refuses to release over a split deployment', () => {
		assert.equal(currentVersion(status([V(1), 100]), 'videos'), V(1));
		assert.throws(() => currentVersion(status([V(1), 90], [V(2), 10]), 'videos'), /split deployment/);
	});
	it('recognises a worker that was never deployed', () => {
		assert.ok(isMissingWorker('wrangler deployments status failed: This Worker does not exist on your account. [code: 10007]'));
		assert.ok(!isMissingWorker('Authentication error [code: 10000]'));
	});
});

/** A fake wrangler: records argv, answers status/upload/deploy. */
function fakeRun(serving: Record<string, string | null>) {
	const calls: { worker: string; args: string[] }[] = [];
	let next = 10;
	const workerOf = (cwd: string) => cwd.split('/').at(-1)!;
	const run = (cwd: string, args: string[]) => {
		const app = workerOf(cwd);
		calls.push({ worker: app, args });
		if (args[0] === 'deployments') {
			if (serving[app] === null) throw new Error('This Worker does not exist on your account. [code: 10007]');
			return status([serving[app]!, 100]);
		}
		if (args[0] === 'versions' && args[1] === 'upload') return `Worker Version ID: ${V(next++)}`;
		if (args[0] === 'deploy') return `Current Version ID: ${V(next++)}`;
		return 'ok';
	};
	return { run, calls };
}

const twoApps = (env: 'stage' | 'production'): ReleaseApp[] => releaseApps(ROOT, env).filter((a) => a.app === 'api-videos' || a.app === 'web');
const pass: CheckResult[] = [{ name: 'x', ok: true, detail: '' }];
const deps = (run: PromoteDeps['run'], smoke: PromoteDeps['smoke'] = async () => pass): PromoteDeps => ({
	run,
	smoke,
	waitForVersions: async () => {},
	waitForHosts: async () => {},
	ensureDomains: async () => {},
	log: () => {},
});

describe('promote', () => {
	it('uploads, splits 0%, smokes with overrides, then moves 100% and deploys triggers', async () => {
		const { run, calls } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const overridesSeen: (Record<string, string> | undefined)[] = [];
		const released = await promote(twoApps('production'), 'production', 'release abc', deps(run, async (_e, o) => (overridesSeen.push(o), pass)));
		assert.deepEqual(released, [
			{ app: 'api-videos', worker: 'videos', previous: V(1), candidate: V(10) },
			{ app: 'web', worker: 'al-ummah-now-production', previous: V(2), candidate: V(11) },
		]);
		const upload = calls.find((c) => c.args[1] === 'upload' && c.worker === 'api-videos')!.args;
		assert.deepEqual(upload.slice(-4), ['--no-bundle', resolve(ROOT, 'dist/api-videos/index.js'), '--message', 'release abc']);
		assert.ok(calls.some((c) => c.args.join(' ').startsWith(`versions deploy ${V(10)}@0% ${V(1)}@100%`)));
		assert.ok(calls.some((c) => c.args.join(' ').startsWith(`versions deploy ${V(10)}@100%`)));
		assert.equal(calls.filter((c) => c.args[0] === 'triggers').length, 2);
		assert.deepEqual(overridesSeen, [{ videos: V(10), 'al-ummah-now-production': V(11) }, undefined]);
	});

	it('rolls every worker back (front ends first) when the pre-traffic smoke fails', async () => {
		const { run, calls } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const fail = async () => [{ name: 'web: home page renders', ok: false, detail: 'HTTP 500' }];
		await assert.rejects(promote(twoApps('production'), 'production', 'r', deps(run, fail)), (e: unknown) => {
			assert.ok(e instanceof ReleaseError && e.rolledBack && /pre-traffic smoke failed/.test(e.message));
			return true;
		});
		const rollbacks = calls.filter((c) => c.args[0] === 'rollback');
		assert.deepEqual(rollbacks.map((c) => [c.worker, c.args[1], c.args[3]]), [
			['web', V(2), 'al-ummah-now-production'],
			['api-videos', V(1), 'videos'],
		]);
		// traffic never moved to a candidate
		assert.ok(!calls.some((c) => c.args[0] === 'versions' && c.args[1] === 'deploy' && c.args[2].endsWith('@100%')));
	});

	it('rolls back when the post-promote smoke fails', async () => {
		const { run, calls } = fakeRun({ 'api-videos': V(1), web: V(2) });
		let n = 0;
		const secondFails = async () => (n++ === 0 ? pass : [{ name: 'x', ok: false, detail: 'down' }]);
		await assert.rejects(promote(twoApps('production'), 'production', 'r', deps(run, secondFails)), /post-promote smoke failed/);
		assert.equal(calls.filter((c) => c.args[0] === 'rollback').length, 2);
	});

	it('reports a failed rollback instead of hiding it', async () => {
		const { run: base } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const run = (cwd: string, args: string[]) => {
			if (args[0] === 'rollback' && cwd.endsWith('/web')) throw new Error('API down');
			return base(cwd, args);
		};
		await assert.rejects(promote(twoApps('production'), 'production', 'r', deps(run, async () => [{ name: 'x', ok: false, detail: '' }])), (e: unknown) => {
			assert.ok(e instanceof ReleaseError && !e.rolledBack && /ROLLBACK FAILED.*al-ummah-now-production/.test(e.message));
			return true;
		});
	});

	it('creates a missing stage worker with one deploy and leaves it out of the split and rollback', async () => {
		const { run, calls } = fakeRun({ 'api-videos': null, web: V(2) });
		const released = await promote(twoApps('stage'), 'stage', 'r', deps(run));
		assert.equal(released[0].previous, null);
		const api = calls.filter((c) => c.worker === 'api-videos').map((c) => c.args[0]);
		assert.deepEqual(api, ['deployments', 'deploy']);
		assert.deepEqual(calls.find((c) => c.worker === 'api-videos' && c.args[0] === 'deploy')!.args.slice(0, 7), [
			'deploy', '-c', 'wrangler.jsonc', '--env', 'stage', '--no-bundle', resolve(ROOT, 'dist/api-videos/index.js'),
		]);
	});

	it('waits for the custom domains before smoking only when a worker was bootstrapped', async () => {
		const waited: string[] = [];
		const withWait = (run: PromoteDeps['run']) => ({ ...deps(run), waitForHosts: async (e: string) => void waited.push(e) });
		await promote(twoApps('stage'), 'stage', 'r', withWait(fakeRun({ 'api-videos': V(1), web: V(2) }).run));
		assert.deepEqual(waited, []);
		await promote(twoApps('stage'), 'stage', 'r', withWait(fakeRun({ 'api-videos': null, web: V(2) }).run));
		assert.deepEqual(waited, ['stage']);
	});

	it('never bootstraps a production worker', async () => {
		const { run, calls } = fakeRun({ 'api-videos': null, web: V(2) });
		await assert.rejects(promote(twoApps('production'), 'production', 'r', deps(run)), /does not exist in production/);
		assert.ok(!calls.some((c) => c.args[0] === 'deploy'));
	});
});

describe('rollback', () => {
	const deployments = (...list: [string, [string, number][]][]) =>
		JSON.stringify(list.map(([created_on, versions]) => ({ created_on, versions: versions.map(([version_id, percentage]) => ({ version_id, percentage })) })));

	it('targets the version served before the latest deployment', () => {
		const json = deployments(['2026-11-01', [[V(1), 100]]], ['2026-11-02', [[V(2), 0], [V(1), 100]]], ['2026-11-03', [[V(2), 100]]]);
		assert.deepEqual(rollbackTarget(json, 'videos'), { current: V(2), target: V(1) });
	});
	it('refuses a mid-promote split without --to', () => {
		const json = deployments(['2026-11-01', [[V(1), 100]]], ['2026-11-02', [[V(2), 0], [V(1), 100]]]);
		assert.throws(() => rollbackTarget(json, 'videos'), /mid-promote/);
		assert.deepEqual(rollbackTarget(json, 'videos', V(1)), { current: V(1), target: V(1) });
	});
	it('accepts every app and needs a single app for --to', () => {
		assert.equal(parseRollbackArgs(['--env', 'production']).apps.length, 7);
		assert.deepEqual(parseRollbackArgs(['--env', 'stage', '--app', 'web,api-videos', '--dry-run']).apps, ['web', 'api-videos']);
		assert.throws(() => parseRollbackArgs(['--env', 'production', '--app', 'auth']), /unknown --app auth/);
		assert.throws(() => parseRollbackArgs(['--env', 'production', '--to', V(1)]), /single --app/);
		assert.throws(() => parseRollbackArgs(['--env', 'qa']), /--env stage\|production/);
	});
	it('addresses workers by name, front ends first', () => {
		const cmds = rollbackCommands(ROOT, parseRollbackArgs(['--env', 'production', '--reason', 'bad release']));
		assert.equal(cmds[0].worker, 'al-ummah-admin-web');
		assert.equal(cmds.at(-1)!.worker, 'al-ummah-now-processor');
		assert.deepEqual(cmds[0].listArgv, ['deployments', 'list', '--json', '--name', 'al-ummah-admin-web']);
		assert.deepEqual(cmds[0].argv(V(1)), ['rollback', V(1), '--name', 'al-ummah-admin-web', '-y', '--message', 'bad release']);
	});
});

describe('smoke', () => {
	const fakeFetch = (overrides: { health?: string; callback?: string; live?: 'down' | 'html' } = {}) =>
		(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			const headers = (init?.headers ?? {}) as Record<string, string>;
			const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.pathname === '/health') {
				const m = headers['Cloudflare-Workers-Version-Overrides']?.match(new RegExp(`${url.hostname.startsWith('videos.api') ? 'videos-stage' : 'none'}="([^"]+)"`));
				return json({ status: 'healthy', deployment: overrides.health ?? m?.[1] ?? V(9) });
			}
			if (url.pathname === '/api/videos') return json({ videos: [] });
			if (url.hostname === 'live.stage.alummahnow.net') {
				if (overrides.live === 'down') throw new TypeError('fetch failed');
				if (overrides.live === 'html') return new Response('<html></html>', { status: 200 });
				return json({ now: 1 });
			}
			if (url.pathname === '/api/callback') return new Response(null, { status: 307, headers: { location: overrides.callback ?? '/auth/error?error=access_denied' } });
			if (url.hostname === 'videos.stage.alummahnow.net') {
				const seo = seoHostResponse(url.origin, false, url.pathname);
				if (seo) return seo;
			}
			return new Response('<html><body>ok</body></html>', { status: 200 });
		}) as typeof fetch;

	/** A clock that moves only when somebody sleeps. */
	const clock = () => {
		let t = 0;
		return { now: () => t, sleep: async (ms: number) => void (t += ms) };
	};

	it('passes against a healthy env', async () => {
		const results = await runSmoke({ env: 'stage', fetchImpl: fakeFetch() });
		assert.deepEqual(results.filter((r) => !r.ok), []);
		assert.equal(results.length, 11);
	});
	it('fails when the live host answers but is not the live edge, notes a host not answering yet', async () => {
		const wrong = await runSmoke({ env: 'stage', fetchImpl: fakeFetch({ live: 'html' }) });
		assert.equal(wrong.find((r) => r.name.includes('live edge'))!.ok, false);
		const down = (await runSmoke({ env: 'stage', fetchImpl: fakeFetch({ live: 'down' }) })).find((r) => r.name.includes('live edge'))!;
		assert.equal(down.ok, true);
		assert.match(down.detail, /not answering yet/);
	});
	it('fails when the candidate did not answer through the override', async () => {
		const c = clock();
		const results = await runSmoke({ env: 'stage', overrides: { 'videos-stage': V(3) }, fetchImpl: fakeFetch({ health: V(1) }), ...c });
		const health = results.find((r) => r.name === 'api-videos: health')!;
		assert.equal(health.ok, false);
		assert.match(health.detail, new RegExp(`served by version ${V(1)}, expected candidate ${V(3)}`));
		// Waited for, as long as allowed and no longer
		assert.ok(c.now() > VERSION_WAIT_MS - VERSION_PAUSE_MS && c.now() <= VERSION_WAIT_MS, String(c.now()));
		assert.deepEqual(results.filter((r) => !r.ok).map((r) => r.name), ['api-videos: health']);
	});

	describe('the version that answers (v2026.11.25.5)', () => {
		const overrides = { 'al-ummah-admin-api-stage': V(6) };
		/** admin-api's /health answers with these in turn (the last one from then on); everything else is healthy. */
		const adminHealth = (...answers: (() => Response)[]) => {
			let n = 0;
			const base = fakeFetch();
			const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
				const url = new URL(String(input));
				if (url.hostname !== 'admin.api.stage.alummahnow.net' || url.pathname !== '/health') return base(input, init);
				return answers[Math.min(n++, answers.length - 1)]();
			}) as typeof fetch;
			return { fetchImpl, asked: () => n };
		};
		const says = (deployment: string, over: object = {}) => () => new Response(JSON.stringify({ status: 'healthy', deployment, ...over }), { status: 200 });
		const health = (results: CheckResult[]) => results.find((r) => r.name === 'admin-api: health')!;

		it('waits for the candidate when an edge location still answers with the version before', async () => {
			const c = clock();
			const h = adminHealth(says(V(1)), says(V(1)), says(V(6)));
			const results = await runSmoke({ env: 'stage', overrides, fetchImpl: h.fetchImpl, ...c });
			assert.deepEqual(results.filter((r) => !r.ok), []);
			assert.equal(health(results).detail, `version ${V(6)} (after ${(2 * VERSION_PAUSE_MS) / 1000} s)`);
			assert.equal(h.asked(), 3);
			assert.equal(c.now(), 2 * VERSION_PAUSE_MS);
		});

		it('does not wait for an error, a status or an unhealthy body, not even between tries', async () => {
			const bad: [string, () => Response, RegExp][] = [
				['status', () => new Response('no', { status: 500 }), /HTTP 500/],
				['unhealthy', says(V(6), { status: 'degraded' }), /status degraded/],
				['not JSON', () => new Response('<html>', { status: 200 }), /./],
				['network', () => { throw new TypeError('fetch failed'); }, /fetch failed/],
			];
			for (const [name, answer, detail] of bad) {
				const first = clock();
				const a = adminHealth(answer, says(V(6)));
				const atOnce = health(await runSmoke({ env: 'stage', overrides, fetchImpl: a.fetchImpl, ...first }));
				assert.deepEqual([atOnce.ok, a.asked(), first.now()], [false, 1, 0], name);
				assert.match(atOnce.detail, detail, name);
				const later = clock();
				const b = adminHealth(says(V(1)), answer, says(V(6)));
				const afterOne = health(await runSmoke({ env: 'stage', overrides, fetchImpl: b.fetchImpl, ...later }));
				assert.deepEqual([afterOne.ok, b.asked(), later.now()], [false, 2, VERSION_PAUSE_MS], name);
				assert.match(afterOne.detail, detail, name);
			}
		});

		it('asks once without overrides (after the promotion, waitForVersions reads the version)', async () => {
			const c = clock();
			const h = adminHealth(says(V(1)));
			const results = await runSmoke({ env: 'stage', fetchImpl: h.fetchImpl, ...c });
			assert.deepEqual([health(results).detail, h.asked(), c.now()], [`version ${V(1)}`, 1, 0]);
		});
	});
	describe('a request that stalls', () => {
		const overrides = { 'al-ummah-admin-api-stage': V(6) };
		const isAdminHealth = (input: unknown) => {
			const url = new URL(String(input));
			return url.hostname === 'admin.api.stage.alummahnow.net' && url.pathname === '/health';
		};
		const health = (results: CheckResult[]) => results.find((r) => r.name === 'admin-api: health')!;

		it('is a failure in any other check, and every request has a timeout', async () => {
			const signals: unknown[] = [];
			const results = await runSmoke({
				env: 'stage',
				requestTimeoutMs: 30,
				fetchImpl: ((_input: unknown, init?: RequestInit) => {
					signals.push(init?.signal);
					return new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason as Error)));
				}) as unknown as typeof fetch,
			});
			assert.ok(signals.length > 5);
			assert.ok(signals.every((s) => s instanceof AbortSignal));
			assert.ok(results.length > 5);
			// The live edge host included: it passes only when it refuses the connection
			for (const r of results) {
				assert.equal(r.ok, false, r.name);
				assert.match(r.detail, /timeout/i, r.name);
			}
		});

		for (const path of ['/headers', '/body']) {
			it(`is not yet while the candidate is waited for, and a failure otherwise (${path})`, async () => {
				// A real server: no headers, or headers and half a body, then nothing
				const server = createServer((req, res) => {
					if (req.url === '/body') res.writeHead(200, { 'Content-Type': 'application/json' }).write('{"status":');
				});
				await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
				try {
					const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;
					const run = async (o?: Record<string, string>) => {
						let n = 0;
						const base = fakeFetch({ health: V(6) });
						const results = await runSmoke({
							env: 'stage',
							overrides: o,
							requestTimeoutMs: 50,
							sleep: async () => {},
							fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => (isAdminHealth(input) && n++ === 0 ? fetch(url, init) : base(input, init))) as typeof fetch,
						});
						return { health: health(results), asked: n };
					};
					const waited = await run(overrides);
					assert.deepEqual([waited.health.ok, waited.asked], [true, 2], waited.health.detail);
					const once = await run();
					assert.deepEqual([once.health.ok, once.asked], [false, 1]);
					assert.match(once.health.detail, /timeout/i);
				} finally {
					server.closeAllConnections();
					server.close();
				}
			});
		}

		it('never makes the wait longer than its deadline', async (t) => {
			const c = clock();
			let stalled = 0;
			const timeouts: number[] = [];
			t.mock.method(AbortSignal, 'timeout', (ms: number) => (timeouts.push(ms), new AbortController().signal));
			const base = fakeFetch();
			const results = await runSmoke({
				env: 'stage',
				overrides,
				now: () => c.now() + stalled,
				sleep: c.sleep,
				fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
					if (!isAdminHealth(input)) return base(input, init);
					stalled += timeouts.at(-1)!;
					throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
				}) as typeof fetch,
			});
			assert.equal(health(results).detail, `no answer in time, expected candidate ${V(6)} (after 90 s)`);
			assert.equal(c.now() + stalled, VERSION_WAIT_MS);
			assert.equal(Math.max(...timeouts), REQUEST_TIMEOUT_MS);
		});
	});
	it('fails when the callback error leaks off the error page (R4)', async () => {
		const results = await runSmoke({ env: 'stage', fetchImpl: fakeFetch({ callback: 'https://evil.example/' }) });
		assert.equal(results.find((r) => r.name.includes('callback'))!.ok, false);
	});
});

describe('d1-migrate', () => {
	it('migrates each database from the app that owns its migrations, -stage on stage', async () => {
		const { readFileSync } = await import('node:fs');
		const { parseJsonc } = await import('../jsonc.ts');
		const { migrateCommands } = await import('../d1-migrate.ts');
		for (const env of ['production', 'stage'] as const) {
			for (const { app, argv } of migrateCommands(env)) {
				const config = parseJsonc(readFileSync(resolve(ROOT, 'apps', app, 'wrangler.jsonc'), 'utf8')) as {
					d1_databases: { database_name: string; migrations_dir?: string }[];
					env: Record<string, { d1_databases: { database_name: string; migrations_dir?: string }[] }>;
				};
				const dbs = env === 'stage' ? config.env.stage.d1_databases : config.d1_databases;
				const db = dbs.find((d) => d.database_name === argv[3]);
				assert.ok(db?.migrations_dir, `${app} ${env} has no migrations_dir for ${argv[3]}`);
				assert.equal(argv.includes('--env'), env === 'stage');
			}
		}
	});
});

describe('custom domains', () => {
	it('expects each public host on its env worker, only for the apps released', () => {
		assert.deepEqual(expectedDomains('production', ['admin-api', 'api-videos', 'processor']), {
			'videos.api.alummahnow.net': 'videos',
			'admin.api.alummahnow.net': 'al-ummah-admin-api',
			'live.alummahnow.net': 'videos',
		});
		assert.equal(expectedDomains('production', ['admin-api'])['live.alummahnow.net'], undefined);
		assert.equal(expectedDomains('stage', ['admin-api'])['admin.api.stage.alummahnow.net'], 'al-ummah-admin-api-stage');
	});

	const fakeCf = (records: DomainRecord[], opts: { refusePut?: boolean } = {}) => {
		const calls: string[] = [];
		const cf = {
			async request<T>(method: string, path: string, body?: { hostname: string; service: string; zone_id: string }): Promise<T> {
				calls.push(`${method} ${path}${body ? ` ${body.hostname}->${body.service}@${body.zone_id}` : ''}`);
				if (method === 'GET') return records.map((r) => ({ ...r })) as T;
				if (method === 'PUT') {
					const rec = records.find((r) => r.hostname === body!.hostname);
					if (!rec) {
						records.push({ id: `id-${body!.hostname}`, hostname: body!.hostname, service: body!.service, zone_id: body!.zone_id });
						return {} as T;
					}
					if (opts.refusePut && rec.service !== body!.service && records.includes(rec)) throw new CfApiError(409, 'hostname in use');
					rec.service = body!.service;
					return {} as T;
				}
				if (method === 'DELETE') {
					const rec = records.find((r) => path.endsWith(r.id))!;
					records.splice(records.indexOf(rec), 1, { ...rec, service: '' });
					opts.refusePut = false;
					return {} as T;
				}
				throw new Error(method);
			},
		};
		return { cf, calls };
	};
	const rec = (hostname: string, service: string): DomainRecord => ({ id: `id-${hostname}`, hostname, service, zone_id: 'zone1' });

	it('re-attaches a prod hostname a PR preview took, keeping the zone', async () => {
		const { cf, calls } = fakeCf([rec('admin.api.alummahnow.net', 'al-ummah-admin-api-pr-466'), rec('videos.api.alummahnow.net', 'videos')]);
		const moved = await ensureCustomDomains(cf, expectedDomains('production', ['admin-api', 'api-videos']), () => {});
		assert.deepEqual(moved, ['admin.api.alummahnow.net']);
		assert.deepEqual(calls.filter((c) => !c.startsWith('GET')), ['PUT /workers/domains admin.api.alummahnow.net->al-ummah-admin-api@zone1']);
	});

	it('changes nothing when every hostname is on its worker, and leaves unattached ones alone', async () => {
		const { cf, calls } = fakeCf([rec('videos.api.alummahnow.net', 'videos')]);
		const lines: string[] = [];
		assert.deepEqual(await ensureCustomDomains(cf, expectedDomains('production', ['admin-api', 'api-videos']), (l) => lines.push(l)), []);
		assert.deepEqual(calls, ['GET /workers/domains?per_page=500']);
		assert.match(lines.join('\n'), /admin\.api\.alummahnow\.net: not attached/);
	});

	it('attaches the prod live host when no worker has it, in its sibling zone', async () => {
		const { cf, calls } = fakeCf([rec('videos.api.alummahnow.net', 'videos')]);
		const moved = await ensureCustomDomains(cf, expectedDomains('production', ['api-videos']), () => {}, attachWhenMissing('production'));
		assert.deepEqual(moved, ['live.alummahnow.net']);
		assert.deepEqual(calls.filter((c) => !c.startsWith('GET')), ['PUT /workers/domains live.alummahnow.net->videos@zone1']);
	});

	it('never attaches a missing host that is not release-attached', async () => {
		const { cf, calls } = fakeCf([rec('videos.api.alummahnow.net', 'videos')]);
		await ensureCustomDomains(cf, expectedDomains('production', ['admin-api', 'api-videos']), () => {}, []);
		assert.deepEqual(calls.filter((c) => !c.startsWith('GET')), []);
	});

	it('detaches then attaches when the API refuses to move an attached hostname', async () => {
		const { cf, calls } = fakeCf([rec('admin.api.alummahnow.net', 'al-ummah-admin-api-pr-466')], { refusePut: true });
		await ensureCustomDomains(cf, expectedDomains('production', ['admin-api']), () => {});
		assert.deepEqual(calls.filter((c) => !c.startsWith('GET')), [
			'PUT /workers/domains admin.api.alummahnow.net->al-ummah-admin-api@zone1',
			'DELETE /workers/domains/id-admin.api.alummahnow.net',
			'PUT /workers/domains admin.api.alummahnow.net->al-ummah-admin-api@zone1',
		]);
	});

	it('promote fixes domains after uploading and before the 0% version check', async () => {
		const order: string[] = [];
		const run: PromoteDeps['run'] = (_cwd, args) => {
			order.push(args.slice(0, 2).join(' '));
			if (args[0] === 'deployments') return status([V(1), 100]);
			if (args[0] === 'versions' && args[1] === 'upload') return `Worker Version ID: ${V(9)}`;
			return '';
		};
		await promote(twoApps('production'), 'production', 'r', {
			...deps(run),
			ensureDomains: async (env, apps) => void order.push(`domains ${env} ${apps.join(',')}`),
			waitForVersions: async (_e, _w, override) => void order.push(`wait ${override}`),
		});
		const domains = order.indexOf('domains production api-videos,web');
		assert.ok(domains > order.lastIndexOf('versions upload'), order.join(' | '));
		assert.ok(domains < order.indexOf('versions deploy'), order.join(' | '));
		assert.ok(domains < order.indexOf('wait true'));
	});
});

describe('promote: skew protection', () => {
	it('passes each Next upload its deployment mapping, computed against the version serving now', async () => {
		const { run, calls } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const asked: [string, string | null][] = [];
		const skewArgs: PromoteDeps['skewArgs'] = async (a, previous) => {
			asked.push([a.app, previous]);
			return a.app === 'web' ? ['--var', 'CF_DEPLOYMENT_MAPPING:{"b2":"current","b1":"v2"}'] : [];
		};
		await promote(twoApps('production'), 'production', 'release abc', { ...deps(run), skewArgs });
		assert.deepEqual(asked, [['api-videos', V(1)], ['web', V(2)]]);
		const webUpload = calls.find((c) => c.args[1] === 'upload' && c.worker === 'web')!.args;
		assert.ok(webUpload.includes('CF_DEPLOYMENT_MAPPING:{"b2":"current","b1":"v2"}'));
		const apiUpload = calls.find((c) => c.args[1] === 'upload' && c.worker === 'api-videos')!.args;
		assert.ok(!apiUpload.includes('--var'));
	});

	it('a bootstrap deploy carries the mapping too', async () => {
		const { run, calls } = fakeRun({ 'api-videos': V(1), web: null });
		await promote(twoApps('stage'), 'stage', 'release abc', { ...deps(run), skewArgs: async (a) => (a.app === 'web' ? ['--var', 'CF_DEPLOYMENT_MAPPING:{"b":"current"}'] : []) });
		const deploy = calls.find((c) => c.args[0] === 'deploy' && c.worker === 'web')!.args;
		assert.ok(deploy.includes('CF_DEPLOYMENT_MAPPING:{"b":"current"}'));
	});
});

describe('promote: skew protection check', () => {
	const snap = { app: 'web', url: 'https://videos.stage.alummahnow.net/en', deploymentId: 'b1', chunks: ['/_next/static/chunks/a.js'] };
	const result = (ok: boolean) => [{ name: 'skew protection (web)', ok, detail: ok ? 'ok' : '522' }];
	const fullDeploys = (calls: { args: string[] }[]) => calls.filter((c) => c.args[1] === 'deploy' && c.args.some((a) => a.endsWith('@100%')) && !c.args.some((a) => a.endsWith('@0%'))).length;

	for (const env of ['stage', 'production'] as const) {
		it(`${env}: the candidate at 0% must reach the serving build, or nothing moves (rollback)`, async () => {
			const { run, calls } = fakeRun({ 'api-videos': V(1), web: V(2) });
			const seen: (Record<string, string> | undefined)[] = [];
			const err = await promote(twoApps(env), env, 'r', {
				...deps(run),
				captureBuilds: async () => [snap],
				checkSkew: async (_e, _s, overrides) => (seen.push(overrides), result(false)),
			}).catch((e) => e);
			assert.ok(err instanceof ReleaseError && err.rolledBack, String(err));
			assert.match(err.message, /skew protection check failed before traffic moved/);
			assert.equal(fullDeploys(calls), 0, 'no candidate went to 100%');
			assert.equal(seen.length, 1);
			assert.equal(seen[0]?.[env === 'stage' ? 'al-ummah-now-stage' : 'al-ummah-now-production'], V(11));
		});
	}

	it('snapshots before 0%, checks at 0% (override) and again at 100%; a 100% failure on stage rolls back', async () => {
		const { run, calls } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const order: string[] = [];
		const err = await promote(twoApps('stage'), 'stage', 'r', {
			...deps(run),
			captureBuilds: async (_e, apps) => (order.push(`capture ${apps.join(',')} at ${calls.filter((c) => c.args.some((a) => a.endsWith('@0%'))).length} splits`), [snap]),
			checkSkew: async (_e, s, overrides) => (order.push(`check ${s.length} ${overrides ? '0%' : '100%'}`), result(!!overrides)),
		}).catch((e) => e);
		assert.ok(err instanceof ReleaseError && err.rolledBack, String(err));
		assert.match(err.message, /skew protection check failed: /);
		assert.deepEqual(order, ['capture api-videos,web at 0 splits', 'check 1 0%', 'check 1 100%']);
	});

	it('in production a failure at 100% (after passing at 0%) is a warning, not a rollback', async () => {
		const { run } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const lines: string[] = [];
		await promote(twoApps('production'), 'production', 'r', {
			...deps(run),
			log: (l) => lines.push(l),
			captureBuilds: async () => [snap],
			checkSkew: async (_e, _s, overrides) => result(!!overrides),
		});
		assert.ok(lines.some((l) => l.startsWith('::warning::skew protection check failed in production')));
		assert.ok(lines.some((l) => l.includes('PASS  skew protection (web) (candidate at 0%)')));
	});

	it('prints every smoke result, passes included, at 0% and at 100%', async () => {
		const { run } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const lines: string[] = [];
		const smoke: PromoteDeps['smoke'] = async () => [{ name: 'web: robots.txt', ok: true, detail: 'indexable, sitemap listed' }];
		await promote(twoApps('stage'), 'stage', 'r', { ...deps(run, smoke), log: (l) => lines.push(l) });
		assert.ok(lines.includes('PASS  web: robots.txt (candidate at 0%): indexable, sitemap listed'));
		assert.ok(lines.includes('PASS  web: robots.txt: indexable, sitemap listed'));
	});

	it('a snapshot failure does not block the release', async () => {
		const { run } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const lines: string[] = [];
		await promote(twoApps('stage'), 'stage', 'r', { ...deps(run), log: (l) => lines.push(l), captureBuilds: async () => { throw new Error('timeout'); } });
		assert.ok(lines.some((l) => l.includes('could not snapshot')));
	});
});

it('wranglerFailureDetail keeps the [ERROR] block that warnings would push out of the tail', async () => {
	const { wranglerFailureDetail } = await import('../promote.ts');
	const out = `\x1b[31m✘ [ERROR]\x1b[0m Build failed with 1 error:\n  ✘ [ERROR] Could not resolve "@al-ummah/logger"\n${'▲ [WARNING] Duplicate key "options"\n'.repeat(200)}`;
	const detail = wranglerFailureDetail(out);
	assert.match(detail, /Could not resolve "@al-ummah\/logger"/);
	assert.match(detail, /Duplicate key/);
});

describe('where a Worker answers, in the release log', () => {
	it('is the setting, unknown when it could not be read', () => {
		assert.equal(addressLine('demo', { enabled: true, previews_enabled: false }), 'demo: triggers deployed; workers.dev ON, preview URLs off');
		assert.equal(addressLine('demo', { enabled: false, previews_enabled: true }), 'demo: triggers deployed; workers.dev off, preview URLs ON');
		for (const s of [null, {}, { enabled: 'x' }]) assert.equal(addressLine('demo', s), 'demo: triggers deployed; workers.dev unknown, preview URLs unknown');
	});

	it('is logged per Worker after its triggers, and a failed read does not fail the release', async () => {
		const { run } = fakeRun({ 'api-videos': V(1), web: V(2) });
		const lines: string[] = [];
		await promote(twoApps('production'), 'production', 'r', {
			...deps(run),
			log: (l) => lines.push(l),
			addressSetting: async (worker) => {
				if (worker === 'videos') throw new Error('403');
				return { enabled: false, previews_enabled: true };
			},
		});
		assert.ok(lines.includes('videos: triggers deployed; workers.dev unknown, preview URLs unknown'));
		assert.ok(lines.includes('al-ummah-now-production: triggers deployed; workers.dev off, preview URLs ON'));
	});
});
