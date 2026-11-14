/**
 * Private source maps for the Errors page. The web apps build browser source
 * maps (productionBrowserSourceMaps); before a deploy this script uploads them
 * to the environment's R2 bucket (al-ummah-now-sourcemaps[-env]) as
 *
 *   <app>/<release>/_next/static/<path>.js.map
 *
 * and deletes them from the assets directory, so they are never served
 * publicly. admin-api reads them to symbolicate browser stacks
 * (apps/admin-api src/lib/sourcemaps.ts). <release> is the build's
 * NEXT_PUBLIC_RELEASE (first 12 characters of the commit sha).
 *
 *   node --experimental-strip-types scripts/release/upload-sourcemaps.ts \
 *     --env qa|stage|production --app web|admin-web --release <sha12> [--dir apps/web/.open-next/assets]
 */
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfToken, DEFAULT_ACCOUNT_ID } from './cf-api.ts';
import { resourcesFor, type ResourceEnv } from './ensure-resources.ts';

export function findSourceMaps(assetsDir: string): string[] {
	const root = join(assetsDir, '_next', 'static');
	const out: string[] = [];
	const walk = (dir: string) => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of entries) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (name.endsWith('.js.map')) out.push(path);
		}
	};
	walk(root);
	return out.sort();
}

/** R2 key of a map: the same shape admin-api derives from a stack frame URL. */
export function objectKey(app: string, release: string, assetsDir: string, file: string): string {
	return `${app}/${release}/${relative(assetsDir, file).split('\\').join('/')}`;
}

export function parseArgs(argv: string[]) {
	const get = (name: string) => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const env = get('env') as ResourceEnv;
	const app = get('app');
	const release = get('release');
	if (!['qa', 'stage', 'production'].includes(env)) throw new Error('--env must be qa, stage or production');
	if (app !== 'web' && app !== 'admin-web') throw new Error('--app must be web or admin-web');
	if (!release || !/^[A-Za-z0-9._-]{1,80}$/.test(release)) throw new Error('--release is required (the build commit sha, 12 chars)');
	return { env, app, release, dir: get('dir') ?? `apps/${app}/.open-next/assets` };
}

/**
 * One key segment for the R2 API path. Dots are encoded too: a catch-all
 * route's chunk (app/[locale]/studio/[channelId]/[...rest]/page-x.js.map)
 * has "..." in a segment, which the API refuses (403) as path traversal.
 */
export function keyPath(key: string): string {
	return key.split('/').map((segment) => encodeURIComponent(segment).replace(/\./g, '%2E')).join('/');
}

/** Concurrent PUTs: enough to finish quickly, few enough to stay under the R2 API's rate limit. */
export const PUT_CONCURRENCY = 4;
export const PUT_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

/** 408, 429 and 5xx are transient. 401/403 (bad or rolling token) and other 4xx are not: retrying cannot fix them. */
export function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

/**
 * Wait before retry number `attempt` (1-based): Retry-After when the API sends
 * one, else exponential backoff with full jitter, both capped.
 */
export function backoffMs(attempt: number, retryAfter: string | null, random = Math.random): number {
	const seconds = retryAfter === null ? NaN : Number(retryAfter);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, BACKOFF_CAP_MS);
	const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
	return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export type PutDeps = { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; attempts: number };
const defaultPutDeps: PutDeps = { fetch: (...args) => fetch(...args), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), attempts: PUT_ATTEMPTS };

export async function put(token: string, accountId: string, bucket: string, key: string, body: Uint8Array, deps: PutDeps = defaultPutDeps): Promise<void> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${keyPath(key)}`;
	for (let attempt = 1; ; attempt++) {
		let res: Response;
		try {
			res = await deps.fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body as BodyInit });
		} catch (error) {
			// Network failure ("fetch failed", reset, DNS): transient
			const reason = error instanceof Error ? (error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message) : String(error);
			if (attempt >= deps.attempts) throw new Error(`PUT ${bucket}/${key} -> ${reason} (after ${attempt} attempts)`);
			const wait = backoffMs(attempt, null);
			process.stderr.write(`PUT ${bucket}/${key} -> ${reason}; retry ${attempt}/${deps.attempts - 1} in ${wait} ms\n`);
			await deps.sleep(wait);
			continue;
		}
		if (res.ok) return;
		// A catch-all route's map the API still refuses: skip it (that route's stacks stay
		// unsymbolicated) rather than fail the deploy
		if (res.status === 403 && key.includes('...')) {
			process.stderr.write(`Skipped ${bucket}/${key}: refused by the R2 API (403)\n`);
			return;
		}
		if (!isRetryableStatus(res.status)) throw new Error(`PUT ${bucket}/${key} -> ${res.status}`);
		if (attempt >= deps.attempts) throw new Error(`PUT ${bucket}/${key} -> ${res.status} (after ${attempt} attempts)`);
		const wait = backoffMs(attempt, res.headers.get('retry-after'));
		process.stderr.write(`PUT ${bucket}/${key} -> ${res.status}; retry ${attempt}/${deps.attempts - 1} in ${wait} ms\n`);
		await res.body?.cancel().catch(() => {});
		await deps.sleep(wait);
	}
}

export async function uploadSourceMaps(opts: { env: ResourceEnv; app: string; release: string; dir: string }, deps = { token: cfToken(), accountId: process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID, put }) {
	const files = findSourceMaps(opts.dir);
	if (files.length === 0) return { uploaded: 0, removed: 0 };
	if (!deps.token) throw new Error('No Cloudflare credentials (CLOUDFLARE_API_TOKEN)');
	const bucket = resourcesFor(opts.env).buckets[0];
	let next = 0;
	let failed = false;
	const worker = async () => {
		// Stop taking new files once one has failed for good: the deploy fails anyway
		while (!failed && next < files.length) {
			const file = files[next++];
			try {
				await deps.put(deps.token!, deps.accountId, bucket, objectKey(opts.app, opts.release, opts.dir, file), readFileSync(file));
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(PUT_CONCURRENCY, files.length) }, worker));
	// Never served: the maps exist only in the private bucket
	for (const file of files) unlinkSync(file);
	return { uploaded: files.length, removed: files.length, bucket };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	try {
		const opts = parseArgs(process.argv.slice(2));
		uploadSourceMaps(opts)
			.then((r) => console.log(`Source maps (${opts.app} ${opts.release}): ${r.uploaded} uploaded${r.bucket ? ` to ${r.bucket}` : ''}, ${r.removed} removed from assets`))
			.catch((error) => {
				console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
				process.exit(1);
			});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(2);
	}
}
