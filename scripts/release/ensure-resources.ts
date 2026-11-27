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
 * Turnstile hostnames: the env's www hostnames are appended to the production widget's
 * allowed domains when no listed domain already covers them (a domain authorizes all its
 * subdomains). Append only: a listed domain is never removed or changed. QA and stage
 * render Cloudflare's test key, but their www hosts are listed too so the real widget
 * can be tried there (owner, 2026-11-15: www newsletter).
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
	/** Hostnames the Turnstile widget (sitekey) must allow; appended when not covered. */
	turnstileHostnames?: { sitekey: string; hostnames: string[] };
}

/** The account's Secrets Store (every app's secrets_store_secrets bindings). */
export const SECRETS_STORE_ID = 'f8eddc9944d041919ed8dc7d08d32308';
/** What a placeholder holds; lib/youtube-import/settings.ts UNSET_SECRET reads it as no secret. */
export const PLACEHOLDER_SECRET_VALUE = 'unset';

/** Days a source map is kept, by environment; production keeps every release's. */
const SOURCEMAP_DAYS: Partial<Record<ResourceEnv, number>> = { qa: 14, stage: 30 };
/** Days diagnostic log bundles are kept in R2, across every environment. */
const DIAGNOSTICS_DAYS = 30;
export const EXPIRY_RULE_ID = 'al-ummah-expire';

/** The production Turnstile widget "al-ummah-now-production" (docs/features/bot-protection.md). */
export const TURNSTILE_SITEKEY = '0x4AAAAAAF_3KPNkPlEGf_dP';
/** www's custom domains per env (AlUmmahNowUI apps/www/wrangler.jsonc routes): the newsletter form. */
export const WWW_HOSTNAMES: Record<ResourceEnv, string[]> = {
	production: ['alummahnow.net', 'www.alummahnow.net'],
	stage: ['stage.alummahnow.net', 'www.stage.alummahnow.net'],
	qa: ['qa.alummahnow.net', 'www.qa.alummahnow.net'],
};
/** The token permission the Turnstile step needs. */
export const TURNSTILE_PERMISSION = 'Account > Turnstile > Edit';

/** True when `host` is `domain` or one of its subdomains. */
export function coveredBy(host: string, domain: string): boolean {
	const h = host.toLowerCase();
	const d = domain.toLowerCase().replace(/^\*\./, '');
	return h === d || h.endsWith(`.${d}`);
}

