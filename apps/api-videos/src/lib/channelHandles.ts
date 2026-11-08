/**
 * Channel @handles (Story 29.1)
 *
 * A handle is 3-30 characters of Latin letters, digits, `.`, `_` and `-`,
 * starting and ending with a letter or digit. Handles are unique
 * case-insensitively: the display form keeps the owner's casing, the index
 * key is the lowercase form.
 *
 * Index: one object per handle in the `channel_tabs` bucket under
 * `channel-handles/{lowercase handle}` -> { handle, channelId, userId, dateClaimed }.
 * (The channels bucket is scanned by listings, so index objects can't live there.)
 * R2 is strongly consistent for read-after-write; a claim writes the index and
 * reads it back, so the loser of a simultaneous claim sees a conflict.
 */

import { logger } from './logger';

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
export const HANDLE_INDEX_PREFIX = 'channel-handles/';

const HANDLE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Words that cannot be claimed: app routes, system names and names that
 * could impersonate the platform or its staff.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
	'about', 'account', 'accounts', 'admin', 'administrator', 'alummah', 'alummahnow', 'al-ummah', 'al-ummah-now', 'ummah', 'ummahnow',
	'analytics', 'api', 'app', 'apps', 'auth', 'billing', 'blog', 'c', 'channel', 'channels', 'community', 'contact', 'dashboard',
	'developer', 'developers', 'docs', 'embed', 'explore', 'feed', 'feedback', 'help', 'history', 'home', 'index', 'info', 'legal',
	'library', 'live', 'login', 'logout', 'me', 'moderation', 'moderator', 'mod', 'mods', 'new', 'news', 'notifications', 'null',
	'official', 'playlist', 'playlists', 'policy', 'press', 'privacy', 'profile', 'register', 'root', 'search', 'sections', 'security',
	'settings', 'shorts', 'signin', 'signout', 'signup', 'staff', 'static', 'status', 'studio', 'subscriptions', 'support', 'system',
	'team', 'terms', 'test', 'trending', 'undefined', 'upload', 'user', 'users', 'video', 'videos', 'watch', 'www', 'lamahat',
]);

export type HandleProblem = 'too_short' | 'too_long' | 'invalid_characters' | 'reserved' | 'taken';

export interface HandleIndexEntry {
	handle: string;
	channelId: string;
	userId: string;
	dateClaimed: string;
}

/** Strip a leading `@` and surrounding whitespace. */
export function normalizeHandleInput(input: string): string {
	return String(input ?? '').trim().replace(/^@+/, '');
}

export function handleKey(handle: string): string {
	return `${HANDLE_INDEX_PREFIX}${normalizeHandleInput(handle).toLowerCase()}`;
}

/** Format-only validation (no uniqueness). */
export function validateHandleFormat(input: string): HandleProblem | null {
	const handle = normalizeHandleInput(input);
	if (handle.length < HANDLE_MIN_LENGTH) return 'too_short';
	if (handle.length > HANDLE_MAX_LENGTH) return 'too_long';
	if (!HANDLE_PATTERN.test(handle)) return 'invalid_characters';
	if (RESERVED_HANDLES.has(handle.toLowerCase())) return 'reserved';
	return null;
}

