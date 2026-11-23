/**
 * The `update` block of GET /api/v1/app-config (wiki AUN-APP-UPDATES §3.3, §3.4, §3.7, §4.1): what an
 * app build should show, from the admin policy (`versions`), the release index (`releases`) and
 * store availability (`availability`). Pure: the endpoint loads the documents.
 *
 * Fail closed: a downloaded build (`direct`, `managed`) is only ever offered a release verified
 * under its repo's keys; store builds are sent to their store. While the `appUpdates` switch is
 * off nothing is offered and nothing is required.
 */
import { compareAppVersions, type AppConfigApp, type AppConfigPlatform, type AppReleaseNotes, type AppUpdateChannel, type AppUpdateSource } from '@al-ummah/shared-types';
import { appStoreBundleFor, entryKey, type ReleaseEntry, type ReleasesDocument } from './releases';

export type UpdateStatus = 'ok' | 'recommended' | 'required';
export type UpdateAction = 'store' | 'install' | 'download' | 'none';

export interface UpdatePolicy {
	minimumVersion: string;
	latestVersion?: string;
	storeUrl?: string;
	notesOverrides?: Record<string, AppReleaseNotes>;
	message?: AppReleaseNotes;
}

/** KV key of the availability document */
export const AVAILABILITY_KEY = 'availability';

/** `<app>/<platform>/<source>` → the newest version a super admin marked available there (TestFlight, Amazon) */
export type AvailabilityDocument = Record<string, string>;

export interface UpdateAnswer {
	enabled: boolean;
	status: UpdateStatus;
	minimumVersion: string;
	latestVersion: string | null;
	storeUrl: string | null;
	channel: AppUpdateChannel | null;
	publishedAt: string | null;
	notes: AppReleaseNotes | null;
	message: AppReleaseNotes | null;
	action: UpdateAction;
	url: string | null;
	manifestUrl: string | null;
	tag: string | null;
	signed: boolean | null;
	/** true / false: the server knows; null: the device checks with its store (Play, Microsoft Store) */
	available: boolean | null;
	checkHours: number | null;
	keys: { list: string; sig: string } | null;
}

export interface UpdateInput {
	app: AppConfigApp;
	platform: AppConfigPlatform;
	version: string;
	channel: AppUpdateChannel;
	source?: AppUpdateSource;
	arch?: string;
}

export interface UpdateContext {
	enabled: boolean;
	policy: UpdatePolicy;
	releases: ReleasesDocument;
	availability: AvailabilityDocument;
	/** `updates.checkHours` from the config rules, if set */
	checkHours?: unknown;
	/** The videos admin's staff-only Apps page (admin builds' Download) */
	adminAppsUrl?: string;
}

export const DEFAULT_CHECK_HOURS = 6;

export function checkHoursFrom(value: unknown): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isFinite(n) ? Math.min(48, Math.max(1, Math.round(n))) : DEFAULT_CHECK_HOURS;
}

const DEVICE_CHECKED: readonly AppUpdateSource[] = ['play', 'msstore'];
const MARKED: readonly AppUpdateSource[] = ['testflight', 'amazon'];
const STORES: readonly AppUpdateSource[] = ['appstore', 'testflight', 'play', 'amazon', 'msstore'];

/** The same version, by precedence (2026.11.22 = 2026.11.22.0; never by string). */
export const sameVersion = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && compareAppVersions(a, b) === 0;

/** The release this build's channel follows: a beta build takes the newer of beta and stable. */
export function releaseFor(doc: ReleasesDocument, app: string, platform: string, channel: AppUpdateChannel): ReleaseEntry | null {
	const stable = doc.entries[entryKey(app, platform, 'stable')] ?? null;
	if (channel === 'stable') return stable;
	const beta = doc.entries[entryKey(app, platform, 'beta')] ?? null;
	if (!beta) return stable;
	if (!stable) return beta;
	return compareAppVersions(beta.version, stable.version) >= 0 ? beta : stable;
}