/** Resources by environment. Production names have no suffix. */
export function resourcesFor(env: ResourceEnv): Resources {
	const s = env === 'production' ? '' : `-${env}`;
	return {
		// Errors page: async ingest and its dead letters (apps/admin-api ErrorsIngest.ts)
		// R2 video delivery (apps/media): transcode jobs and their dead letters (DLQ name ends in the env, see queue-consumers)
		// Status page subscriptions (apps/admin-api lib/status-notify.ts; producers admin-api and apps/status)
		// Move from YouTube jobs (apps/api-videos lib/youtube-import/jobs.ts; dead letters go to the shared al-ummah-now-dlq)
		// Account events from Auth (apps/api-videos lib/account-events/jobs.ts; dead letters go to the shared al-ummah-now-dlq)
		// Cost monitor jobs (apps/cost-monitor src/jobs.ts, COST-1): collection and product pulls, and their dead letters
		queues: [`al-ummah-now-errors${s}`, `al-ummah-now-errors-dlq${s}`, `al-ummah-now-transcode${s}`, `al-ummah-now-transcode-dlq${s}`, `al-ummah-now-yt-import${s}`, `al-ummah-now-account-events${s}`, `al-ummah-now-status-notify${s}`, `al-ummah-cost-jobs${s}`, `al-ummah-cost-jobs-dlq${s}`],
		// Private source maps of the web apps (apps/admin-api lib/sourcemaps.ts; upload-sourcemaps.ts)
		// Renditions served from media.<env>.alummahnow.net (docs/media-delivery/R2-DELIVERY-PLAN.md)
		// (public, behind the R2 custom domain) and private/unlisted ones (no public access; the media Worker serves them)
		// CSAM evidence (docs/specs/CSAM-RESPONSE.md §4): private, never public, no lifecycle rule
		// Diagnostic log bundles (apps/admin-api lib/error-diagnostics.ts): private, 30-day expiry in every env
		buckets: [`al-ummah-now-sourcemaps${s}`, `al-ummah-now-diagnostics${s}`, `al-ummah-now-media${s}`, `al-ummah-now-media-private${s}`, `al-ummah-now-media-originals${s}`, `al-ummah-now-csam-evidence${s}`],
		expireAfterDays: {
			...(SOURCEMAP_DAYS[env] ? { [`al-ummah-now-sourcemaps${s}`]: SOURCEMAP_DAYS[env]! } : {}),
			[`al-ummah-now-diagnostics${s}`]: DIAGNOSTICS_DAYS,
		},
		// Move from YouTube: the Google OAuth client secret (api-videos GOOGLE_OAUTH_CLIENT_SECRET, docs/features/youtube-import.md)
		placeholderSecrets: { [SECRETS_STORE_ID]: [`google-oauth-client-secret${s}`] },
		// www newsletter sign-up renders the widget (AlUmmahNowUI apps/www NewsletterForm)
		turnstileHostnames: { sitekey: TURNSTILE_SITEKEY, hostnames: WWW_HOSTNAMES[env] },
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
	if (wanted.turnstileHostnames) {
		const { sitekey, hostnames } = wanted.turnstileHostnames;
		try {
			const { added, covered } = await ensureTurnstileHostnames(cf, sitekey, hostnames);
			for (const { host, by } of covered) log(`Turnstile widget ${sitekey} already allows ${host} (covered by ${by})`);
			for (const host of added) {
				created.push(`turnstile ${host}`);
				log(`Turnstile widget ${sitekey} now allows ${host}`);
			}
		} catch (error) {
			// Checked last so a token without Turnstile access still ensures everything above
			if (!(error instanceof CfApiError) || (error.status !== 403 && error.status !== 401)) throw error;
			log(`::warning::Turnstile hostnames not checked (${error.message}): the token needs ${TURNSTILE_PERMISSION}`);
		}
	}
	return { created };
}

interface TurnstileWidget {
	sitekey: string;
	name: string;
	mode: string;
	domains: string[];
	[key: string]: unknown;
}

/** Fields the widget PUT takes; everything else in the GET (dates, secret) is left out. */
const WIDGET_FIELDS = ['name', 'mode', 'bot_fight_mode', 'clearance_level', 'ephemeral_id', 'offlabel', 'region'] as const;

/**
 * Appends to the widget's allowed domains each hostname no listed domain covers; returns those added
 * and, for the rest, the listed domain that covers each.
 * Never removes or reorders a listed domain.
 */
export async function ensureTurnstileHostnames(cf: CfClient, sitekey: string, hostnames: string[]): Promise<{ added: string[]; covered: { host: string; by: string }[] }> {
	const widget = await cf.request<TurnstileWidget>('GET', `/challenges/widgets/${encodeURIComponent(sitekey)}`);
	const domains = widget.domains ?? [];
	const covered: { host: string; by: string }[] = [];
	const missing: string[] = [];
	for (const host of new Set(hostnames.map((h) => h.toLowerCase()))) {
		const by = domains.find((d) => coveredBy(host, d));
		if (by) covered.push({ host, by });
		else missing.push(host);
	}
	if (missing.length === 0) return { added: [], covered };
	const body: Record<string, unknown> = { domains: [...domains, ...missing] };
	for (const field of WIDGET_FIELDS) if (widget[field] !== undefined) body[field] = widget[field];
	await cf.request('PUT', `/challenges/widgets/${encodeURIComponent(sitekey)}`, body);
	return { added: missing, covered };
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
