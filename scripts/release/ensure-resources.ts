/**
 * Creates the Cloudflare resources a release's configs bind to but that may
 * not exist yet (a new binding's first deploy would otherwise fail):
 *
 *   node --experimental-strip-types scripts/release/ensure-resources.ts --env qa|stage|production
 *
 * Idempotent: existing queues and buckets are left alone. Add a resource here
 * in the same PR that first binds it.
 *
 * Secrets Store placeholders: a secret a config binds before its real value is
 * known is created with the value `unset` (the code treats it as missing) and
 * the `workers` scope. Create only: an existing secret, placeholder or real, is
 * never read or changed; the owner pastes the real value over the placeholder.
 *
 * Turnstile: the production widget (admin-api and api-videos TURNSTILE_SITE_KEY) must allow the
 * env's www host, where the newsletter form renders it (AlUmmahNowUI apps/www). Hostnames are only
 * ever appended; an existing one, or a parent domain that already covers it, is left alone.
 * Needs the token permission Account → Turnstile → Edit; without it the run warns and goes on.
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
	/** Secrets Store secrets created with PLACEHOLDER_SECRET_VALUE when missing (store id → names). */
	placeholderSecrets?: Record<string, string[]>;
	/** Hostnames the Turnstile widget must allow (appended when missing, never removed). */
	turnstile?: { sitekey: string; hostnames: string[] };
}

/** The production Turnstile widget (apps/admin-api and apps/api-videos wrangler.jsonc TURNSTILE_SITE_KEY). */
export const TURNSTILE_SITEKEY = '0x4AAAAAAF_3KPNkPlEGf_dP';
/** The permission a token needs to read and update it. */
export const TURNSTILE_PERMISSION = 'Account → Turnstile → Edit (Turnstile Sites Write)';
/** www's host per environment (AlUmmahNowUI apps/www wrangler.jsonc routes). */
export const WWW_HOSTS: Record<ResourceEnv, string> = {
	production: 'www.alummahnow.net',
	stage: 'www.stage.alummahnow.net',
	qa: 'www.qa.alummahnow.net',
};

/** The account's Secrets Store (every app's secrets_store_secrets bindings). */
export const SECRETS_STORE_ID = 'f8eddc9944d041919ed8dc7d08d32308';
/** What a placeholder holds; lib/youtube-import/settings.ts UNSET_SECRET reads it as no secret. */
export const PLACEHOLDER_SECRET_VALUE = 'unset';

/** Days a source map is kept, by environment; production keeps every release's. */
const SOURCEMAP_DAYS: Partial<Record<ResourceEnv, number>> = { qa: 14, stage: 30 };
export const EXPIRY_RULE_ID = 'al-ummah-expire';

