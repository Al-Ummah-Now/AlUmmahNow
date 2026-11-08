/**
 * Stage-then-promote (docs/release-pipeline/SPEC.md §7): upload the already-built
 * workers as new versions, give them 0% traffic, smoke-test them through the
 * version-override header, then move 100% of traffic, smoke again, and roll back
 * automatically if anything fails. Same mechanics on stage (rehearsal) and prod.
 *
 *   node --experimental-strip-types scripts/release/promote.ts --env stage
 *   node --experimental-strip-types scripts/release/promote.ts --env production
 *
 * Expects the release build: dist/<app>/index.js for the plain workers (bundled
 * once with `wrangler deploy --dry-run --outdir`) and apps/web/.open-next,
 * apps/admin-web/.open-next for the two Next apps.
 * A worker that does not exist yet (first stage release) is created with one
 * `wrangler deploy` instead: that also attaches its custom domain and applies its
 * Durable Object migrations. It has nothing to roll back to.
 * Writes release-result.json (previous and new version per worker).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSmoke, HOSTS, VERSIONED_HEALTH, WORKERS, type CheckResult, type SmokeEnv } from './smoke.ts';

export type ReleaseEnv = 'stage' | 'production';

export interface ReleaseApp {
	app: string;
	worker: string;
	/** Directory wrangler runs in */
	cwd: string;
	/** Config and env flags */
	configArgs: string[];
	/** Prebuilt bundle to upload with --no-bundle (null: the config's own main, already built) */
	bundle: string | null;
}

/**
 * Promote order: queue consumers before producers, the APIs before the front
 * ends that call them (both 0% and 100% steps follow it).
 */
export const RELEASE_ORDER = ['processor', 'websocket-server', 'api-videos', 'admin-api', 'scheduler', 'web', 'admin-web'] as const;

const CONFIG: Record<string, string> = {
	web: 'wrangler.production.jsonc',
	'admin-web': 'wrangler.production.jsonc',
};
const NEXT_APPS = new Set(['web', 'admin-web']);

export function releaseApps(root: string, env: ReleaseEnv): ReleaseApp[] {
	return RELEASE_ORDER.map((app) => ({
		app,
		worker: WORKERS[env][app],
		cwd: join(root, 'apps', app),
		configArgs: ['-c', CONFIG[app] ?? 'wrangler.jsonc', ...(env === 'stage' ? ['--env', 'stage'] : [])],
		bundle: NEXT_APPS.has(app) ? null : join(root, 'dist', app, 'index.js'),
	}));
}

/** "Worker Version ID: <uuid>" (versions upload) or "Current Version ID: <uuid>" (deploy). */
export function parseVersionId(output: string): string {
	const match = output.match(/(?:Worker|Current) Version ID:\s*([0-9a-f-]{36})/i);
	if (!match) throw new Error(`could not find the version id in wrangler output:\n${output.slice(-500)}`);
	return match[1];
}

/** The single version serving 100% (refuses to promote over an unfinished split). */
export function currentVersion(statusJson: string, worker: string): string {
	const status = JSON.parse(statusJson) as { versions: { version_id: string; percentage: number }[] };
	const full = status.versions.filter((v) => v.percentage === 100);
	if (status.versions.length !== 1 || full.length !== 1) {
		const split = status.versions.map((v) => `${v.version_id}@${v.percentage}%`).join(', ');
		throw new Error(`${worker} has a split deployment (${split}); finish or roll it back before releasing`);
	}
	return full[0].version_id;
}

/** wrangler's answer when the worker has never been deployed. */
export function isMissingWorker(message: string): boolean {
	return /does not exist on your account|code: 10007/i.test(message);
}

export type Runner = (cwd: string, args: string[]) => string;

const runWrangler: Runner = (cwd, args) => {
	try {
		return execFileSync('npx', ['wrangler', ...args], {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, CI: 'true' },
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 32 * 1024 * 1024,
		});
	} catch (error) {
		const e = error as { stderr?: string; stdout?: string; message: string };
		throw new Error(`wrangler ${args.slice(0, 2).join(' ')} failed: ${(e.stderr || e.stdout || e.message).trim().slice(-800)}`);
	}
};