/** What the build's install source can get now, and from which release. */
function offer(input: UpdateInput, ctx: UpdateContext): { version: string | null; entry: ReleaseEntry | null; available: boolean | null; storeUrl: string | null } {
	const source = input.source;
	const entry = releaseFor(ctx.releases, input.app, input.platform, input.channel);
	const keysSetUp = entry ? Boolean(ctx.releases.keys[entry.repo]) : false;
	const verified = entry && entry.signed && keysSetUp ? entry : null;
	const policyStore = ctx.policy.storeUrl ?? null;
	if (source === 'appstore') {
		const bundle = appStoreBundleFor(input.app, input.platform);
		const live = bundle ? ctx.releases.appStore[bundle] : undefined;
		if (!live) return { version: null, entry: null, available: false, storeUrl: policyStore };
		return { version: live.version, entry: entry && sameVersion(entry.version, live.version) ? entry : null, available: true, storeUrl: live.url };
	}
	if (source && MARKED.includes(source)) {
		const marked = ctx.availability[`${input.app}/${input.platform}/${source}`];
		if (!marked) return { version: null, entry: null, available: false, storeUrl: policyStore };
		return { version: marked, entry: entry && sameVersion(entry.version, marked) ? entry : null, available: true, storeUrl: policyStore };
	}
	if (source && DEVICE_CHECKED.includes(source)) {
		// Only what the release index knows: never an admin- or caller-supplied latest version
		return { version: entry?.version ?? null, entry, available: null, storeUrl: policyStore };
	}
	if (source === 'direct' || source === 'managed') {
		return { version: verified?.version ?? null, entry: verified, available: verified ? true : false, storeUrl: null };
	}
	// samsung, or an old build that sends no source: nothing to offer (the minimum still applies)
	return { version: null, entry: null, available: null, storeUrl: policyStore };
}

function actionFor(input: UpdateInput, entry: ReleaseEntry | null, version: string | null): { action: UpdateAction; url: string | null } {
	const source = input.source;
	if (!version || !source || source === 'samsung') return { action: 'none', url: null };
	if (STORES.includes(source)) return { action: 'store', url: null };
	if (!entry) return { action: 'none', url: null };
	if (source === 'direct') {
		// install needs a signed manifest the app can fetch and check; never install without one
		const installable = !!entry.manifestUrl && entry.artifacts.some((a) => (a.kind === 'velopack-full' || a.kind === 'sparkle-zip') && (!input.arch || !a.arch || a.arch === input.arch || a.arch === 'universal'));
		return installable ? { action: 'install', url: entry.url } : { action: 'download', url: entry.url };
	}
	return { action: 'download', url: entry.url };
}

export function updateAnswer(input: UpdateInput, ctx: UpdateContext): UpdateAnswer {
	const minimumVersion = ctx.policy.minimumVersion;
	if (!ctx.enabled) {
		return {
			enabled: false,
			status: 'ok',
			minimumVersion,
			latestVersion: null,
			storeUrl: null,
			channel: null,
			publishedAt: null,
			notes: null,
			message: null,
			action: 'none',
			url: null,
			manifestUrl: null,
			tag: null,
			signed: null,
			available: null,
			checkHours: null,
			keys: null,
		};
	}
	const o = offer(input, ctx);
	let { action, url } = actionFor(input, o.entry, o.version);
	const isAdmin = input.app === 'admin';
	if (isAdmin && action === 'download') url = ctx.adminAppsUrl ?? null;
	if (action === 'download' && !url) action = 'none';
	const below = compareAppVersions(input.version, minimumVersion) < 0;
	const behind = o.version !== null && compareAppVersions(input.version, o.version) < 0;
	const status: UpdateStatus = below ? 'required' : behind && action !== 'none' ? 'recommended' : 'ok';
	const latest = o.version;
	const overrideKey = latest ? Object.keys(ctx.policy.notesOverrides ?? {}).find((v) => sameVersion(v, latest)) : undefined;
	const override = overrideKey ? ctx.policy.notesOverrides?.[overrideKey] : undefined;
	const notes = isAdmin ? null : override ?? (o.entry && sameVersion(o.entry.version, latest) ? o.entry.notes : null);
	const repoKeys = o.entry ? ctx.releases.keys[o.entry.repo] : undefined;
	return {
		enabled: true,
		status,
		minimumVersion,
		latestVersion: latest,
		storeUrl: o.storeUrl,
		channel: o.entry?.channel ?? null,
		publishedAt: o.entry?.publishedAt ?? null,
		notes,
		message: below ? ctx.policy.message ?? null : null,
		action,
		url: action === 'download' || action === 'install' ? url : null,
		manifestUrl: action === 'install' ? (o.entry?.manifestUrl ?? null) : null,
		tag: o.entry?.tag ?? null,
		signed: o.entry ? o.entry.signed && Boolean(repoKeys) : null,
		available: o.available,
		checkHours: checkHoursFrom(ctx.checkHours),
		keys: repoKeys ? { list: repoKeys.list, sig: repoKeys.sig } : null,
	};
}
