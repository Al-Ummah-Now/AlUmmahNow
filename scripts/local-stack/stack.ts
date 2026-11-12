/**
 * The local E2E stack: which Workers run, on which ports, with which local-only values.
 * docs/testing/LOCAL-STACK.md explains how it fits together; boot.ts starts it.
 *
 * Every Worker runs in ONE Miniflare instance, so queues, Durable Objects, D1, R2, KV and the
 * Secrets Store are shared exactly as in a deployed environment; each Worker still listens on its
 * own port (Miniflare `unsafeDirectSockets`). Nothing here may name a deployed resource: the
 * configs are generated from the apps' wrangler files with every remote binding made local
 * (configs.ts), and every outbound fetch to a non-local host goes to the fakes (fake-external.ts)
 * or is refused.
 *
 * All values below are local test values, not secrets.
 */
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');

/** Where boot.ts keeps generated configs, bundles, persisted state and stack.json. */
export const STATE_DIR = process.env.LOCAL_STACK_DIR ? resolve(process.env.LOCAL_STACK_DIR) : join(ROOT, '.local-stack');

/** The Auth repo (Al-Ummah-Now/AlUmmahNowAuth), checked out at its last released commit (resolve-refs.ts). */
export const AUTH_DIR = process.env.LOCAL_STACK_AUTH_DIR ? resolve(process.env.LOCAL_STACK_AUTH_DIR) : join(STATE_DIR, 'repos', 'auth');

export const HOST = 'localhost';

/** Ports: this repo's dev ports (CLAUDE.md) and the Auth repo's (its package.json dev scripts). */
export const PORTS = {
  web: 3001,
  'api-videos': 3086,
  websocket: 3087,
  processor: 3088,
  'admin-api': 3090,
  'admin-web': 3091,
  auth: 3301,
  profile: 3302,
  'auth-admin': 3303,
  /** Fake third-party CDN + control API (Bunny HLS/thumbnails, image host, SQL): fake-external.ts */
  'fake-cdn': 3190,
  /** The browser's proxy (Playwright `proxy`): faked HTTPS hosts answered locally, others refused: browser-proxy.ts */
  'browser-proxy': 3191,
} as const;
export type StackApp = keyof typeof PORTS;

export const url = (app: StackApp): string => `http://${HOST}:${PORTS[app]}`;

/** Local test values for every Secrets Store binding and secret var. Never real values. */
export const LOCAL_SECRETS: Record<string, string> = {
  INTERNAL_API_KEY: 'local-stack-internal-key',
  E2E_CODE_SINK_SECRET: 'local-stack-sink-secret',
  TEST_PROMOTE_SECRET: 'local-stack-promote-secret',
  MEDIA_SIGN_KEY: 'local-stack-media-sign-key',
  MEDIA_CDN_API_TOKEN: 'local-stack-fake',
  MEDIA_ANALYTICS_TOKEN: 'local-stack-fake',
  RESEND_API_KEY: 'local-stack-fake-resend',
  AUTH_MODERATION_CLIENT_SECRET: 'local-stack-moderation-secret',
  'bunny-stream-key': 'local-stack-fake-bunny',
  bunny_stream_library_id: '424242',
  BUNNY_TOKEN_KEY: 'local-stack-fake-bunny-token',
  image_storage_key: 'local-stack-fake-images',
};

/**
 * Confidential OAuth clients of the local issuer and the local secret each one's caller uses: boot
 * stores their hash (deployed environments set it with the Auth repo's rotate-client-secret.ts).
 */
export const LOCAL_CLIENT_SECRETS: Record<string, string> = {
  // admin-api's machine client for requests to auth and invites (AUTH_MODERATION_CLIENT_ID)
  'd7464de8-363d-4fc1-b1af-7c71653f0afc': LOCAL_SECRETS.AUTH_MODERATION_CLIENT_SECRET,
};

/** The secret value for a Secrets Store binding: by binding name, then by secret name. */
export function localSecret(binding: string, secretName?: string): string {
  return LOCAL_SECRETS[binding] ?? (secretName ? LOCAL_SECRETS[secretName] : undefined) ?? `local-stack-${binding}`;
}

