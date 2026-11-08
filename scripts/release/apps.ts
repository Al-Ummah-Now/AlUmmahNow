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

const INTERNAL_API_KEY: Binding = { kind: 'secrets_store_secrets', name: 'INTERNAL_API_KEY' };

export const APPS: AppRule[] = [
	{
		app: 'web',
		configPath: 'apps/web/wrangler.production.jsonc',
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
			requiredBindings: [{ kind: 'r2_buckets', name: 'videos' }],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-now-stage', requireRoutes: true, vars: { Issuer: STAGE_AUTH, OPENAUTH_ISSUER: STAGE_AUTH, API_URL: STAGE_API, WEBSOCKET_URL: 'wss://realtime.stage.alummahnow.net/ws' }, requiredBindings: [{ kind: 'r2_buckets', name: 'videos' }] }),
	},
	{
		app: 'admin-web',
		configPath: 'apps/admin-web/wrangler.production.jsonc',
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
			},
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-admin-web-stage', requireRoutes: true, vars: { Issuer: STAGE_AUTH, OPENAUTH_ISSUER: STAGE_AUTH, API_URL: STAGE_API, ADMIN_API_URL: 'https://admin.api.stage.alummahnow.net', NEXT_PUBLIC_BASE_URL: 'https://admin.stage.alummahnow.net' } }),
	},
	{
		app: 'api-videos',
		configPath: 'apps/api-videos/wrangler.jsonc',
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
			},
			requiredBindings: [
				{ kind: 'd1_databases', name: 'REPORTS_DB' },
				INTERNAL_API_KEY,
				{ kind: 'secrets_store_secrets', name: 'BUNNY_TOKEN_KEY' },
				{ kind: 'kv_namespaces', name: 'RATE_LIMIT_KV' },
				{ kind: 'kv_namespaces', name: 'TUS_SESSIONS' },
				{ kind: 'queue_producer', name: 'queue' },
				{ kind: 'queue_producer', name: 'MODERATION_QUEUE' },
				{ kind: 'r2_buckets', name: 'videos' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'videos-stage', requireRoutes: true, vars: { Issuer: STAGE_AUTH, Audience: STAGE_API, WEBSOCKET_URL: STAGE_REALTIME, ENVIRONMENT: 'stage', CORS_ORIGINS: 'https://videos.stage.alummahnow.net,https://admin.stage.alummahnow.net,https://stage.alummahnow.net,https://www.stage.alummahnow.net,https://cms.stage.alummahnow.net' }, requiredBindings: [INTERNAL_API_KEY, { kind: 'queue_producer', name: 'queue' }, { kind: 'queue_producer', name: 'MODERATION_QUEUE' }, { kind: 'd1_databases', name: 'SEARCH_DB' }, { kind: 'd1_databases', name: 'REPORTS_DB' }] }),
	},
	{
		app: 'processor',
		configPath: 'apps/processor/wrangler.jsonc',
		dir: 'apps/processor',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-now-processor',
			vars: { ENVIRONMENT: 'production', WEBSOCKET_URL: 'https://realtime.alummahnow.net' },
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'd1_databases', name: 'REPORTS_DB' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-videos' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-moderation' },
				{ kind: 'ai', name: 'AI' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-now-processor-stage', vars: { ENVIRONMENT: 'stage', WEBSOCKET_URL: STAGE_REALTIME }, requiredBindings: [INTERNAL_API_KEY, { kind: 'queue_consumer', name: 'al-ummah-now-videos-stage' }, { kind: 'queue_consumer', name: 'al-ummah-now-moderation-stage' }, { kind: 'ai', name: 'AI' }] }),
	},
	{
		app: 'websocket-server',
		configPath: 'apps/websocket-server/wrangler.jsonc',
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
				{ kind: 'kv_namespaces', name: 'PRESENCE_KV' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-now-comms-stage', requireRoutes: true, vars: { ENVIRONMENT: 'stage', WEBSOCKET_URL: STAGE_REALTIME, Issuer: STAGE_AUTH }, requiredBindings: [INTERNAL_API_KEY, { kind: 'durable_objects', name: 'WEBSOCKET_DO' }] }),
	},
	{
		app: 'scheduler',
		configPath: 'apps/scheduler/wrangler.jsonc',
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
				{ kind: 'kv_namespaces', name: 'SCHEDULER_LOCKS' },
				{ kind: 'durable_objects', name: 'SCHEDULER_LOCK' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-scheduler-stage', vars: { WEBSOCKET_URL: STAGE_REALTIME }, requiredBindings: [INTERNAL_API_KEY, { kind: 'queue_producer', name: 'QUEUE' }] }),
	},
	{
		app: 'admin-api',
		configPath: 'apps/admin-api/wrangler.jsonc',
		dir: 'apps/admin-api',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-admin-api',
			vars: { ENVIRONMENT: 'production', WEBSOCKET_URL: 'https://realtime.alummahnow.net' },
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'd1_databases', name: 'REPORTS_DB' },
				{ kind: 'queue_producer', name: 'queue' },
			],
			...PROD_GUARDS,
		},
		stage: stageRule({ name: 'al-ummah-admin-api-stage', requireRoutes: true, vars: { ENVIRONMENT: 'stage', WEBSOCKET_URL: STAGE_REALTIME, Issuer: STAGE_AUTH }, requiredBindings: [INTERNAL_API_KEY, { kind: 'd1_databases', name: 'REPORTS_DB' }] }),
	},
];
