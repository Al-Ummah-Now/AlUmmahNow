/**
 * Remote config & feature flags for the native apps (Epic 9.3/9.5): the platforms, apps and
 * formats the APP_CONFIG documents use. api-videos validates and evaluates the documents
 * (lib/app-config.ts, lib/feature-flags.ts); the videos admin edits them (issue #413) and checks
 * a draft with the same rules before sending it.
 */

export const APP_CONFIG_PLATFORMS = ['ios', 'ipados', 'tvos', 'macos', 'android', 'androidtv', 'firetv', 'windows', 'linux', 'tizen', 'webos', 'web'] as const;
export const APP_CONFIG_APPS = ['viewer', 'studio', 'kids', 'tools', 'admin'] as const;
export type AppConfigPlatform = (typeof APP_CONFIG_PLATFORMS)[number];
export type AppConfigApp = (typeof APP_CONFIG_APPS)[number];

/** The documents in the APP_CONFIG namespace. */
export const APP_CONFIG_DOCUMENT_KEYS = ['flags', 'config', 'versions'] as const;
export type AppConfigDocumentKey = (typeof APP_CONFIG_DOCUMENT_KEYS)[number];

/**
 * An app build's version: 3 or 4 numeric parts (1.4.2, 2026.11.22.2; a missing 4th part is 0), an optional
 * semver pre-release (`-preview.3`) and optional build metadata (`+abc`, ignored). Wiki AUN-APP-UPDATES §2.1.
 */
export const APP_CONFIG_SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
/** A flag or config key: lower case, starting with a letter. */
export const APP_CONFIG_RULE_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;
/** A `versions` entry: `<app>/<platform>` or `<app>/*` (every platform of the app), optionally for one channel (`#beta`). */
export const APP_CONFIG_VERSIONS_KEY = /^[a-z]+\/([a-z]+|\*)(#(stable|beta))?$/;
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

/**
 * -1 / 0 / 1 by semver precedence over 4 numeric parts: `2026.11.22` = `2026.11.22.0` < `2026.11.22.2`;
 * a pre-release is below its release (`1.5.0-preview.2` < `1.5.0-preview.10` < `1.5.0`); build metadata
 * (`+…`) is ignored. Throws on a malformed version.
 */
export function compareAppVersions(a: string, b: string): number {
  const pa = APP_CONFIG_SEMVER.exec(a);
  const pb = APP_CONFIG_SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`invalid version: ${!pa ? a : b}`);
  for (let i = 1; i <= 4; i++) {
    const d = Number(pa[i] ?? 0) - Number(pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return comparePreRelease(pa[5], pb[5]);
}

/**
 * -1 / 0 / 1 over the numeric parts only: `1.4.0-beta.1` counts as `1.4.0`. Feature-flag and config
 * rules (`minVersion` / `maxVersion`) use this, so a beta of 1.4.0 already gets 1.4.0's flags.
 */
export function compareAppVersionCores(a: string, b: string): number {
  const pa = APP_CONFIG_SEMVER.exec(a);
  const pb = APP_CONFIG_SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`invalid version: ${!pa ? a : b}`);
  for (let i = 1; i <= 4; i++) {
    const d = Number(pa[i] ?? 0) - Number(pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Semver §11: no pre-release > any pre-release; identifiers compared left to right, numbers below words. */
function comparePreRelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const xa = a.split('.');
  const xb = b.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const ia = xa[i];
    const ib = xb[i];
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;
    const na = /^\d+$/.test(ia);
    const nb = /^\d+$/.test(ib);
    if (na && nb) {
      const d = Number(ia) - Number(ib);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (ia !== ib) {
      return ia < ib ? -1 : 1;
    }
  }
  return 0;
}

/** Two documents are the same with key order ignored (a document read back from KV equals the one an editor started from). */
export function sameAppConfigDocument(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}