/** Deployed hosts → local origins: CORS lists, client redirect URIs, issuer-derived links. */
export const PROD_HOST_TO_LOCAL: Record<string, string> = {
  'videos.alummahnow.net': url('web'),
  'admin.alummahnow.net': url('admin-web'),
  'videos.api.alummahnow.net': url('api-videos'),
  'admin.api.alummahnow.net': url('admin-api'),
  'realtime.alummahnow.net': url('websocket'),
  'auth.alummahnow.net': url('auth'),
  'profile.auth.alummahnow.net': url('profile'),
  'admin.auth.alummahnow.net': url('auth-admin'),
};

const COMMON_VARS = {
  ENVIRONMENT: 'qa',
  LOG_LEVEL: 'info',
  ERRORS_INGEST_URL: `${url('admin-api')}/internal/errors`,
};

const BROWSER_ORIGINS = [url('web'), url('admin-web'), url('profile'), url('auth-admin'), url('auth')].join(',');

export interface StackWorker {
  app: StackApp;
  /** Repo the worker lives in. */
  repo: 'videos' | 'auth';
  /** App directory, relative to the repo root. */
  dir: string;
  /** The wrangler file the local config is generated from (top level: complete bindings, prod client ids). */
  config: string;
  /** Replaces the wrangler `main` (OpenNext and React Router builds emit their own entry). */
  main?: string;
  /** Var overrides on top of the config's top-level vars. */
  vars: Record<string, string>;
  /** Present only when this build output exists (built apps); otherwise the worker is left out with a warning. */
  requires?: string;
}