export interface Released {
	app: string;
	worker: string;
	/** null: the worker was created by this release (bootstrap) */
	previous: string | null;
	candidate: string;
}

export interface PromoteDeps {
	run: Runner;
	smoke: (env: SmokeEnv, overrides?: Record<string, string>) => Promise<CheckResult[]>;
	/** Resolves when every versioned /health reports its candidate (through the override, if set) */
	waitForVersions: (env: ReleaseEnv, wanted: Record<string, string>, override: boolean) => Promise<void>;
	log: (line: string) => void;
}

// (plain fields: node's strip-only TypeScript has no parameter properties)
export class ReleaseError extends Error {
	readonly released: Released[];
	readonly rolledBack: boolean;
	constructor(message: string, released: Released[], rolledBack: boolean) {
		super(message);
		this.released = released;
		this.rolledBack = rolledBack;
	}
}

const failures = (results: CheckResult[]) => results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`);

export async function promote(apps: ReleaseApp[], env: ReleaseEnv, message: string, deps: PromoteDeps): Promise<Released[]> {
	const { run, log } = deps;
	const released: Released[] = [];
	const bundleArgs = (a: ReleaseApp) => (a.bundle ? ['--no-bundle', a.bundle] : []);

	// 1. What serves now (the rollback target), then upload candidates (no traffic yet).
	//    A worker that does not exist yet is created outright (stage bootstrap only).
	for (const a of apps) {
		let previous: string | null;
		try {
			previous = currentVersion(run(a.cwd, ['deployments', 'status', '--json', ...a.configArgs]), a.worker);
		} catch (error) {
			if (!isMissingWorker((error as Error).message)) throw error;
			if (env === 'production') throw new Error(`${a.worker} does not exist in production; deploy it by hand once before releasing`);
			previous = null;
		}
		if (previous === null) {
			const candidate = parseVersionId(run(a.cwd, ['deploy', ...a.configArgs, ...bundleArgs(a), '--message', `${message} (bootstrap)`]));
			released.push({ app: a.app, worker: a.worker, previous, candidate });
			log(`${a.worker}: created with ${candidate} (bootstrap)`);
			continue;
		}
		const candidate = parseVersionId(run(a.cwd, ['versions', 'upload', ...a.configArgs, ...bundleArgs(a), '--message', message]));
		released.push({ app: a.app, worker: a.worker, previous, candidate });
		log(`${a.worker}: uploaded ${candidate} (serving ${previous})`);
	}
	const promoted = released.map((r, i) => ({ r, a: apps[i] })).filter(({ r }) => r.previous !== null);

	// Every worker is attempted even if one rollback fails; the failures are reported together
	const rollback = (reason: string) => {
		log(`Rolling back: ${reason}`);
		const failed: string[] = [];
		// Reverse release order: front ends first, so a new front end never calls an old API
		for (const { r, a } of [...promoted].reverse()) {
			try {
				run(a.cwd, ['rollback', r.previous!, '--name', a.worker, '-y', '--message', `auto-rollback: ${reason}`.slice(0, 100)]);
				log(`${a.worker}: rolled back to ${r.previous}`);
			} catch (error) {
				failed.push(`${a.worker}: ${(error as Error).message}`);
			}
		}
		if (failed.length) throw new ReleaseError(`ROLLBACK FAILED, fix by hand (pnpm release:rollback): ${failed.join('; ')}`, released, false);
	};
	const versioned = (list: Released[]) =>
		Object.fromEntries(list.filter((r) => VERSIONED_HEALTH.some((v) => v.app === r.app)).map((r) => [r.app, r.candidate]));

	// 2. Candidates at 0%: reachable only through the override header
	try {
		for (const { r, a } of promoted) {
			run(a.cwd, ['versions', 'deploy', `${r.candidate}@0%`, `${r.previous}@100%`, ...a.configArgs, '-y', '--message', `${message} (0%)`]);
		}
		const overrides = Object.fromEntries(released.map((r) => [r.worker, r.candidate]));
		await deps.waitForVersions(env, versioned(promoted.map((p) => p.r)), true);
		const pre = failures(await deps.smoke(env, overrides));
		if (pre.length) throw new Error(`pre-traffic smoke failed: ${pre.join('; ')}`);
		log('Pre-traffic smoke passed on the candidates');
	} catch (error) {
		rollback((error as Error).message);
		throw new ReleaseError((error as Error).message, released, true);
	}

	// 3. 100% traffic, triggers (crons, custom domains), and the smoke a user would see
	try {
		for (const { r, a } of promoted) {
			run(a.cwd, ['versions', 'deploy', `${r.candidate}@100%`, ...a.configArgs, '-y', '--message', message]);
			run(a.cwd, ['triggers', 'deploy', ...a.configArgs]);
		}
		await deps.waitForVersions(env, versioned(released), false);
		const post = failures(await deps.smoke(env));
		if (post.length) throw new Error(`post-promote smoke failed: ${post.join('; ')}`);
		log('Promoted; smoke passed');
	} catch (error) {
		rollback((error as Error).message);
		throw new ReleaseError((error as Error).message, released, true);
	}
	return released;
}

/** Polls each versioned /health until it answers with the wanted version (deployments take a few seconds to propagate). */
export async function waitForVersions(env: ReleaseEnv, wanted: Record<string, string>, override: boolean, timeoutMs = 120_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (const [app, version] of Object.entries(wanted)) {
		const { host } = VERSIONED_HEALTH.find((v) => v.app === app)!;
		const headers: Record<string, string> = { 'User-Agent': 'al-ummah-now-release' };
		if (override) headers['Cloudflare-Workers-Version-Overrides'] = `${WORKERS[env][app]}="${version}"`;
		let last = 'no response';
		for (;;) {
			try {
				const res = await fetch(`${HOSTS[env][host]}/health`, { headers });
				const body = (await res.json()) as { deployment?: string };
				if (body.deployment === version) break;
				last = `HTTP ${res.status}, version ${body.deployment}`;
			} catch (error) {
				last = (error as Error).message;
			}
			if (Date.now() > deadline) throw new Error(`${app} did not serve ${version} within ${timeoutMs / 1000}s (last: ${last})`);
			await new Promise((r) => setTimeout(r, 3000));
		}
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
	const argv = process.argv.slice(2);
	const env = (argv[argv.indexOf('--env') + 1] ?? '') as ReleaseEnv;
	if (env !== 'stage' && env !== 'production') {
		process.stderr.write('usage: promote.ts --env stage|production [--message <text>] [--only app,app]\n');
		process.exit(2);
	}
	const message = argv.includes('--message') ? argv[argv.indexOf('--message') + 1] : `release ${process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'}`;
	const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
	const root = resolve(new URL('../..', import.meta.url).pathname);
	const log = (line: string) => process.stdout.write(`${line}\n`);
	const writeResult = (result: object) => writeFileSync(join(root, 'release-result.json'), JSON.stringify(result, null, 2));
	const apps = releaseApps(root, env).filter((a) => !only || only.includes(a.app));
	try {
		const released = await promote(apps, env, message, {
			run: runWrangler,
			smoke: (e, overrides) => runSmoke({ env: e, overrides }),
			waitForVersions,
			log,
		});
		writeResult({ env, status: 'promoted', released });
	} catch (error) {
		const released = error instanceof ReleaseError ? error.released : [];
		writeResult({ env, status: error instanceof ReleaseError && error.rolledBack ? 'rolled-back' : 'failed', error: (error as Error).message, released });
		process.stderr.write(`Release failed: ${(error as Error).message}\n`);
		process.exit(1);
	}
}
