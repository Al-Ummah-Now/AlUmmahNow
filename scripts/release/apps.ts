/**
 * Deployable apps in this repo and what their production configs must look like.
 * Edit this file when an app gains an env (e.g. env.stage), a route or a required
 * binding, or when a production URL changes on purpose.
 *
 * Production hostnames are attached as custom domains in the Cloudflare dashboard,
 * not as `routes` in config, so routes are not required; if one is added it must
 * be a production host.
 */
import type { AppRule, Binding, EnvRule } from './wrangler-config.ts';

const AUTH_ISSUER = 'https://auth.alummahnow.net';
const VIDEOS_API = 'https://videos.api.alummahnow.net';

/** Production must not carry test-only material or point at QA / stage / preview. */
const PROD_GUARDS: Pick<EnvRule, 'forbiddenNames' | 'forbiddenValues' | 'allowedHosts'> = {
	forbiddenNames: ['E2E_CODE_SINK_SECRET', 'TEST_PROMOTE_SECRET', /^E2E_/, /^TEST_/, /^MOCK_/],
	forbiddenValues: [/\.(qa|stage|staging|preview)\.alummahnow\.net/],
	allowedHosts: ['alummahnow.net', '*.alummahnow.net'],
};

/**
 * Stage (docs/release-pipeline): env.stage in the same file production deploys,
 * same bindings and vars as production (parity is checked), stage resources and
 * *.stage hosts. It must never point at production or QA.
 */
const STAGE_AUTH = 'https://auth.stage.alummahnow.net';
const STAGE_API = 'https://videos.api.stage.alummahnow.net';
const STAGE_REALTIME = 'https://realtime.stage.alummahnow.net';
const STAGE_GUARDS: Pick<EnvRule, 'forbiddenValues' | 'allowedHosts'> = {
	forbiddenValues: [/\.qa\.alummahnow\.net/, /\/\/(auth|videos|videos\.api|realtime|admin|admin\.api)\.alummahnow\.net/],
	allowedHosts: ['*.stage.alummahnow.net'],
};
const stageRule = (rule: Omit<EnvRule, 'env' | 'allowedHosts'>): EnvRule => ({ env: 'stage', ...STAGE_GUARDS, ...rule });

/** The videos admin's auth client for moderation requests (AlUmmahNowAuth migration 0022): same id in every env. */
const AUTH_MODERATION_CLIENT = 'd7464de8-363d-4fc1-b1af-7c71653f0afc';

const INTERNAL_API_KEY: Binding = { kind: 'secrets_store_secrets', name: 'INTERNAL_API_KEY' };
const RESEND_API_KEY: Binding = { kind: 'secrets_store_secrets', name: 'RESEND_API_KEY' };

