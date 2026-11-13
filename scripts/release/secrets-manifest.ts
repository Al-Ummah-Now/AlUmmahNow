/**
 * Secrets and client ids each deployed Worker needs, per env (AlUmmahNow).
 * Read by check-secrets.ts and documented in README.md ("Secrets per app").
 * Names and purposes only: never put a value here.
 *
 * When code starts reading a new secret, add it here in the same PR.
 * Production and stage worker names come from apps.ts (checked by check:config);
 * QA names are listed here.
 */
import { APPS } from './apps.ts';

export type EnvName = 'production' | 'qa' | 'stage';

/** Auth D1 (oauth_clients, in AlUmmahNowAuth) for each env. */
export const AUTH_DBS: Record<EnvName, string> = {
	production: 'af76f007-e21e-43aa-88de-ebfefe46fb56', // al-ummah-now-d1
	qa: '28590f3c-dd92-4c26-a803-d73a9bbe2b58', // al-ummah-now-d1-qa
	stage: 'c7886ef6-c70b-4b7f-a65b-3df9f9aba9e2', // al-ummah-now-d1-stage
};

export interface RequiredSecret {
	name: string;
	purpose: string;
}

export interface WorkerSecrets {
	app: string;
	env: EnvName;
	worker: string;
	required?: RequiredSecret[];
	/** Must NOT be bound in this env (test-only secrets in production). */
	forbidden?: string[];
	/**
	 * Plain vars holding an oauth_clients id; checked against AUTH_DBS[env].
	 * required: the app starts logins with it (web, admin-web). Resource servers
	 * only verify tokens, so their ClientId is checked only when set.
	 */
	clientIdVars?: { name: string; required: boolean }[];
	/** Client ids hard-coded in the app; checked against AUTH_DBS[env]. */
	fixedClientIds?: string[];
}

const INTERNAL_API_KEY: RequiredSecret = {
	name: 'INTERNAL_API_KEY',
	purpose: 'Secrets Store internal-api-key[-qa]; X-API-Key between our Workers and for /internal/* routes',
};

const AUTH_MODERATION_CLIENT_SECRET: RequiredSecret = {
	name: 'AUTH_MODERATION_CLIENT_SECRET',
	purpose:
		'worker secret; client secret of AUTH_MODERATION_CLIENT_ID (moderation requests to auth, docs/admin/AUTH_MODERATION_REQUESTS.md). Set by AlUmmahNowAuth scripts/release/rotate-client-secret.ts',
};

const TURNSTILE_SECRET: RequiredSecret = {
	name: 'TURNSTILE_SECRET',
	purpose: 'Secrets Store turnstile-secret (production) / turnstile-secret-test (QA, stage: Cloudflare\'s always-pass test secret); siteverify of Turnstile tokens (docs/features/bot-protection.md)',
};

const API_VIDEOS_SECRETS: RequiredSecret[] = [
	{ name: 'bunny-stream-key', purpose: 'Secrets Store; Bunny Stream API key (create, upload, update videos)' },
	{ name: 'bunny_stream_library_id', purpose: 'Secrets Store; Bunny Stream library id' },
	{ name: 'BUNNY_TOKEN_KEY', purpose: 'Secrets Store; signs Bunny CDN playback and thumbnail URLs' },
	{ name: 'image_storage_key', purpose: 'Secrets Store; Bunny Storage key for thumbnails and avatars' },
	{ name: 'LIVE_INGEST_SECRET', purpose: 'Secrets Store live-ingest-secret[-qa|-stage]; HMAC key of self-hosted live stream keys (lib/live/providers.ts)' },
	INTERNAL_API_KEY,
	{ name: 'MEDIA_SIGN_KEY', purpose: 'Secrets Store media-sign-key[-qa|-stage]; path tokens of private R2 renditions (shared with apps/media)' },
	TURNSTILE_SECRET,
];

const CLIENT_REQUIRED = [{ name: 'ClientId', required: true }];
const CLIENT_OPTIONAL = [{ name: 'ClientId', required: false }];

type Make = Omit<WorkerSecrets, 'env' | 'worker' | 'app'>;
/** The app's worker in production, stage (names from apps.ts) and QA. */
function envs(app: string, qa: string, spec: Make): WorkerSecrets[] {
	const rule = APPS.find((a) => a.app === app);
	if (!rule?.production || !rule.stage) throw new Error(`secrets-manifest: ${app} has no production/stage rule in apps.ts`);
	return [
		{ ...spec, app, env: 'production', worker: rule.production.name },
		{ ...spec, app, env: 'qa', worker: qa },
		{ ...spec, app, env: 'stage', worker: rule.stage.name },
	];
}

