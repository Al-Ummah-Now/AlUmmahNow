/**
 * Skew protection for the two Next apps (docs/release-pipeline/SKEW-PROTECTION.md).
 *
 * OpenNext routes a request that carries an older build's deployment id to the
 * Worker version that served that build, using CF_DEPLOYMENT_MAPPING
 * ({ deploymentId: versionId | "current" }) baked into each uploaded version.
 * `opennextjs-cloudflare deploy/upload` computes it, but our pipeline uploads
 * with wrangler (promote.ts, deploy.yml), so this computes the same mapping:
 *
 *   - the new build's deployment id -> "current"
 *   - every entry of the version serving now ("current" becomes its version id)
 *   - minus versions outside the retention window (open-next.config.ts SKEW_RETENTION)
 *
 * The serving version is the one deployed at 100% (not the newest upload: a
 * candidate that was rolled back must not be remembered as "current").
 *
 *   node --experimental-strip-types scripts/release/skew-mapping.ts --worker al-ummah-web-qa --dir apps/web
 * prints the mapping JSON (deploy.yml passes it to `wrangler deploy --var`).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfApiError, createCfClient, type CfClient } from './cf-api.ts';

export const MAPPING_VAR = 'CF_DEPLOYMENT_MAPPING';
export const CURRENT = 'current';
/** Same values as SKEW_RETENTION in apps/{web,admin-web}/open-next.config.ts (a test keeps them equal) */
export const RETENTION = { maxNumberOfVersions: 20, maxVersionAgeDays: 7 };
/** Apps with skew protection */
export const SKEW_APPS = new Set(['web', 'admin-web']);

export type Mapping = Record<string, string>;

export interface WorkerVersion {
	id: string;
	createdOnMs: number;
	/** workers/triggered_by annotation (upload, version_upload, secret, ...) */
	triggeredBy?: string;
}

const UPLOADS = new Set(['upload', 'version_upload', 'create_deployment', 'deployment']);

/** Versions that may still serve old pages: newest first, within the window, code uploads only. */
export function retainedVersions(versions: WorkerVersion[], nowMs: number, retention = RETENTION): Set<string> {
	const oldest = nowMs - retention.maxVersionAgeDays * 24 * 3600 * 1000;
	const kept = [...versions]
		.sort((a, b) => b.createdOnMs - a.createdOnMs)
		.filter((v) => v.createdOnMs >= oldest)
		.filter((v) => v.triggeredBy === undefined || UPLOADS.has(v.triggeredBy))
		.slice(0, retention.maxNumberOfVersions);
	return new Set(kept.map((v) => v.id));
}

export function nextMapping(opts: { existing: Mapping; serving: string | null; retained: Set<string>; deploymentId: string }): Mapping {
	const out: Mapping = { [opts.deploymentId]: CURRENT };
	for (const [deployment, version] of Object.entries(opts.existing)) {
		if (deployment === opts.deploymentId) continue; // same build uploaded again (re-run): it is current
		const resolved = version === CURRENT ? opts.serving : version;
		// The serving version is always kept: it is what open pages were built by
		if (resolved && (resolved === opts.serving || opts.retained.has(resolved))) out[deployment] = resolved;
	}
	return out;
}

/** The deployment id the OpenNext build baked into the worker (NEXT_DEPLOYMENT_ID at build time). */
export function readDeploymentId(openNextDir: string): string {
	const init = join(openNextDir, 'cloudflare', 'init.js');
	if (!existsSync(init)) throw new Error(`${init} not found: build the app with opennextjs-cloudflare first`);
	const match = readFileSync(init, 'utf8').match(/process\.env\.DEPLOYMENT_ID\s*=\s*"([^"]+)"/);
	if (!match) throw new Error(`${init} has no deployment id: build with NEXT_DEPLOYMENT_ID set (skew protection needs one per build)`);
	return match[1];
}

interface VersionListItem {
	id: string;
	metadata?: { created_on?: string; annotations?: Record<string, string> };
	annotations?: Record<string, string>;
}

async function listVersions(cf: CfClient, worker: string): Promise<WorkerVersion[]> {
	const out: WorkerVersion[] = [];
	for (let page = 1; page <= 5; page++) {
		const result = await cf.request<{ items?: VersionListItem[] } | VersionListItem[]>('GET', `/workers/scripts/${worker}/versions?page=${page}&per_page=50`);
		const items = Array.isArray(result) ? result : (result.items ?? []);
		for (const v of items) {
			const created = v.metadata?.created_on;
			if (!v.id || !created) continue;
			const annotations = v.annotations ?? v.metadata?.annotations;
			out.push({ id: v.id, createdOnMs: new Date(created).getTime(), triggeredBy: annotations?.['workers/triggered_by'] });
		}
		if (items.length < 50) break;
	}
	return out;
}

/** The version deployed at the highest percentage (100% outside a promote), or null if never deployed. */
async function servingVersion(cf: CfClient, worker: string): Promise<string | null> {
	const result = await cf.request<{ deployments?: { versions: { version_id: string; percentage: number }[] }[] }>('GET', `/workers/scripts/${worker}/deployments`);
	const latest = result.deployments?.[0];
	return latest ? ([...latest.versions].sort((a, b) => b.percentage - a.percentage)[0]?.version_id ?? null) : null;
}

async function versionMapping(cf: CfClient, worker: string, version: string): Promise<Mapping> {
	const detail = await cf.request<{ resources?: { bindings?: { name: string; type: string; text?: string }[] } }>(
		'GET',
		`/workers/scripts/${worker}/versions/${version}`
	);
	const binding = detail.resources?.bindings?.find((b) => b.name === MAPPING_VAR && b.type === 'plain_text');
	if (!binding?.text) return {};
	try {
		return JSON.parse(binding.text) as Mapping;
	} catch {
		return {};
	}
}

/**
 * The mapping for a new upload of `worker` whose build is `deploymentId`.
 * `serving` may be passed when the caller already knows it (promote.ts).
 */
export async function computeMapping(cf: CfClient, worker: string, deploymentId: string, serving?: string | null, nowMs = Date.now()): Promise<Mapping> {
	let current: string | null;
	try {
		current = serving === undefined ? await servingVersion(cf, worker) : serving;
	} catch (error) {
		if (error instanceof CfApiError && error.status === 404) return { [deploymentId]: CURRENT }; // new worker
		throw error;
	}
	if (!current) return { [deploymentId]: CURRENT };
	const [existing, versions] = await Promise.all([versionMapping(cf, worker, current), listVersions(cf, worker)]);
	return nextMapping({ existing, serving: current, retained: retainedVersions(versions, nowMs), deploymentId });
}

/** wrangler args that bake the mapping into the upload: ['--var', 'CF_DEPLOYMENT_MAPPING:{...}'] */
export function mappingVarArgs(mapping: Mapping): string[] {
	return ['--var', `${MAPPING_VAR}:${JSON.stringify(mapping)}`];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const argv = process.argv.slice(2);
	const value = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
	const worker = value('--worker');
	const dir = value('--dir');
	if (!worker || !dir) {
		process.stderr.write('usage: skew-mapping.ts --worker <name> --dir apps/web\n');
		process.exit(2);
	}
	const deploymentId = readDeploymentId(join(resolve(dir), '.open-next'));
	const mapping = await computeMapping(createCfClient(), worker, deploymentId);
	process.stderr.write(`${worker}: deployment ${deploymentId}, ${Object.keys(mapping).length - 1} older build(s) kept for open pages\n`);
	process.stdout.write(JSON.stringify(mapping));
}
