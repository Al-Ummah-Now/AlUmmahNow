/**
 * Deletes E2E run accounts (e2e+<run>-<attempt>-<name>@e2e.alummahnow.net) from
 * the auth server: soft delete + immediate purge through its QA/stage-only route
 * POST /test/run-users/delete/:email (AlUmmahNowAuth routes/test-run-users.ts).
 * Only accounts the run provisioning path created can be deleted there.
 *
 *   # a job's own accounts (the workflow's always() step), from E2E_RUN_USERS_FILE
 *   node --experimental-strip-types scripts/e2e/teardown-run-users.ts --auth-url <url> --file <file> [--file <file>]
 *   # the sweeper: every run account older than 24 hours (crashed or killed runners)
 *   node --experimental-strip-types scripts/e2e/teardown-run-users.ts --auth-url <url> --stale-hours 24 --strict
 *
 * Content the accounts owned is removed before this by the suite itself (web:
 * e2e/cleanup-test-content.ts --run-users) or, for leftovers, by the QA cleanup.
 * Needs E2E_CODE_SINK_SECRET and TEST_PROMOTE_SECRET; never prints them.
 * Refuses any host but QA or stage auth. Exit code: 0 unless --strict and
 * something could not be deleted.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRunUserEmail, parseRunUsers } from '../../apps/web/e2e/test-utils/run-users.ts';

export const ALLOWED_AUTH_HOSTS = new Set(['auth.qa.alummahnow.net', 'auth.stage.alummahnow.net']);

export interface Args {
	authUrl: string;
	files: string[];
	staleHours: number | null;
	strict: boolean;
}

export function parseArgs(argv: string[]): Args {
	const args: Args = { authUrl: '', files: [], staleHours: null, strict: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--auth-url') args.authUrl = argv[++i] ?? '';
		else if (a === '--file') args.files.push(argv[++i] ?? '');
		else if (a === '--stale-hours') {
			const h = Number(argv[++i]);
			if (!Number.isFinite(h) || h < 1) throw new Error('--stale-hours needs a number >= 1');
			args.staleHours = h;
		} else if (a === '--strict') args.strict = true;
		else throw new Error(`unknown argument ${a}`);
	}
	assertAuthUrl(args.authUrl);
	if (!args.files.length && args.staleHours === null) throw new Error('pass --file <file> and/or --stale-hours <n>');
	return args;
}

/** The local E2E stack's issuer (scripts/local-stack: a throwaway Auth with local data only). */
export const LOCAL_STACK_AUTH = new Set(['http://localhost:3301', 'http://127.0.0.1:3301']);

export function assertAuthUrl(url: string): void {
	let host = '';
	try {
		const u = new URL(url);
		if (LOCAL_STACK_AUTH.has(u.origin)) return;
		if (u.protocol !== 'https:') throw new Error('not https');
		host = u.host;
	} catch {
		throw new Error(`--auth-url must be an https URL, got ${JSON.stringify(url)}`);
	}
	if (!ALLOWED_AUTH_HOSTS.has(host)) throw new Error(`refusing ${host}: only QA and stage auth hosts are allowed`);
}

export type Outcome = 'deleted' | 'absent' | 'unavailable' | 'failed';

interface Deps {
	fetch: typeof fetch;
	sleep: (ms: number) => Promise<void>;
	log: (line: string) => void;
}

function headers(env: NodeJS.ProcessEnv): Record<string, string> {
	const sink = env.E2E_CODE_SINK_SECRET;
	const promote = env.TEST_PROMOTE_SECRET;
	if (!sink || !promote) throw new Error('E2E_CODE_SINK_SECRET and TEST_PROMOTE_SECRET are required');
	return { 'X-E2E-Secret': sink, 'X-Test-Secret': promote, 'User-Agent': 'al-ummah-e2e-teardown' };
}

/** Deletes one account; retries rate limits and transient errors. */
export async function deleteRunUser(authUrl: string, email: string, env: NodeJS.ProcessEnv, deps: Deps): Promise<Outcome> {
	if (!isRunUserEmail(email)) throw new Error(`not a run account: ${email}`);
	const url = `${authUrl.replace(/\/$/, '')}/test/run-users/delete/${encodeURIComponent(email)}`;
	for (let attempt = 1; attempt <= 5; attempt++) {
		let status = 0;
		let body: { found?: number; purged?: number; error?: string } = {};
		try {
			const res = await deps.fetch(url, { method: 'POST', headers: headers(env) });
			status = res.status;
			body = (await res.json().catch(() => ({}))) as typeof body;
			if (status === 429) {
				await deps.sleep(Number(res.headers.get('Retry-After') ?? '60') * 1000);
				continue;
			}
		} catch (error) {
			deps.log(`::warning::${email}: ${(error as Error).message} (attempt ${attempt})`);
			await deps.sleep(2000 * attempt);
			continue;
		}
		if (status === 200) return body.found ? 'deleted' : 'absent';
		// The route is missing: the auth deployment predates it or run-account support is off
		if (status === 404) return 'unavailable';
		if (status >= 500) {
			await deps.sleep(2000 * attempt);
			continue;
		}
		deps.log(`::warning::${email}: auth answered ${status} ${body.error ?? ''}`.trim());
		return 'failed';
	}
	return 'failed';
}

export async function listStale(authUrl: string, hours: number, env: NodeJS.ProcessEnv, deps: Deps): Promise<string[] | null> {
	const res = await deps.fetch(`${authUrl.replace(/\/$/, '')}/test/run-users/stale?hours=${hours}`, { headers: headers(env) });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`listing stale run accounts failed: ${res.status}`);
	const body = (await res.json()) as { emails?: string[] };
	return (body.emails ?? []).filter(isRunUserEmail);
}

export async function run(args: Args, env: NodeJS.ProcessEnv, deps: Deps): Promise<Record<Outcome, number>> {
	const emails = new Set<string>();
	for (const file of args.files) {
		if (!existsSync(file)) {
			deps.log(`[teardown] ${file} does not exist: this job registered no run accounts`);
			continue;
		}
		for (const e of parseRunUsers(readFileSync(file, 'utf8'))) emails.add(e);
	}
	if (args.staleHours !== null) {
		const stale = await listStale(args.authUrl, args.staleHours, env, deps);
		if (stale === null) deps.log('::warning::the auth server has no /test/run-users/stale route here');
		for (const e of stale ?? []) emails.add(e);
	}
	const counts: Record<Outcome, number> = { deleted: 0, absent: 0, unavailable: 0, failed: 0 };
	for (const email of emails) {
		const outcome = await deleteRunUser(args.authUrl, email, env, deps);
		counts[outcome]++;
		deps.log(`[teardown] ${email}: ${outcome}`);
	}
	deps.log(`[teardown] ${emails.size} run account(s): ${JSON.stringify(counts)}`);
	if (counts.unavailable) deps.log(`::warning::${counts.unavailable} run account(s) not deleted: the auth server has no run-account teardown route (left for the sweeper)`);
	if (counts.failed) deps.log(`::warning::${counts.failed} run account(s) could not be deleted`);
	return counts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const deps: Deps = {
		fetch,
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		log: (line) => process.stdout.write(`${line}\n`),
	};
	(async () => {
		const args = parseArgs(process.argv.slice(2));
		const counts = await run(args, process.env, deps);
		if (args.strict && (counts.failed || counts.unavailable)) process.exit(1);
	})().catch((error) => {
		process.stderr.write(`teardown-run-users: ${(error as Error).message}\n`);
		process.exit(1);
	});
}