export const SECRETS_MANIFEST: WorkerSecrets[] = [
	...envs('web', 'al-ummah-web-qa', { required: [{ ...INTERNAL_API_KEY, purpose: 'Secrets Store internal-api-key[-qa|-stage]; X-API-Key of the Contact us route to admin-api /internal/contact' }], clientIdVars: CLIENT_REQUIRED }),
	...envs('admin-web', 'al-ummah-admin-web-qa', { required: [{ ...INTERNAL_API_KEY, purpose: 'Secrets Store internal-api-key[-qa|-stage]; X-API-Key of browser and SSR error reports to admin-api /internal/errors' }], clientIdVars: CLIENT_REQUIRED }),
	...envs('api-videos', 'videos-qa', { required: API_VIDEOS_SECRETS, clientIdVars: CLIENT_OPTIONAL }),
	...envs('admin-api', 'al-ummah-admin-api-qa', {
		required: [
			INTERNAL_API_KEY,
			{ name: 'RESEND_API_KEY', purpose: 'Secrets Store RESEND_API_KEY (shared with the auth server); Contact us notification, acknowledgement and reply emails' },
			AUTH_MODERATION_CLIENT_SECRET,
			// Contact us (endpoints/contact/ContactSubmit.ts)
			TURNSTILE_SECRET,
			// Scholar sites own domains (lib/sites/saas.ts, #1212)
			{ name: 'SITES_SAAS_TOKEN', purpose: 'Secrets Store sites-saas-token (all envs); Zone SSL and Certificates Edit on alummahnow.org: Cloudflare for SaaS custom hostnames' },
		],
		// Checked when set: the var arrives with the deploy of the code that reads it
		clientIdVars: [...CLIENT_OPTIONAL, { name: 'AUTH_MODERATION_CLIENT_ID', required: false }],
	}),
	...envs('websocket-server', 'al-ummah-now-comms-qa', { required: [INTERNAL_API_KEY], clientIdVars: CLIENT_OPTIONAL }),
	...envs('processor', 'al-ummah-now-processor-qa', { required: [INTERNAL_API_KEY] }),
	...envs('scheduler', 'al-ummah-scheduler-qa', { required: [INTERNAL_API_KEY] }),
	// R2 delivery (epic #687): api-videos callbacks and private-rendition path tokens
	...envs('media', 'al-ummah-now-media-qa', {
		required: [
			{ ...INTERNAL_API_KEY, purpose: 'Secrets Store internal-api-key[-qa|-stage]; X-API-Key of the calls to api-videos /internal/media' },
			{ name: 'MEDIA_SIGN_KEY', purpose: 'Secrets Store media-sign-key[-qa|-stage]; checks /priv/ path tokens' },
		],
	}),
	// Short links (wiki AUN-SHORT-LINKS): failures reach the Errors page
	...envs('short-links', 'al-ummah-now-short-links-qa', {
		required: [{ ...INTERNAL_API_KEY, purpose: 'Secrets Store internal-api-key[-qa|-stage]; X-API-Key of error reports to admin-api /internal/errors' }],
	}),
	// Platform analytics collector (docs/admin/LIVE_OPS.md): Cloudflare GraphQL reads, Errors page items
	...envs('cost-monitor', 'al-ummah-cost-monitor-qa', {
		required: [
			{ ...INTERNAL_API_KEY, purpose: 'Secrets Store internal-api-key[-qa|-stage]; X-API-Key of threshold alerts to admin-api /internal/errors' },
			{ name: 'CF_ANALYTICS_TOKEN', purpose: 'Secrets Store media-cdn-api-token (all envs); Account Analytics Read for the hourly GraphQL query' },
		],
	}),
	// Public status page (docs/status-page/README.md): outage alerts become Errors page items.
	// RESEND_API_KEY (production and stage only) mails an alert directly when the admin itself is down.
	...envs('status', 'al-ummah-status-qa', {
		required: [{ ...INTERNAL_API_KEY, purpose: 'Secrets Store internal-api-key[-qa|-stage]; X-API-Key of outage alerts to admin-api /internal/errors' }],
	}),
];

export interface BuildSecret {
	name: string;
	/** Workflow file whose OpenNext build step reads it */
	workflow: string;
	purpose: string;
}

/**
 * GitHub Actions secrets read at build time (not Worker secrets). Next salts
 * Server Action ids with NEXT_SERVER_ACTIONS_ENCRYPTION_KEY and generates a new
 * key per build when it is unset, so every deploy renamed every action and open
 * pages failed ("Server Action ... was not found on the server"). Stage and
 * production run the same release build, so they share its key.
 * The build steps fail when the secret is missing (docs/release-pipeline/SKEW-PROTECTION.md).
 */
export const BUILD_SECRETS: BuildSecret[] = [
	{ name: 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', workflow: 'release.yml', purpose: 'Server Action key of the stage + production build (web, admin-web)' },
	{ name: 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY_QA', workflow: 'deploy.yml', purpose: 'Server Action key of the QA build (web, admin-web); PR builds get none' },
];
