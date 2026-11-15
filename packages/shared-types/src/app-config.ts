/**
 * Remote config & feature flags for the native apps (Epic 9.3/9.5): the platforms, apps and
 * formats the APP_CONFIG documents use. api-videos validates and evaluates the documents
 * (lib/app-config.ts, lib/feature-flags.ts); the videos admin edits them (issue #413) and checks
 * a draft with the same rules before sending it.
 */

export const APP_CONFIG_PLATFORMS = ['ios', 'ipados', 'tvos', 'macos', 'android', 'androidtv', 'firetv', 'windows', 'linux', 'tizen', 'webos', 'web'] as const;
export const APP_CONFIG_APPS = ['viewer', 'studio', 'kids'] as const;
export type AppConfigPlatform = (typeof APP_CONFIG_PLATFORMS)[number];
export type AppConfigApp = (typeof APP_CONFIG_APPS)[number];

/** The documents in the APP_CONFIG namespace. */
export const APP_CONFIG_DOCUMENT_KEYS = ['flags', 'config', 'versions'] as const;
export type AppConfigDocumentKey = (typeof APP_CONFIG_DOCUMENT_KEYS)[number];

/** An app build's version: 1.4.2, with an optional pre-release or build suffix. */
export const APP_CONFIG_SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]+)?$/;
/** A flag or config key: lower case, starting with a letter. */
export const APP_CONFIG_RULE_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;
/** A `versions` entry: `<app>/<platform>` or `<app>/*` (every platform of the app). */
export const APP_CONFIG_VERSIONS_KEY = /^[a-z]+\/([a-z]+|\*)$/;
/** Rules per document. */
export const APP_CONFIG_MAX_RULES = 500;

/** One rule of the `flags` or `config` document; the first matching rule of a key decides it. */
export interface AppConfigRule {
  key: string;
  enabled?: boolean;
  platforms?: AppConfigPlatform[];
  apps?: AppConfigApp[];
  minVersion?: string;
  maxVersion?: string;
  /** Language prefixes: `ar` matches `ar`, `ar-EG`, ... */
  locales?: string[];
  /** Percent of installs (0..100), stable per install id and key */
  rollout?: number;
  value?: unknown;
  note?: string;
}

export interface AppConfigVersionPolicy {
  minimumVersion: string;
  latestVersion?: string;
  storeUrl?: string;
}

export type AppConfigVersionsDocument = Record<string, AppConfigVersionPolicy>;

/** What an app build is, for a dry run. */
export interface AppConfigContext {
  platform: AppConfigPlatform;
  app: AppConfigApp;
  version: string;
  locale?: string;
  installId?: string;
}

/** What GET /api/v1/app-config answers that build (the dry run's result). */
export interface AppConfigResult {
  api: { current: string; supported: string[] };
  update: { status: 'ok' | 'recommended' | 'required'; minimumVersion: string; latestVersion: string | null; storeUrl: string | null };
  flags: Record<string, unknown>;
  config: Record<string, unknown>;
}

/** -1 / 0 / 1; pre-release and build suffixes are ignored. Throws on a malformed version. */
export function compareAppVersions(a: string, b: string): number {
  const pa = APP_CONFIG_SEMVER.exec(a);
  const pb = APP_CONFIG_SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`invalid version: ${!pa ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Two documents are the same with key order ignored (a document read back from KV equals the one an editor started from). */
export function sameAppConfigDocument(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}