export const WORKERS: StackWorker[] = [
  {
    app: 'api-videos',
    repo: 'videos',
    dir: 'apps/api-videos',
    config: 'wrangler.jsonc',
    vars: {
      ...COMMON_VARS,
      Issuer: url('auth'),
      Audience: url('api-videos'),
      WEBSOCKET_URL: url('websocket'),
      CORS_ORIGINS: BROWSER_ORIGINS,
      // R2 delivery's media Worker is not in the stack (delivery stays on the default, Bunny)
      MEDIA_PUBLIC_HOST: 'media.local-stack.test',
      // The fake Bunny CDN (fake-external.ts FAKE_CDN_HOST): workers reach it through the outbound
      // fakes, the browser through Playwright routes to PORTS['fake-cdn']
      bunny_hostname: 'vz-local-stack.b-cdn.net',
      BUNNY_SIGN_HOSTNAME: 'vz-local-stack.b-cdn.net',
      BUNNY_TEST_LIBRARY: 'true',
    },
  },
  {
    app: 'admin-api',
    repo: 'videos',
    dir: 'apps/admin-api',
    config: 'wrangler.jsonc',
    vars: {
      ...COMMON_VARS,
      Issuer: url('auth'),
      // A worker secret when deployed; its client's hash is set by boot (LOCAL_CLIENT_SECRETS)
      AUTH_MODERATION_CLIENT_SECRET: LOCAL_SECRETS.AUTH_MODERATION_CLIENT_SECRET,
      WEBSOCKET_URL: url('websocket'),
      ADMIN_WEB_URL: url('admin-web'),
      VIDEOS_API_URL: url('api-videos'),
    },
  },
  {
    app: 'processor',
    repo: 'videos',
    dir: 'apps/processor',
    config: 'wrangler.jsonc',
    vars: {
      ...COMMON_VARS,
      WEBSOCKET_URL: url('websocket'),
      // Never paid AI in tests: the Workers AI binding is dropped and the AI steps are off
      AI_MODERATION_ENABLED: 'false',
      AI_CATEGORIZE_ENABLED: 'false',
      CATEGORY_AI_TEST_HOOK: 'true',
    },
  },
  {
    app: 'websocket',
    repo: 'videos',
    dir: 'apps/websocket-server',
    config: 'wrangler.jsonc',
    vars: { ...COMMON_VARS, Issuer: url('auth'), WEBSOCKET_URL: url('websocket') },
  },
  {
    app: 'web',
    repo: 'videos',
    dir: 'apps/web',
    config: 'wrangler.jsonc',
    requires: '.open-next/worker.js',
    vars: {
      LOG_LEVEL: 'info',
      NEXTJS_ENV: 'qa',
      Issuer: url('auth'),
      OPENAUTH_ISSUER: url('auth'),
      API_URL: url('api-videos'),
      ADMIN_API_URL: url('admin-api'),
      WEBSOCKET_URL: `ws://${HOST}:${PORTS.websocket}/ws`,
      ERRORS_INGEST_URL: `${url('admin-api')}/internal/errors`,
      AUTH_PROFILE_URL: url('profile'),
      INTERNAL_API_KEY: LOCAL_SECRETS.INTERNAL_API_KEY,
    },
  },
  {
    app: 'admin-web',
    repo: 'videos',
    dir: 'apps/admin-web',
    config: 'wrangler.jsonc',
    requires: '.open-next/worker.js',
    vars: {
      LOG_LEVEL: 'info',
      NEXTJS_ENV: 'qa',
      Issuer: url('auth'),
      API_URL: url('api-videos'),
      NEXT_PUBLIC_API_URL: url('api-videos'),
      ADMIN_API_URL: url('admin-api'),
      NEXT_PUBLIC_BASE_URL: url('admin-web'),
      NEXT_PUBLIC_MAIN_SITE_URL: url('web'),
      ERRORS_INGEST_URL: `${url('admin-api')}/internal/errors`,
      INTERNAL_API_KEY: LOCAL_SECRETS.INTERNAL_API_KEY,
    },
  },
  {
    app: 'auth',
    repo: 'auth',
    dir: 'apps/auth',
    config: 'wrangler.json',
    vars: {
      ENVIRONMENT: 'development',
      LOG_LEVEL: 'info',
      OPENAUTH_ISSUER: url('auth'),
      PROFILE_APP_URL: `${url('profile')}/`,
      SIGN_IN_FALLBACK_URL: `${url('profile')}/`,
      ALLOWED_ORIGINS: 'localhost,127.0.0.1',
      // Same apps and paths as QA/stage/production (the Auth repo's wrangler configs); www and the CMS only when booted
      FRONTCHANNEL_LOGOUT_URLS: [`${url('profile')}/logout`, `${url('auth-admin')}/logout`, `${url('web')}/api/auth/logout`, `${url('admin-web')}/api/auth/logout`].join(','),
      CLIENT_REGISTRY_MODE: 'enforce',
      // The E2E code sink (codes stored in KV instead of emailed) and the test routes, as on QA/stage
      E2E_CODE_SINK_SECRET: LOCAL_SECRETS.E2E_CODE_SINK_SECRET,
      TEST_PROMOTE_SECRET: LOCAL_SECRETS.TEST_PROMOTE_SECRET,
      E2E_RUN_USERS: 'enabled',
      // Must resolve before a code goes to the sink; any real send goes to the Resend fake
      RESEND_API_KEY: LOCAL_SECRETS.RESEND_API_KEY,
    },
  },
  {
    app: 'profile',
    repo: 'auth',
    dir: 'apps/profile',
    config: 'wrangler.json',
    vars: { APP_ENV: 'development', LOG_LEVEL: 'info', AUTH_SERVER_URL: url('auth'), APP_URL: url('profile') },
  },
  {
    app: 'auth-admin',
    repo: 'auth',
    // `react-router build` (Cloudflare Vite plugin) emits the worker and its own wrangler.json here
    dir: 'apps/admin/build/server',
    config: 'wrangler.json',
    requires: 'index.js',
    vars: { AUTH_SERVER_URL: url('auth'), APP_URL: url('auth-admin') },
  },
];

export function repoDir(worker: StackWorker): string {
  return worker.repo === 'auth' ? AUTH_DIR : ROOT;
}

export function appDir(worker: StackWorker): string {
  return join(repoDir(worker), worker.dir);
}