export const APPS: AppRule[] = [
	{
		app: 'web',
		configPath: 'apps/web/wrangler.production.jsonc',
		qaConfigPath: 'apps/web/wrangler.qa.jsonc',
		dir: 'apps/web',
		deployFlags: 'config',
		production: {
			env: null,
			name: 'al-ummah-now-production',
			vars: {
				ClientId: 'f0de3c30-0304-4ac4-86d6-1e185dec0439',
				Issuer: AUTH_ISSUER,
				OPENAUTH_ISSUER: AUTH_ISSUER,
				NEXTJS_ENV: 'production',
				API_URL: VIDEOS_API,
				WEBSOCKET_URL: 'wss://realtime.alummahnow.net/ws',
			},
			// INTERNAL_API_KEY: the Contact us route calls admin-api /internal/contact
			requiredBindings: [{ kind: 'r2_buckets', name: 'videos' }, INTERNAL_API_KEY, { kind: 'analytics_engine_datasets', name: 'RUM' }],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-now-stage', requireRoutes: true, vars: { Issuer: STAGE_AUTH, OPENAUTH_ISSUER: STAGE_AUTH, API_URL: STAGE_API, WEBSOCKET_URL: 'wss://realtime.stage.alummahnow.net/ws' }, requiredBindings: [{ kind: 'r2_buckets', name: 'videos' }, INTERNAL_API_KEY, { kind: 'analytics_engine_datasets', name: 'RUM' }] }),
	},
	{
		app: 'admin-web',
		configPath: 'apps/admin-web/wrangler.production.jsonc',
		qaConfigPath: 'apps/admin-web/wrangler.qa.jsonc',
		dir: 'apps/admin-web',
		deployFlags: 'config',
		production: {
			env: null,
			name: 'al-ummah-admin-web',
			vars: {
				Issuer: AUTH_ISSUER,
				OPENAUTH_ISSUER: AUTH_ISSUER,
				NEXTJS_ENV: 'production',
				API_URL: VIDEOS_API,
				ADMIN_API_URL: 'https://admin.api.alummahnow.net',
				NEXT_PUBLIC_API_URL: VIDEOS_API,
				NEXT_PUBLIC_BASE_URL: 'https://admin.alummahnow.net',
				ERRORS_INGEST_URL: 'https://admin.api.alummahnow.net/internal/errors',
			},
			// INTERNAL_API_KEY: browser and SSR error reports to admin-api /internal/errors
			requiredBindings: [INTERNAL_API_KEY],
			...PROD_GUARDS,
		},
		stage: stageRule({
			name: 'al-ummah-admin-web-stage',
			requireRoutes: true,
			vars: { Issuer: STAGE_AUTH, OPENAUTH_ISSUER: STAGE_AUTH, API_URL: STAGE_API, ADMIN_API_URL: 'https://admin.api.stage.alummahnow.net', NEXT_PUBLIC_BASE_URL: 'https://admin.stage.alummahnow.net', ERRORS_INGEST_URL: 'https://admin.api.stage.alummahnow.net/internal/errors' },
			requiredBindings: [INTERNAL_API_KEY],
		}),
	},
	{
		app: 'api-videos',
		configPath: 'apps/api-videos/wrangler.jsonc',
		qaConfigPath: 'apps/api-videos/wrangler.qa.jsonc',
		dir: 'apps/api-videos',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'videos',
			vars: {
				Issuer: AUTH_ISSUER,
				// The API's own base URL (subtitle links are built from it); not a JWT audience check
				Audience: 'https://videos.api.alummahnow.net',
				WEBSOCKET_URL: 'https://realtime.alummahnow.net',
				CORS_ORIGINS: 'https://videos.alummahnow.net,https://alummahnow.net,https://www.alummahnow.net,https://admin.alummahnow.net,https://cms.alummahnow.net',
				// CDN host of the primary Bunny library the stream secrets point at
				// (498994); uploads get their playUrl on it. A host of another library
				// here 404s every new upload (2026-11-10 incident).
				bunny_hostname: 'vz-25839d05-80d.b-cdn.net',
				// Legacy library 400189: older videos keep playing from it (lib/bunny/libraries.ts)
				BUNNY_LEGACY_LIBRARY_ID: '400189',
				BUNNY_LEGACY_HOSTNAME: 'vz-215a1ffd-a5a.b-cdn.net',
				BUNNY_SIGN_URLS: 'true',
			},
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'secrets_store_secrets', name: 'BUNNY_TOKEN_KEY' },
				// Legacy library 400189's API and token keys (older videos)
				{ kind: 'secrets_store_secrets', name: 'BUNNY_LEGACY_STREAM_KEY' },
				{ kind: 'secrets_store_secrets', name: 'BUNNY_LEGACY_TOKEN_KEY' },
				// Search index; also the upload rate limits (SCALABILITY-AUDIT AV-14)
				{ kind: 'd1_databases', name: 'SEARCH_DB' },
				{ kind: 'kv_namespaces', name: 'TUS_SESSIONS' },
				{ kind: 'queue_producer', name: 'queue' },
				{ kind: 'queue_producer', name: 'MODERATION_QUEUE' },
				// Per-video processing-check loop (src/lib/processing/loop.ts; 2026-11-10 incident)
				{ kind: 'queue_producer', name: 'PROCESSING_CHECK_QUEUE' },
				// R2 delivery beside Bunny (epic #687): dual write, visibility moves, purge, private URL signing
				{ kind: 'r2_buckets', name: 'MEDIA' },
				{ kind: 'r2_buckets', name: 'MEDIA_PRIVATE' },
				{ kind: 'queue_producer', name: 'TRANSCODE_QUEUE' },
				{ kind: 'secrets_store_secrets', name: 'MEDIA_SIGN_KEY' },
				{ kind: 'r2_buckets', name: 'MEDIA_ORIGINALS' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-processing-check' },
				// Heavy admin actions run as queued jobs (lib/admin/jobs.ts)
				{ kind: 'queue_producer', name: 'ADMIN_JOBS_QUEUE' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-admin-jobs' },
				// Restore legacy profile fields (lib/admin/legacy-restore.ts): verified emails, backups
				{ kind: 'd1_databases', name: 'AUTH_DB' },
				{ kind: 'r2_buckets', name: 'ADMIN_BACKUPS' },
				{ kind: 'r2_buckets', name: 'videos' },
				// Per-video view counter in the realtime worker (SCALABILITY-AUDIT AV-1)
				{ kind: 'durable_objects', name: 'VIEW_COUNTER' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'videos-stage', requireRoutes: true, vars: { Issuer: STAGE_AUTH, Audience: STAGE_API, WEBSOCKET_URL: STAGE_REALTIME, ENVIRONMENT: 'stage', CORS_ORIGINS: 'https://videos.stage.alummahnow.net,https://admin.stage.alummahnow.net,https://stage.alummahnow.net,https://www.stage.alummahnow.net,https://cms.stage.alummahnow.net' }, requiredBindings: [INTERNAL_API_KEY, { kind: 'queue_producer', name: 'queue' }, { kind: 'queue_producer', name: 'MODERATION_QUEUE' }, { kind: 'queue_producer', name: 'ADMIN_JOBS_QUEUE' }, { kind: 'queue_consumer', name: 'al-ummah-now-admin-jobs-stage' }, { kind: 'd1_databases', name: 'SEARCH_DB' }, { kind: 'd1_databases', name: 'AUTH_DB' }, { kind: 'r2_buckets', name: 'ADMIN_BACKUPS' }, { kind: 'durable_objects', name: 'VIEW_COUNTER' }] }),
	},
	{
		app: 'processor',
		configPath: 'apps/processor/wrangler.jsonc',
		qaConfigPath: 'apps/processor/wrangler.qa.jsonc',
		dir: 'apps/processor',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-now-processor',
			// The category-suggestion test hook answers E2E titles without the model: never in production
			vars: { ENVIRONMENT: 'production', WEBSOCKET_URL: 'https://realtime.alummahnow.net', CATEGORY_AI_TEST_HOOK: 'false', CMS_INTERNAL_URL: 'https://cms.alummahnow.net' },
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'd1_databases', name: 'REPORTS_DB' },
				// AI category suggestions read the video text and write its category (src/categorize)
				{ kind: 'r2_buckets', name: 'videos' },
				{ kind: 'd1_databases', name: 'SEARCH_DB' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-videos' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-moderation' },
				// Dead-letter visibility: the processor stores every DLQ message (src/dlq).
				{ kind: 'queue_consumer', name: 'al-ummah-now-dlq' },
				{ kind: 'ai', name: 'AI' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-now-processor-stage', vars: { ENVIRONMENT: 'stage', WEBSOCKET_URL: STAGE_REALTIME, CMS_INTERNAL_URL: 'https://cms.stage.alummahnow.net', AI_MODERATION_ENABLED: 'false' }, requiredBindings: [INTERNAL_API_KEY, { kind: 'r2_buckets', name: 'videos' }, { kind: 'queue_consumer', name: 'al-ummah-now-videos-stage' }, { kind: 'queue_consumer', name: 'al-ummah-now-moderation-stage' }, { kind: 'queue_consumer', name: 'al-ummah-now-dlq-stage' }, { kind: 'ai', name: 'AI' }] }),
	},
	{
		app: 'websocket-server',
		configPath: 'apps/websocket-server/wrangler.jsonc',
		qaConfigPath: 'apps/websocket-server/wrangler.qa.jsonc',
		dir: 'apps/websocket-server',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-now-comms',
			vars: {
				ENVIRONMENT: 'production',
				WEBSOCKET_URL: 'https://realtime.alummahnow.net',
				// Without Issuer the server cannot verify token signatures and refuses all tokens.
				Issuer: AUTH_ISSUER,
			},
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'durable_objects', name: 'WEBSOCKET_DO' },
				// The view counter flushes into the video JSON (SCALABILITY-AUDIT AV-1)
				{ kind: 'r2_buckets', name: 'VIDEOS' },
				// The post view counter flushes into analytics_daily (SCALABILITY-AUDIT AV-17)
				{ kind: 'd1_databases', name: 'NOTIFICATIONS_DB' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-now-comms-stage', requireRoutes: true, vars: { ENVIRONMENT: 'stage', WEBSOCKET_URL: STAGE_REALTIME, Issuer: STAGE_AUTH }, requiredBindings: [INTERNAL_API_KEY, { kind: 'durable_objects', name: 'WEBSOCKET_DO' }, { kind: 'r2_buckets', name: 'VIDEOS' }, { kind: 'd1_databases', name: 'NOTIFICATIONS_DB' }] }),
	},
	{
		app: 'scheduler',
		configPath: 'apps/scheduler/wrangler.jsonc',
		qaConfigPath: 'apps/scheduler/wrangler.qa.jsonc',
		dir: 'apps/scheduler',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-scheduler',
			vars: { WEBSOCKET_URL: 'https://realtime.alummahnow.net' },
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'queue_producer', name: 'QUEUE' },
				{ kind: 'r2_buckets', name: 'VIDEOS' },
				{ kind: 'r2_buckets', name: 'SCHEDULED_VIDEOS' },
				{ kind: 'r2_buckets', name: 'CHANNELS' },
				{ kind: 'kv_namespaces', name: 'SCHEDULER_LOCKS' },
				{ kind: 'durable_objects', name: 'SCHEDULER_LOCK' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-scheduler-stage', vars: { WEBSOCKET_URL: STAGE_REALTIME }, requiredBindings: [INTERNAL_API_KEY, { kind: 'queue_producer', name: 'QUEUE' }] }),
	},
	{
		// R2 video delivery (epic #687): transcoder container, queue consumer, /priv/ edge.
		// Released with `wrangler deploy` after the promote (Containers take no versions upload).
		app: 'media',
		configPath: 'apps/media/wrangler.jsonc',
		qaConfigPath: 'apps/media/wrangler.qa.jsonc',
		dir: 'apps/media',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-now-media',
			requireRoutes: true,
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'secrets_store_secrets', name: 'MEDIA_SIGN_KEY' },
				{ kind: 'r2_buckets', name: 'MEDIA' },
				{ kind: 'r2_buckets', name: 'MEDIA_PRIVATE' },
				{ kind: 'durable_objects', name: 'TRANSCODER' },
				{ kind: 'services', name: 'VIDEOS' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-transcode' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({
			name: 'al-ummah-now-media-stage',
			requireRoutes: true,
			requiredBindings: [INTERNAL_API_KEY, { kind: 'r2_buckets', name: 'MEDIA' }, { kind: 'r2_buckets', name: 'MEDIA_PRIVATE' }, { kind: 'queue_consumer', name: 'al-ummah-now-transcode-stage' }],
		}),
	},
	{
		// Short share links on alummahnow.link (wiki AUN-SHORT-LINKS): redirects to the real pages.
		// Released with `wrangler deploy` after the promote, then smoked (short-links-smoke.ts).
		app: 'short-links',
		configPath: 'apps/short-links/wrangler.jsonc',
		qaConfigPath: 'apps/short-links/wrangler.qa.jsonc',
		dir: 'apps/short-links',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-now-short-links',
			requireRoutes: true,
			vars: {
				ENVIRONMENT: 'production',
				SITE_ORIGIN: 'https://videos.alummahnow.net',
				WWW_ORIGIN: 'https://www.alummahnow.net',
				API_ORIGIN: 'https://videos.api.alummahnow.net',
				ERRORS_INGEST_URL: 'https://admin.api.alummahnow.net/internal/errors',
			},
			requiredBindings: [INTERNAL_API_KEY],
			...PROD_GUARDS,
			// Its own zone: the short link host itself, never a QA/stage one
			forbiddenValues: [...PROD_GUARDS.forbiddenValues!, /\b(qa|stage)\.alummahnow\.link/],
			allowedHosts: ['alummahnow.link'],
		},
		stage: {
			env: 'stage',
			...STAGE_GUARDS,
			allowedHosts: ['stage.alummahnow.link'],
			name: 'al-ummah-now-short-links-stage',
			requireRoutes: true,
			vars: { ENVIRONMENT: 'stage', SITE_ORIGIN: 'https://videos.stage.alummahnow.net', API_ORIGIN: 'https://videos.api.stage.alummahnow.net' },
			requiredBindings: [INTERNAL_API_KEY],
		},
	},
	{
		// Platform analytics collector for the videos admin (docs/admin/LIVE_OPS.md Part A).
		// Crons only (no route); released with `wrangler deploy` after the promote.
		app: 'cost-monitor',
		configPath: 'apps/cost-monitor/wrangler.jsonc',
		qaConfigPath: 'apps/cost-monitor/wrangler.qa.jsonc',
		dir: 'apps/cost-monitor',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-cost-monitor',
			vars: { ENVIRONMENT: 'production', COLLECT_ENVS: 'production,stage,qa', ERRORS_INGEST_URL: 'https://admin.api.alummahnow.net/internal/errors' },
			requiredBindings: [INTERNAL_API_KEY, { kind: 'd1_databases', name: 'COSTS_DB' }, { kind: 'secrets_store_secrets', name: 'CF_ANALYTICS_TOKEN' }],
			...PROD_GUARDS,
		},
		stage: stageRule({
			name: 'al-ummah-cost-monitor-stage',
			vars: { ENVIRONMENT: 'stage', COLLECT_ENVS: 'stage' },
			requiredBindings: [INTERNAL_API_KEY, { kind: 'd1_databases', name: 'COSTS_DB' }, { kind: 'secrets_store_secrets', name: 'CF_ANALYTICS_TOKEN' }],
		}),
	},
	{
		// Public status page (docs/status-page/README.md): its own Worker and D1, custom domain
		// status[.stage].alummahnow.net. Released with `wrangler deploy` after the promote, then smoke-tested.
		app: 'status',
		configPath: 'apps/status/wrangler.jsonc',
		qaConfigPath: 'apps/status/wrangler.qa.jsonc',
		dir: 'apps/status',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-status',
			requireRoutes: true,
			vars: { ENVIRONMENT: 'production', ERRORS_INGEST_URL: 'https://admin.api.alummahnow.net/internal/errors' },
			requiredBindings: [INTERNAL_API_KEY, RESEND_API_KEY, { kind: 'd1_databases', name: 'STATUS_DB' }],
			...PROD_GUARDS,
		},
		stage: stageRule({
			name: 'al-ummah-status-stage',
			requireRoutes: true,
			vars: { ENVIRONMENT: 'stage' },
			requiredBindings: [INTERNAL_API_KEY, { kind: 'd1_databases', name: 'STATUS_DB' }],
		}),
	},
	{
		app: 'admin-api',
		configPath: 'apps/admin-api/wrangler.jsonc',
		qaConfigPath: 'apps/admin-api/wrangler.qa.jsonc',
		dir: 'apps/admin-api',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-admin-api',
			vars: { ENVIRONMENT: 'production', WEBSOCKET_URL: 'https://realtime.alummahnow.net', AUTH_MODERATION_CLIENT_ID: AUTH_MODERATION_CLIENT, ADMIN_WEB_URL: 'https://admin.alummahnow.net' },
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'd1_databases', name: 'REPORTS_DB' },
				{ kind: 'queue_producer', name: 'queue' },
				// Short/video format backfill (admin "Video formats"; api-videos consumes it)
				{ kind: 'queue_producer', name: 'PROCESSING_CHECK_QUEUE' },
				// Contact us mail (lib/contact-email.ts), sent off the request path by its own queue
				RESEND_API_KEY,
				// Errors page: async ingest (queue + DLQ, consumed here), Retry of dead letters, private source maps
				{ kind: 'queue_producer', name: 'ERRORS_QUEUE' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-errors' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-errors-dlq' },
				{ kind: 'services', name: 'PROCESSOR' }, { kind: 'services', name: 'SCHEDULER' },
				{ kind: 'r2_buckets', name: 'SOURCEMAPS' },
				// Scholar sites own domains (lib/sites/saas.ts, #1212)
				{ kind: 'secrets_store_secrets', name: 'SITES_SAAS_TOKEN' },
				{ kind: 'r2_buckets', name: 'theme_packages' },
				{ kind: 'services', name: 'VIDEOS' },
				{ kind: 'queue_producer', name: 'CONTACT_MAIL_QUEUE' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-contact-mail' },
				{ kind: 'queue_producer', name: 'ERRORS_DLQ' },
				// Requests to auth (docs/admin/AUTH_MODERATION_REQUESTS.md)
				{ kind: 'queue_producer', name: 'AUTH_REQUESTS_QUEUE' },
				{ kind: 'queue_consumer', name: 'auth-moderation-requests' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-admin-api-stage', requireRoutes: true, vars: { ENVIRONMENT: 'stage', WEBSOCKET_URL: STAGE_REALTIME, Issuer: STAGE_AUTH, AUTH_MODERATION_CLIENT_ID: AUTH_MODERATION_CLIENT, ADMIN_WEB_URL: 'https://admin.stage.alummahnow.net' }, requiredBindings: [INTERNAL_API_KEY, { kind: 'd1_databases', name: 'REPORTS_DB' }, RESEND_API_KEY, { kind: 'r2_buckets', name: 'theme_packages' }, { kind: 'services', name: 'VIDEOS' }, { kind: 'queue_producer', name: 'CONTACT_MAIL_QUEUE' }, { kind: 'queue_consumer', name: 'al-ummah-now-contact-mail-stage' }, { kind: 'queue_producer', name: 'ERRORS_DLQ' }, { kind: 'queue_producer', name: 'AUTH_REQUESTS_QUEUE' }, { kind: 'queue_consumer', name: 'auth-moderation-requests-stage' }, { kind: 'queue_producer', name: 'ERRORS_QUEUE' }, { kind: 'queue_consumer', name: 'al-ummah-now-errors-stage' }, { kind: 'queue_consumer', name: 'al-ummah-now-errors-dlq-stage' }, { kind: 'services', name: 'PROCESSOR' }, { kind: 'r2_buckets', name: 'SOURCEMAPS' }, { kind: 'services', name: 'SCHEDULER' }] }),
	},
];
