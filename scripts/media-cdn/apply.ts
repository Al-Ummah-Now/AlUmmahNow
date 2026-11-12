/**
 * The media host's Cloudflare settings as code (epic #687, docs/media-delivery/RUNBOOK.md):
 *
 *   node --experimental-strip-types scripts/media-cdn/apply.ts --env qa|stage|production [--apply]
 *        [--only domain,cors,cache,tiered,purge,analytics] [--store-secret]
 *
 * Without --apply it reads the current state and prints what it would change
 * (and the exact Cache Rule, for pasting in the dashboard). With --apply it
 * makes the changes. Idempotent; it only ever touches:
 *   - the R2 bucket al-ummah-now-media[-env]: its custom domain and CORS
 *   - one Cache Rule per env in the zone's cache-settings phase, found by its ref
 *     (other rules in that phase are left exactly as they are)
 *   - Tiered Cache: Smart topology on (zone-wide; free, lowers R2 reads)
 * and checks (never changes anything) that the token can purge the media host's
 * cache and read Account Analytics, which api-videos needs at runtime. With
 * --store-secret (and --apply) it also stores the token in Secrets Store as
 * media-cdn-api-token, the binding api-videos purges and reads analytics with.
 *
 * Token: CLOUDFLARE_API_TOKEN for everything (account R2 calls and the zone's
 * Cache Settings, Cache Purge, DNS; Account Analytics Read). MEDIA_CDN_API_TOKEN,
 * when set, overrides it for the zone calls. Locally the wrangler login works for
 * the account calls only.
 */
import { resolve } from 'node:path';
import { cfToken, CfApiError, createCfClient, type CfClient } from '../release/cf-api.ts';

export const ZONE_NAME = 'alummahnow.net';
export const ZONE_ID = 'fada86a0f215bda23dbe19de7226b49f';
export type MediaEnv = 'qa' | 'stage' | 'production';

export function mediaHost(env: MediaEnv): string {
	return env === 'production' ? 'media.alummahnow.net' : `media.${env}.alummahnow.net`;
}
export function mediaBucket(env: MediaEnv): string {
	return env === 'production' ? 'al-ummah-now-media' : `al-ummah-now-media-${env}`;
}

/** Players run on our sites, in embeds on other sites and in the native apps: any origin may GET. */
export const CORS_RULES = [
	{
		allowed: { origins: ['*'], methods: ['GET', 'HEAD'], headers: ['range'] },
		exposeHeaders: ['content-length', 'content-range', 'etag', 'age', 'cf-cache-status'],
		maxAgeSeconds: 86400,
	},
];

/**
 * Cache everything on the media host. TTLs come from each object's
 * Cache-Control (set at write time, shared-types mediaCacheControl): segments,
 * init and images a year (immutable under one rev), playlists 5 min,
 * manifest.json no-store. Errors are cached 10 s so a burst of misses for a
 * missing object costs one R2 read.
 */
export function cacheRule(env: MediaEnv) {
	return {
		ref: `al-ummah-media-cache-${env}`,
		description: `Al Ummah Now media (${mediaHost(env)}): cache everything, TTL from the object (epic #687)`,
		expression: `(http.host eq "${mediaHost(env)}")`,
		action: 'set_cache_settings',
		action_parameters: {
			cache: true,
			edge_ttl: {
				mode: 'respect_origin',
				status_code_ttl: [{ status_code_range: { from: 400, to: 599 }, value: 10 }],
			},
			browser_ttl: { mode: 'respect_origin' },
		},
		enabled: true,
	};
}

interface Rule {
	id?: string;
	ref?: string;
	expression: string;
	action: string;
	action_parameters?: unknown;
	description?: string;
	enabled?: boolean;
}

export type Change = { what: string; apply: () => Promise<unknown> };

/** Every value we set is present in `live` (the API adds defaults and ids of its own). */
function contains(live: unknown, want: unknown): boolean {
	if (Array.isArray(want)) return Array.isArray(live) && want.length === live.length && want.every((w, i) => contains(live[i], w));
	if (want && typeof want === 'object') {
		if (!live || typeof live !== 'object') return false;
		return Object.entries(want).every(([k, v]) => contains((live as Record<string, unknown>)[k], v));
	}
	return live === want;
}

/** Rule fields we own, for comparing the live rule with ours. */
export function ruleDiffers(live: Rule | undefined, want: Rule): boolean {
	if (!live) return true;
	if (live.expression !== want.expression || live.action !== want.action || (live.enabled !== false) !== (want.enabled !== false) || live.description !== want.description) return true;
	return !contains(live.action_parameters, want.action_parameters);
}

function zoneClient(token: string) {
	return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
		const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { code: number; message: string }[] };
		if (!res.ok || json.success === false) {
			throw new CfApiError(res.status, `${method} zone${path} -> ${res.status} ${json.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || res.statusText}`);
		}
		return json.result as T;
	};
}

