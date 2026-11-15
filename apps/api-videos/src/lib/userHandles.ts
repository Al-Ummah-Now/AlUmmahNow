/**
 * User @handles and public profile settings (Story 29.5).
 *
 * A user's public profile lives at /{locale}/u/@{handle}. Handles follow the channel rules
 * (lib/channelHandles.ts: 3-30 Latin letters, digits, `.`, `_`, `-`; unique case-insensitively)
 * and share the channel handle index, so one handle names exactly one channel or one person:
 * `channel-handles/{lowercase handle}` -> { handle, userId, kind: 'user', dateClaimed } (no
 * channelId). Channel lookups ignore these entries (resolveHandle reads channelId), and a channel
 * can't claim a handle a user holds (checkHandleAvailability treats an entry without channelId as
 * taken). A handle another channel recently gave up stays held for it (HANDLE_HOLD_DAYS).
 *
 * The profile appears only once its owner claims a handle: no handle, no public page. What it
 * shows besides the name, picture, bio and public channels is up to the owner (PublicProfilePrivacy).
 */

import {
	handleHistoryKey,
	handleKey,
	isHandleOnHold,
	normalizeHandleInput,
	readHandleEntry,
	readHandleHistory,
	validateHandleFormat,
	type HandleProblem,
} from './channelHandles';
import { logger } from './logger';

export const USER_HANDLE_KIND = 'user';

export interface UserHandleIndexEntry {
	handle: string;
	userId: string;
	kind: typeof USER_HANDLE_KIND;
	dateClaimed: string;
}

/** What the public profile shows. Missing fields take PUBLIC_PROFILE_DEFAULTS. */
export interface PublicProfilePrivacy {
	showSubscriptions: boolean;
	showPlaylists: boolean;
}

/**
 * Defaults (issue #371: "public playlists, subscriptions if public"): public playlists show,
 * subscriptions stay private until the owner turns them on. Liked videos are never public
 * (owner, 2026-11-14: "others see your likes? nope").
 */
export const PUBLIC_PROFILE_DEFAULTS: Readonly<PublicProfilePrivacy> = Object.freeze({
	showSubscriptions: false,
	showPlaylists: true,
});

/** The stored settings with defaults filled in (anything not a boolean takes the default). */
export function resolvePublicProfilePrivacy(stored: Partial<Record<keyof PublicProfilePrivacy, unknown>> | null | undefined): PublicProfilePrivacy {
	const pick = (key: keyof PublicProfilePrivacy) => (typeof stored?.[key] === 'boolean' ? (stored[key] as boolean) : PUBLIC_PROFILE_DEFAULTS[key]);
	return { showSubscriptions: pick('showSubscriptions'), showPlaylists: pick('showPlaylists') };
}

export function isUserHandleEntry(entry: unknown): entry is UserHandleIndexEntry {
	const e = entry as Partial<UserHandleIndexEntry> | null;
	return !!e && e.kind === USER_HANDLE_KIND && typeof e.userId === 'string' && !(e as { channelId?: unknown }).channelId;
}

/** Availability of `handle` for this user: their own current handle counts as available. */
export async function checkUserHandleAvailability(
	bucket: R2Bucket,
	handle: string,
	userId: string,
): Promise<{ available: boolean; handle: string; reason?: HandleProblem }> {
	const normalized = normalizeHandleInput(handle);
	const problem = validateHandleFormat(normalized);
	if (problem) return { available: false, handle: normalized, reason: problem };
	const [entry, history] = await Promise.all([readHandleEntry(bucket, normalized), readHandleHistory(bucket, normalized)]);
	if (entry && !(isUserHandleEntry(entry) && entry.userId === userId)) return { available: false, handle: normalized, reason: 'taken' };
	// Recently given up by a channel: still held for it (its old links redirect there)
	if (!entry && isHandleOnHold(history, undefined)) return { available: false, handle: normalized, reason: 'taken' };
	return { available: true, handle: normalized };
}

/**
 * Claim `handle` for the user. Create-only, like channel claims (SCALABILITY-AUDIT AV-13): of two
 * claims at once exactly one creates the index entry. Does not free the user's previous handle
 * (releaseUserHandle does, once the profile points at the new one).
 */
export async function claimUserHandle(
	bucket: R2Bucket,
	handle: string,
	userId: string,
): Promise<{ ok: true; handle: string } | { ok: false; reason: HandleProblem }> {
	const availability = await checkUserHandleAvailability(bucket, handle, userId);
	if (!availability.available) return { ok: false, reason: availability.reason || 'taken' };
	const entry: UserHandleIndexEntry = { handle: availability.handle, userId, kind: USER_HANDLE_KIND, dateClaimed: new Date().toISOString() };
	const created = await bucket.put(handleKey(entry.handle), JSON.stringify(entry), {
		httpMetadata: { contentType: 'application/json' },
		onlyIf: { etagDoesNotMatch: '*' },
	});
	if (!created) {
		// Already there: fine when it is this user's (a retry, or new letter case)
		const object = await bucket.get(handleKey(entry.handle));
		const stored = object ? await object.json<unknown>().catch(() => null) : null;
		if (!object || !isUserHandleEntry(stored) || stored.userId !== userId) {
			logger.debug('[UserHandles] Lost a concurrent handle claim', { handle: entry.handle });
			return { ok: false, reason: 'taken' };
		}
		if (stored.handle !== entry.handle) {
			await bucket.put(handleKey(entry.handle), JSON.stringify({ ...stored, handle: entry.handle }), {
				httpMetadata: { contentType: 'application/json' },
				onlyIf: { etagMatches: object.etag },
			});
		}
	}
	// A claim ends a released channel handle's redirect (as a channel claim does)
	await bucket.delete(handleHistoryKey(entry.handle)).catch((error) => {
		logger.warn('[UserHandles] Could not drop handle history after a claim', { handle: entry.handle, error: error instanceof Error ? error.message : String(error) });
	});
	return { ok: true, handle: entry.handle };
}

/** Free `handle` if (and only if) the index entry is this user's. */
export async function releaseUserHandle(bucket: R2Bucket, handle: string | null | undefined, userId: string): Promise<void> {
	if (!handle) return;
	const entry = await readHandleEntry(bucket, handle);
	if (isUserHandleEntry(entry) && entry.userId === userId) await bucket.delete(handleKey(handle));
}

/** The user a handle names, or null (unclaimed, a channel's, or malformed). */
export async function resolveUserHandle(bucket: R2Bucket, handle: string): Promise<string | null> {
	const problem = validateHandleFormat(handle);
	if (problem === 'invalid_characters' || problem === 'too_long' || problem === 'too_short') return null;
	const entry = await readHandleEntry(bucket, handle);
	return isUserHandleEntry(entry) ? entry.userId : null;
}

/**
 * The handle a comment author's name and avatar link to (/{locale}/u/@{handle}), or undefined when
 * there is no public page: no handle, or removed by an admin. Comments are the only way to reach a
 * user's profile (owner, 2026-11-14: "only way you reach a user profile is if he comments on a video
 * or post"). A banned user's page still answers 404 (loadPublicUser checks the ban list).
 */
export function linkableUserHandle(profile: { handle?: string | null; adminDeletion?: unknown } | null | undefined): string | undefined {
	if (!profile?.handle || profile.adminDeletion) return undefined;
	return profile.handle;
}
