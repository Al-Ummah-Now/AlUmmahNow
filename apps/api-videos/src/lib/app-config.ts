/**
 * `/api/v1/app-config` (Epic 9.3): API versions and the minimum / latest app
 * version per platform and app, so native apps can force or suggest updates.
 *
 * Version policies come from the optional APP_CONFIG KV namespace (key
 * `versions`, Epic 9.5) over built-in defaults. A missing or invalid document
 * never blocks anyone: the defaults require 0.0.0.
 */
import { z } from 'zod';
import { CURRENT_API_VERSION, SUPPORTED_API_VERSIONS } from './api-version';
import { APP_CONFIG_APPS, APP_CONFIG_PLATFORMS, APP_CONFIG_SEMVER, APP_CONFIG_VERSIONS_KEY, compareAppVersionCores, compareAppVersions } from '@al-ummah/shared-types';
import type { AppConfigApp, AppConfigPlatform } from '@al-ummah/shared-types';
import { readAppConfigDocument } from './app-config-store';

// One list of platforms and apps, one version format, shared with the videos admin's editor (#413)
export const PLATFORMS = APP_CONFIG_PLATFORMS;
export const APPS = APP_CONFIG_APPS;
export type Platform = AppConfigPlatform;
export type AppName = AppConfigApp;

export const SEMVER = APP_CONFIG_SEMVER;

/** -1 / 0 / 1 by semver precedence (1.2.0-beta < 1.2.0; build metadata ignored). Update policy uses this. */
export const compareVersions = compareAppVersions;
/** -1 / 0 / 1 over the numeric parts only (1.2.0-beta counts as 1.2.0). Flag and config rules use this. */
export const compareVersionCores = compareAppVersionCores;

export const VersionPolicySchema = z.object({
	minimumVersion: z.string().regex(SEMVER),
	latestVersion: z.string().regex(SEMVER).optional(),
	storeUrl: z.string().url().startsWith('https://').optional(),
});
export type VersionPolicy = z.infer<typeof VersionPolicySchema>;

/** KV `versions` document: `{ "<app>/<platform>": VersionPolicy }`, plus optional `"<app>/*"` fallbacks. */
export const VersionsDocumentSchema = z.record(z.string().regex(APP_CONFIG_VERSIONS_KEY), VersionPolicySchema);
export type VersionsDocument = z.infer<typeof VersionsDocumentSchema>;

export const DEFAULT_POLICY: VersionPolicy = { minimumVersion: '0.0.0' };

export function policyFor(doc: VersionsDocument | undefined, app: AppName, platform: Platform): VersionPolicy {
	return doc?.[`${app}/${platform}`] ?? doc?.[`${app}/*`] ?? DEFAULT_POLICY;
}

export type UpdateStatus = 'ok' | 'recommended' | 'required';

export function updateStatus(version: string, policy: VersionPolicy): UpdateStatus {
	if (compareVersions(version, policy.minimumVersion) < 0) return 'required';
	if (policy.latestVersion && compareVersions(version, policy.latestVersion) < 0) return 'recommended';
	return 'ok';
}

/** Reads the `versions` document; invalid or missing documents fall back to the defaults (logged by the caller). */
export async function loadVersionsDocument(kv: KVNamespace | undefined): Promise<{ doc?: VersionsDocument; error?: string }> {
	if (!kv) return {};
	const raw = await readAppConfigDocument(kv, 'versions');
	if (raw == null) return {};
	const parsed = VersionsDocumentSchema.safeParse(raw);
	return parsed.success ? { doc: parsed.data } : { error: parsed.error.message };
}

export function buildAppConfig(
	input: { app: AppName; platform: Platform; version: string },
	doc: VersionsDocument | undefined,
	remote: { flags?: Record<string, unknown>; config?: Record<string, unknown> } = {},
) {
	const policy = policyFor(doc, input.app, input.platform);
	return {
		api: { current: CURRENT_API_VERSION, supported: [...SUPPORTED_API_VERSIONS] },
		update: {
			status: updateStatus(input.version, policy),
			minimumVersion: policy.minimumVersion,
			latestVersion: policy.latestVersion ?? null,
			storeUrl: policy.storeUrl ?? null,
		},
		// Remote config (Epic 9.5, lib/feature-flags.ts)
		flags: remote.flags ?? {},
		config: remote.config ?? {},
	};
}