export async function planDomain(cf: CfClient, env: MediaEnv): Promise<Change[]> {
	const bucket = mediaBucket(env);
	const host = mediaHost(env);
	const list = await cf.request<{ domains: { domain: string; enabled: boolean; status?: { ssl?: string; ownership?: string } }[] }>('GET', `/r2/buckets/${bucket}/domains/custom`);
	const found = list.domains?.find((d) => d.domain === host);
	if (found?.enabled) {
		console.log(`domain  ok        ${host} → ${bucket} (ssl ${found.status?.ssl ?? '?'}, ownership ${found.status?.ownership ?? '?'})`);
		return [];
	}
	return [
		{
			what: `domain  attach    ${host} → R2 ${bucket} (creates the DNS record)`,
			apply: () => cf.request('POST', `/r2/buckets/${bucket}/domains/custom`, { domain: host, zoneId: ZONE_ID, enabled: true, minTLS: '1.2' }),
		},
	];
}

export async function planCors(cf: CfClient, env: MediaEnv): Promise<Change[]> {
	const bucket = mediaBucket(env);
	let live: unknown = null;
	try {
		live = (await cf.request<{ rules: unknown[] }>('GET', `/r2/buckets/${bucket}/cors`)).rules;
	} catch (error) {
		if (!(error instanceof CfApiError && error.status === 404)) throw error;
	}
	if (JSON.stringify(live) === JSON.stringify(CORS_RULES)) {
		console.log(`cors    ok        ${bucket}`);
		return [];
	}
	return [{ what: `cors    set       ${bucket}: GET/HEAD from any origin, Range`, apply: () => cf.request('PUT', `/r2/buckets/${bucket}/cors`, { rules: CORS_RULES }) }];
}

export async function planCache(zone: ReturnType<typeof zoneClient>, env: MediaEnv): Promise<Change[]> {
	const want = cacheRule(env);
	let entry: { id: string; rules?: Rule[] } | null = null;
	try {
		entry = await zone('GET', '/rulesets/phases/http_request_cache_settings/entrypoint');
	} catch (error) {
		if (!(error instanceof CfApiError && error.status === 404)) throw error;
	}
	if (!entry) {
		return [
			{
				what: `cache   create    phase entrypoint with rule ${want.ref}`,
				apply: () => zone('POST', '/rulesets', { name: 'default', kind: 'zone', phase: 'http_request_cache_settings', rules: [want] }),
			},
		];
	}
	const live = entry.rules?.find((r) => r.ref === want.ref);
	if (!ruleDiffers(live, want)) {
		console.log(`cache   ok        rule ${want.ref}`);
		return [];
	}
	if (live?.id) {
		return [{ what: `cache   update    rule ${want.ref}`, apply: () => zone('PATCH', `/rulesets/${entry!.id}/rules/${live.id}`, want) }];
	}
	return [{ what: `cache   add       rule ${want.ref} (other rules in the phase untouched)`, apply: () => zone('POST', `/rulesets/${entry!.id}/rules`, want) }];
}

export async function planTiered(zone: ReturnType<typeof zoneClient>): Promise<Change[]> {
	const changes: Change[] = [];
	const tiered = await zone<{ value: string }>('GET', '/argo/tiered_caching');
	if (tiered.value !== 'on') changes.push({ what: 'tiered  enable    Tiered Cache', apply: () => zone('PATCH', '/argo/tiered_caching', { value: 'on' }) });
	const smart = await zone<{ value: string }>('GET', '/cache/tiered_cache_smart_topology_enable');
	if (smart.value !== 'on') changes.push({ what: 'tiered  enable    Smart topology', apply: () => zone('PATCH', '/cache/tiered_cache_smart_topology_enable', { value: 'on' }) });
	if (!changes.length) console.log('tiered  ok        Smart Tiered Cache on');
	return changes;
}

/** Purge one URL that never exists on the media host: proves Cache Purge without touching real content. */
export async function checkPurge(zone: ReturnType<typeof zoneClient>, env: MediaEnv): Promise<Change[]> {
	await zone('POST', '/purge_cache', { files: [`https://${mediaHost(env)}/pub/_access-check/none`] });
	console.log('purge   ok        Cache Purge allowed on the zone');
	return [];
}

async function graphql(token: string, query: string, variables: Record<string, string>): Promise<void> {
	const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	});
	const json = (await res.json().catch(() => ({}))) as { errors?: { message: string }[] | null };
	if (!res.ok || json.errors?.length) throw new CfApiError(res.status === 200 ? 403 : res.status, `graphql -> ${json.errors?.map((e) => e.message).join('; ') || res.status}`);
}

/**
 * The daily cost collector's two analytics reads, checked separately:
 *   account: R2 storage and operations (Account Analytics Read)
 *   zone:    media host requests, bytes, cache status (Zone Analytics Read)
 */