function slugify(value: string): string {
	return (value || '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, '')
		.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
		.slice(0, HANDLE_MAX_LENGTH - 5);
}

/**
 * Candidate default handles for a channel, best first: the Latin slug of its
 * name (English localized name preferred), the slug plus a short id suffix,
 * then `channel-{id prefix}`. Names in Arabic script slugify to nothing, so
 * those channels get the id-based form until the owner claims a handle.
 */
export function defaultHandleCandidates(channel: { id?: string; name?: string; nameLocalized?: Record<string, string> }): string[] {
	const idPart = (channel.id || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
	const base = slugify(channel.nameLocalized?.en || channel.name || '');
	const candidates: string[] = [];
	if (base) {
		candidates.push(base);
		candidates.push(`${base}-${idPart.slice(0, 4)}`);
		candidates.push(`${base}-${idPart.slice(0, 8)}`);
	}
	candidates.push(`channel-${idPart.slice(0, 8)}`);
	candidates.push(`channel-${idPart.slice(0, 16)}`);
	return [...new Set(candidates)].filter((h) => validateHandleFormat(h) === null);
}

export async function readHandleEntry(bucket: R2Bucket, handle: string): Promise<HandleIndexEntry | null> {
	const object = await bucket.get(handleKey(handle));
	if (!object) return null;
	try {
		return await object.json<HandleIndexEntry>();
	} catch (error) {
		logger.warn('[ChannelHandles] Unreadable handle index entry', { handle, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

/** Resolve a handle to its channel id (null when unclaimed). */
export async function resolveHandle(bucket: R2Bucket, handle: string): Promise<string | null> {
	if (validateHandleFormat(handle) === 'invalid_characters' || validateHandleFormat(handle) === 'too_long') return null;
	const entry = await readHandleEntry(bucket, handle);
	return entry?.channelId || null;
}

/** Availability for a channel (its own current handle counts as available). */
export async function checkHandleAvailability(
	bucket: R2Bucket,
	handle: string,
	channelId?: string,
): Promise<{ available: boolean; handle: string; reason?: HandleProblem }> {
	const normalized = normalizeHandleInput(handle);
	const problem = validateHandleFormat(normalized);
	if (problem) return { available: false, handle: normalized, reason: problem };
	const entry = await readHandleEntry(bucket, normalized);
	if (entry && entry.channelId !== channelId) return { available: false, handle: normalized, reason: 'taken' };
	return { available: true, handle: normalized };
}

/**
 * Claim `handle` for a channel. Returns the problem when it can't be claimed.
 * Does not release the channel's previous handle (see releaseHandle).
 */
export async function claimHandle(
	bucket: R2Bucket,
	handle: string,
	channel: { id?: string; userId?: string },
): Promise<{ ok: true; handle: string } | { ok: false; reason: HandleProblem }> {
	const availability = await checkHandleAvailability(bucket, handle, channel.id);
	if (!availability.available) return { ok: false, reason: availability.reason || 'taken' };

	const entry: HandleIndexEntry = {
		handle: availability.handle,
		channelId: channel.id as string,
		userId: channel.userId as string,
		dateClaimed: new Date().toISOString(),
	};
	await bucket.put(handleKey(entry.handle), JSON.stringify(entry), { httpMetadata: { contentType: 'application/json' } });

	// Read back: a concurrent claim of the same handle may have overwritten ours
	const stored = await readHandleEntry(bucket, entry.handle);
	if (!stored || stored.channelId !== channel.id) {
		logger.warn('[ChannelHandles] Lost a concurrent handle claim', { handle: entry.handle, channelId: channel.id });
		return { ok: false, reason: 'taken' };
	}
	return { ok: true, handle: entry.handle };
}

/** Release a handle if (and only if) it belongs to the channel. */
export async function releaseHandle(bucket: R2Bucket, handle: string | undefined | null, channelId: string): Promise<void> {
	if (!handle) return;
	const entry = await readHandleEntry(bucket, handle);
	if (entry && entry.channelId === channelId) {
		await bucket.delete(handleKey(handle));
	}
}

/** Claim the first available default handle for a channel. */
export async function claimDefaultHandle(
	bucket: R2Bucket,
	channel: { id?: string; userId?: string; name?: string; nameLocalized?: Record<string, string> },
): Promise<string | null> {
	for (const candidate of defaultHandleCandidates(channel)) {
		const result = await claimHandle(bucket, candidate, channel);
		if (result.ok) return result.handle;
	}
	logger.warn('[ChannelHandles] No default handle available', { channelId: channel.id });
	return null;
}
