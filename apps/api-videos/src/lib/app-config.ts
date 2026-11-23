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
import { APP_CONFIG_APPS, APP_CONFIG_PLATFORMS, APP_CONFIG_SEMVER, APP_CONFIG_VERSIONS_KEY, APP_RELEASE_NOTES_MAX, compareAppVersionCores, compareAppVersions } from '@al-ummah/shared-types';
import type { AppUpdateChannel } from '@al-ummah/shared-types';
import { emptyReleases, type ReleasesDocument } from './app-updates/releases';
import { updateAnswer, type AvailabilityDocument, type UpdateInput } from './app-updates/answer';
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

const LocalizedText = z.object({ en: z.string().trim().min(1).max(APP_RELEASE_NOTES_MAX), ar: z.string().trim().min(1).max(APP_RELEASE_NOTES_MAX) }).strict();

export const VersionPolicySchema = z.object({
	minimumVersion: z.string().regex(SEMVER),
	/** Kept for old documents; the release index fills it now (AUN-APP-UPDATES §3.4) */
	latestVersion: z.string().regex(SEMVER).optional(),
	storeUrl: z.string().url().startsWith('https://').optional(),
	/** Replaces the release's notes for that version only (AUN-APP-UPDATES §3.4) */
	notesOverrides: z
		.record(z.string().regex(SEMVER), LocalizedText)
		.refine((o) => Object.keys(o).length <= 5, { message: 'At most 5 versions' })
		.optional(),
	/** Shown on the forced screen (both languages or neither) */
	message: LocalizedText.optional(),
});
export type VersionPolicy = z.infer<typeof VersionPolicySchema>;

/** KV `versions` document: `{ "<app>/<platform>": VersionPolicy }`, plus optional `"<app>/*"` fallbacks. */
export const VersionsDocumentSchema = z.record(z.string().regex(APP_CONFIG_VERSIONS_KEY), VersionPolicySchema);
export type VersionsDocument = z.infer<typeof VersionsDocumentSchema>;

export const DEFAULT_POLICY: VersionPolicy = { minimumVersion: '0.0.0' };

/** Most specific first: `<app>/<platform>#<channel>`, `<app>/<platform>`, `<app>/*#<channel>`, `<app>/*`. */
export function policyFor(doc: VersionsDocument | undefined, app: AppName, platform: Platform, channel: AppUpdateChannel = 'stable'): VersionPolicy {
	return doc?.[`${app}/${platform}#${channel}`] ?? doc?.[`${app}/${platform}`] ?? doc?.[`${app}/*#${channel}`] ?? doc?.[`${app}/*`] ?? DEFAULT_POLICY;
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

export interface UpdateDocuments {
	/** The appUpdates switch (off: nothing offered, nothing required) */
	enabled: boolean;
	releases?: ReleasesDocument;
	availability?: AvailabilityDocument;
	adminAppsUrl?: string;
}

export function buildAppConfig(
	input: { app: AppName; platform: Platform; version: string; channel?: UpdateInput['channel']; source?: UpdateInput['source']; arch?: string },
	doc: VersionsDocument | undefined,
	remote: { flags?: Record<string, unknown>; config?: Record<string, unknown> } = {},
	updates: UpdateDocuments = { enabled: false },
) {
	const channel = input.channel ?? 'stable';
	const policy = policyFor(doc, input.app, input.platform, channel);
	return {
		api: { current: CURRENT_API_VERSION, supported: [...SUPPORTED_API_VERSIONS] },
		update: updateAnswer(
			{ app: input.app, platform: input.platform, version: input.version, channel, source: input.source, arch: input.arch },
			{
				enabled: updates.enabled,
				policy,
				releases: updates.releases ?? emptyReleases(),
				availability: updates.availability ?? {},
				checkHours: remote.config?.['updates.checkHours'],
				adminAppsUrl: updates.adminAppsUrl,
			},
		),
		// Remote config (Epic 9.5, lib/feature-flags.ts)
		flags: remote.flags ?? {},
		config: remote.config ?? {},
	};
}
