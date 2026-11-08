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
				Issuer: AUTH_ISSUER,
				OPENAUTH_ISSUER: AUTH_ISSUER,
				NEXTJS_ENV: 'production',
				API_URL: VIDEOS_API,
				WEBSOCKET_URL: 'wss://realtime.alummahnow.net/ws',
			},
			requiredBindings: [{ kind: 'r2_buckets', name: 'videos' }],
			...PROD_GUARDS,
		},
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
				Audience: 'https://videos.alummahnow.net',
				WEBSOCKET_URL: 'https://ws.alummahnow.net',
				CORS_ORIGINS: 'https://videos.alummahnow.net,https://alummahnow.net,https://www.alummahnow.net,https://admin.alummahnow.net',
			},
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'secrets_store_secrets', name: 'BUNNY_TOKEN_KEY' },
				{ kind: 'kv_namespaces', name: 'RATE_LIMIT_KV' },
				{ kind: 'kv_namespaces', name: 'TUS_SESSIONS' },
				{ kind: 'queue_producer', name: 'queue' },
				{ kind: 'r2_buckets', name: 'videos' },
			],
			...PROD_GUARDS,
		},
	},
	{
		app: 'processor',
		configPath: 'apps/processor/wrangler.jsonc',
		dir: 'apps/processor',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-now-processor',
			vars: { ENVIRONMENT: 'production', WEBSOCKET_URL: 'https://ws.alummahnow.net' },
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'd1_databases', name: 'REPORTS_DB' },
				{ kind: 'queue_consumer', name: 'al-ummah-now-videos' },
			],
			...PROD_GUARDS,
		},
		accepted: [{ match: 'd1_databases[0].database_id is an unfilled placeholder', issue: '#208' }],
	},
	{
		app: 'websocket-server',
		configPath: 'apps/websocket-server/wrangler.jsonc',
		dir: 'apps/websocket-server',
		deployFlags: 'any',
		production: {
			env: null,
			name: 'al-ummah-now-comms',
			vars: { ENVIRONMENT: 'production', WEBSOCKET_URL: 'https://ws.alummahnow.net' },
			requiredBindings: [
				INTERNAL_API_KEY,
				{ kind: 'durable_objects', name: 'WEBSOCKET_DO' },
				{ kind: 'kv_namespaces', name: 'PRESENCE_KV' },
			],
			...PROD_GUARDS,
		},
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
	},
];
