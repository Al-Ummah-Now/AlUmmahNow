/**
 * Creates the Cloudflare resources a release's configs bind to but that may
 * not exist yet (a new binding's first deploy would otherwise fail):
 *
 *   node --experimental-strip-types scripts/release/ensure-resources.ts --env qa|stage|production
 *
 * Idempotent: existing queues and buckets are left alone. Add a resource here
 * in the same PR that first binds it.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CfApiError, createCfClient, type CfClient } from './cf-api.ts';

export type ResourceEnv = 'qa' | 'stage' | 'production';

export interface Resources {
	queues: string[];
	buckets: string[];
	/**
	 * Buckets whose objects expire after this many days (an R2 lifecycle rule, the bucket's only one).
	 * QA and stage source maps (cost review 2026-11-14: sourcemaps-qa held 95k objects, 11 GB, one set
	 * per main push): a stack older than that is not symbolicated, nothing else changes.
	 */
	expireAfterDays?: Record<string, number>;
}

/** Days a source map is kept, by environment; production keeps every release's. */
const SOURCEMAP_DAYS: Partial<Record<ResourceEnv, number>> = { qa: 14, stage: 30 };
export const EXPIRY_RULE_ID = 'al-ummah-expire';

/** Resources by environment. Production names have no suffix. */
export function resourcesFor(env: ResourceEnv): Resources {
	const s = env === 'production' ? '' : `-${env}`;
	return {
		// Errors page: async ingest and its dead letters (apps/admin-api ErrorsIngest.ts)
		// R2 video delivery (apps/media): transcode jobs and their dead letters (DLQ name ends in the env, see queue-consumers)
		queues: [`al-ummah-now-errors${s}`, `al-ummah-now-errors-dlq${s}`, `al-ummah-now-transcode${s}`, `al-ummah-now-transcode-dlq${s}`],
		// Private source maps of the web apps (apps/admin-api lib/sourcemaps.ts; upload-sourcemaps.ts)
		// Renditions served from media.<env>.alummahnow.net (docs/media-delivery/R2-DELIVERY-PLAN.md)
		// (public, behind the R2 custom domain) and private/unlisted ones (no public access; the media Worker serves them)
		// CSAM evidence (docs/specs/CSAM-RESPONSE.md §4): private, never public, no lifecycle rule
		buckets: [`al-ummah-now-sourcemaps${s}`, `al-ummah-now-media${s}`, `al-ummah-now-media-private${s}`, `al-ummah-now-media-originals${s}`, `al-ummah-now-csam-evidence${s}`],
		...(SOURCEMAP_DAYS[env] ? { expireAfterDays: { [`al-ummah-now-sourcemaps${s}`]: SOURCEMAP_DAYS[env]! } } : {}),
	};
}

export async function ensureResources(cf: CfClient, wanted: Resources, log: (line: string) => void = console.log): Promise<{ created: string[] }> {
	const created: string[] = [];
	const existing = new Set<string>();
	for (let page = 1; page <= 20; page++) {
		const queues = await cf.request<{ queue_name: string }[]>('GET', `/queues?page=${page}&per_page=100`);
		for (const q of queues ?? []) existing.add(q.queue_name);
		if (!queues || queues.length < 100) break;
	}
	for (const name of wanted.queues) {
		if (existing.has(name)) continue;
		await cf.request('POST', '/queues', { queue_name: name });
		created.push(`queue ${name}`);
		log(`Created queue ${name}`);
	}
	for (const name of wanted.buckets) {
		try {
			await cf.request('GET', `/r2/buckets/${encodeURIComponent(name)}`);
		} catch (error) {
			if (!(error instanceof CfApiError) || error.status !== 404) throw error;
			await cf.request('POST', '/r2/buckets', { name });
			created.push(`bucket ${name}`);
			log(`Created R2 bucket ${name}`);
		}
	}
	for (const [name, days] of Object.entries(wanted.expireAfterDays ?? {})) {
		if (name.includes('csam')) throw new Error(`${name}: CSAM evidence never gets a lifecycle rule`);
		const maxAge = days * 86_400;
		const current = await cf.request<{ rules?: LifecycleRule[] }>('GET', `/r2/buckets/${encodeURIComponent(name)}/lifecycle`);
		const rules = current?.rules ?? [];
		const ours = rules.find((r) => r.id === EXPIRY_RULE_ID);
		if (ours?.enabled && ours.deleteObjectsTransition?.condition?.maxAge === maxAge) continue;
		// The PUT replaces the bucket's rules: keep any other rule as it is
		const next: LifecycleRule[] = [
			...rules.filter((r) => r.id !== EXPIRY_RULE_ID),
			{ id: EXPIRY_RULE_ID, enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge } } },
		];
		await cf.request('PUT', `/r2/buckets/${encodeURIComponent(name)}/lifecycle`, { rules: next });
		created.push(`lifecycle ${name} ${days}d`);
		log(`Objects in ${name} now expire after ${days} days`);
	}
	return { created };
}

interface LifecycleRule {
	id: string;
	enabled: boolean;
	conditions: { prefix: string };
	deleteObjectsTransition?: { condition?: { type: 'Age'; maxAge: number } };
	[key: string]: unknown;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const i = process.argv.indexOf('--env');
	const env = (i >= 0 ? process.argv[i + 1] : '') as ResourceEnv;
	if (!['qa', 'stage', 'production'].includes(env)) {
		process.stderr.write('usage: ensure-resources.ts --env qa|stage|production\n');
		process.exit(2);
	}
	ensureResources(createCfClient(), resourcesFor(env))
		.then(({ created }) => console.log(created.length ? `Created: ${created.join(', ')}` : `All ${env} resources exist.`))
		.catch((error) => {
			// A token without Queues/R2 permission cannot check; the resources were created
			// when they were added (this script, run with an account login), so deploy goes on
			if (error instanceof CfApiError && (error.status === 403 || error.status === 401)) {
				console.log(`::warning::Could not check ${env} resources (${error.message}); assuming they exist`);
				return;
			}
			console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		});
}