export async function checkAnalytics(token: string, accountId: string): Promise<Change[]> {
	const d = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
	const failures: string[] = [];
	try {
		await graphql(token, 'query($a: String!, $d: Date!) { viewer { accounts(filter: { accountTag: $a }) { r2OperationsAdaptiveGroups(limit: 1, filter: { date_geq: $d }) { sum { requests } } } } }', { a: accountId, d });
		console.log('analytics ok      account: R2 storage and operations readable');
	} catch (error) {
		failures.push(`account R2 analytics: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		await graphql(token, 'query($z: String!, $d: Date!) { viewer { zones(filter: { zoneTag: $z }) { httpRequestsAdaptiveGroups(limit: 1, filter: { date_geq: $d }) { count } } } }', { z: ZONE_ID, d });
		console.log('analytics ok      zone: media host requests and cache status readable');
	} catch (error) {
		failures.push(`zone HTTP analytics (needs Zone → Analytics: Read): ${error instanceof Error ? error.message : String(error)}`);
	}
	if (failures.length) throw new CfApiError(403, failures.join(' | '));
	return [];
}

export const TOKEN_SECRET_NAME = 'media-cdn-api-token';
export const SECRETS_STORE_ID = 'f8eddc9944d041919ed8dc7d08d32308';

/** Create or update Secrets Store media-cdn-api-token with the token (never printed). */
export async function storeTokenSecret(cf: CfClient, token: string): Promise<string> {
	const base = `/secrets_store/stores/${SECRETS_STORE_ID}/secrets`;
	const list = await cf.request<{ id: string; name: string }[]>('GET', `${base}?per_page=100&search=${TOKEN_SECRET_NAME}`);
	const found = (list ?? []).find((x) => x.name === TOKEN_SECRET_NAME);
	if (found) {
		await cf.request('PATCH', `${base}/${found.id}`, { value: token, scopes: ['workers'] });
		return `updated Secrets Store ${TOKEN_SECRET_NAME}`;
	}
	await cf.request('POST', base, [{ name: TOKEN_SECRET_NAME, value: token, scopes: ['workers'], comment: 'Media cache purge + analytics (epic #687)' }]);
	return `created Secrets Store ${TOKEN_SECRET_NAME}`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(decodeURIComponent(new URL(import.meta.url).pathname));
if (isMain) {
	const arg = (name: string) => {
		const i = process.argv.indexOf(name);
		return i >= 0 ? process.argv[i + 1] : undefined;
	};
	const env = arg('--env') as MediaEnv;
	const apply = process.argv.includes('--apply');
	const only = new Set((arg('--only') ?? 'domain,cors,cache,tiered,purge,analytics').split(','));
	const storeSecret = process.argv.includes('--store-secret');
	if (!['qa', 'stage', 'production'].includes(env)) {
		process.stderr.write('usage: apply.ts --env qa|stage|production [--apply] [--only domain,cors,cache,tiered,purge,analytics] [--store-secret]\n');
		process.exit(2);
	}
	const main = async () => {
		const cf = createCfClient();
		const zoneToken = process.env.MEDIA_CDN_API_TOKEN || cfToken();
		const zone = zoneClient(zoneToken!);
		const changes: Change[] = [];
		const steps: [string, () => Promise<Change[]>][] = [
			['domain', () => planDomain(cf, env)],
			['cors', () => planCors(cf, env)],
			['cache', () => planCache(zone, env)],
			['tiered', () => planTiered(zone)],
			['purge', () => checkPurge(zone, env)],
			['analytics', () => checkAnalytics(zoneToken!, cf.accountId)],
		];
		let blocked = 0;
		for (const [name, plan] of steps) {
			if (!only.has(name)) continue;
			try {
				changes.push(...(await plan()));
			} catch (error) {
				blocked++;
				const denied = error instanceof CfApiError && (error.status === 401 || error.status === 403);
				console.log(`${name.padEnd(7)} ${denied ? 'NO ACCESS' : 'ERROR    '} ${error instanceof Error ? error.message : String(error)}`);
				if (denied && (name === 'cache' || name === 'tiered')) {
					console.log('        → the token needs Zone: Cache Settings Edit (or apply by hand in the dashboard):');
					if (name === 'cache') console.log(JSON.stringify(cacheRule(env), null, 2).replace(/^/gm, '          '));
					else console.log('          Caching → Tiered Cache → Smart Tiered Caching Topology: on');
				}
			}
		}
		for (const c of changes) console.log(`${apply ? 'APPLY  ' : 'PLAN   '} ${c.what}`);
		if (apply) for (const c of changes) await c.apply();
		if (apply && storeSecret) {
			try {
				console.log(`secret  ${await storeTokenSecret(cf, zoneToken!)}`);
			} catch (error) {
				blocked++;
				console.log(`secret  NO ACCESS ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		console.log(`${changes.length} change(s) ${apply ? 'applied' : 'planned'}${blocked ? `, ${blocked} step(s) could not be checked` : ''}.`);
		if (blocked) process.exitCode = 3;
	};
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