/** Resources by environment. Production names have no suffix. */
export function resourcesFor(env: ResourceEnv): Resources {
	const s = env === 'production' ? '' : `-${env}`;
	return {
		// Errors page: async ingest and its dead letters (apps/admin-api ErrorsIngest.ts)
		// R2 video delivery (apps/media): transcode jobs and their dead letters (DLQ name ends in the env, see queue-consumers)
		// Move from YouTube jobs (apps/api-videos lib/youtube-import/jobs.ts; dead letters go to the shared al-ummah-now-dlq)
		queues: [`al-ummah-now-errors${s}`, `al-ummah-now-errors-dlq${s}`, `al-ummah-now-transcode${s}`, `al-ummah-now-transcode-dlq${s}`, `al-ummah-now-yt-import${s}`],
		// Private source maps of the web apps (apps/admin-api lib/sourcemaps.ts; upload-sourcemaps.ts)
		// Renditions served from media.<env>.alummahnow.net (docs/media-delivery/R2-DELIVERY-PLAN.md)
		// (public, behind the R2 custom domain) and private/unlisted ones (no public access; the media Worker serves them)
		// CSAM evidence (docs/specs/CSAM-RESPONSE.md §4): private, never public, no lifecycle rule
		buckets: [`al-ummah-now-sourcemaps${s}`, `al-ummah-now-media${s}`, `al-ummah-now-media-private${s}`, `al-ummah-now-media-originals${s}`, `al-ummah-now-csam-evidence${s}`],
		...(SOURCEMAP_DAYS[env] ? { expireAfterDays: { [`al-ummah-now-sourcemaps${s}`]: SOURCEMAP_DAYS[env]! } } : {}),
		// Move from YouTube: the Google OAuth client secret (api-videos GOOGLE_OAUTH_CLIENT_SECRET, docs/features/youtube-import.md)
		placeholderSecrets: { [SECRETS_STORE_ID]: [`google-oauth-client-secret${s}`] },
		// Newsletter sign-up on www (AlUmmahNowUI#6): the widget renders on the env's www host
		turnstile: { sitekey: TURNSTILE_SITEKEY, hostnames: [WWW_HOSTS[env]] },
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
	for (const [storeId, names] of Object.entries(wanted.placeholderSecrets ?? {})) {
		const present = new Set<string>();
		for (let page = 1; page <= 20; page++) {
			const secrets = await cf.request<{ name: string }[]>('GET', `/secrets_store/stores/${storeId}/secrets?page=${page}&per_page=100`);
			for (const secret of secrets ?? []) present.add(secret.name);
			if (!secrets || secrets.length < 100) break;
		}
		for (const name of names) {
			if (present.has(name)) continue;
			await cf.request('POST', `/secrets_store/stores/${storeId}/secrets`, [
				{ name, value: PLACEHOLDER_SECRET_VALUE, scopes: ['workers'], comment: 'Placeholder: paste the real value over it' },
			]);
			created.push(`secret ${name} (placeholder)`);
			log(`Created Secrets Store placeholder ${name}`);
		}
	}
	return { created };
}

interface TurnstileWidget {
	sitekey: string;
	name: string;
	domains: string[];
	mode: string;
	bot_fight_mode?: boolean;
	clearance_level?: string;
	ephemeral_id?: boolean;
	offlabel?: boolean;
	region?: string;
}

/** A widget hostname also allows its subdomains, so a parent already in the list covers the host. */
export function coveredBy(domains: string[], host: string): string | undefined {
	const h = host.toLowerCase();
	return domains.find((d) => {
		const x = d.toLowerCase();
		return h === x || h.endsWith(`.${x}`);
	});
}

/**
 * Appends the missing hostnames to the widget's allowed domains. The PUT replaces the widget's
 * settings, so every field it had is sent back unchanged; domains are only added.
 */
export async function ensureTurnstileHostnames(cf: CfClient, want: { sitekey: string; hostnames: string[] }, log: (line: string) => void = console.log): Promise<{ added: string[] }> {
	const path = `/challenges/widgets/${encodeURIComponent(want.sitekey)}`;
	const widget = await cf.request<TurnstileWidget>('GET', path);
	const domains = [...(widget.domains ?? [])];
	const added: string[] = [];
	for (const host of want.hostnames) {
		const cover = coveredBy(domains, host);
		if (cover) {
			if (cover !== host) log(`Turnstile widget ${widget.name}: ${host} is covered by ${cover}`);
			continue;
		}
		domains.push(host);
		added.push(host);
	}
	if (!added.length) return { added };
	const body: Record<string, unknown> = { name: widget.name, domains, mode: widget.mode };
	for (const k of ['bot_fight_mode', 'clearance_level', 'ephemeral_id', 'offlabel', 'region'] as const) if (widget[k] !== undefined) body[k] = widget[k];
	await cf.request('PUT', path, body);
	log(`Turnstile widget ${widget.name}: allowed ${added.join(', ')}`);
	return { added };
}

interface LifecycleRule {
	id: string;
	enabled: boolean;
	conditions: { prefix: string };
	deleteObjectsTransition?: { condition?: { type: 'Age'; maxAge: number } };
	[key: string]: unknown;
}

/** The Turnstile step on its own: a token without Turnstile access warns, naming the permission. */
async function ensureTurnstile(cf: CfClient, wanted: Resources): Promise<void> {
	if (!wanted.turnstile) return;
	try {
		await ensureTurnstileHostnames(cf, wanted.turnstile);
	} catch (error) {
		if (error instanceof CfApiError && (error.status === 403 || error.status === 401)) {
			console.log(`::warning::Turnstile widget not checked (${error.message}): the token needs ${TURNSTILE_PERMISSION}`);
			return;
		}
		throw error;
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const i = process.argv.indexOf('--env');
	const env = (i >= 0 ? process.argv[i + 1] : '') as ResourceEnv;
	if (!['qa', 'stage', 'production'].includes(env)) {
		process.stderr.write('usage: ensure-resources.ts --env qa|stage|production\n');
		process.exit(2);
	}
	const cf = createCfClient();
	const wanted = resourcesFor(env);
	ensureResources(cf, wanted)
		.then(({ created }) => console.log(created.length ? `Created: ${created.join(', ')}` : `All ${env} resources exist.`))
		.then(() => ensureTurnstile(cf, wanted))
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
