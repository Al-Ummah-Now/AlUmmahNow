/**
 * Which views may count toward Trending and Popular (wiki E07 "Discovery
 * ranking"), and the viewer key the processor de-duplicates them by
 * (NOTIFICATIONS_DB.discovery_viewers: one row per day, video and viewer).
 *
 * A view never counts when it comes from the video's owner, staff (the owner
 * of the platform included), an E2E or throwaway test account, a crawler or
 * headless browser, or autoplay (E21: the player choosing the next video is
 * not interest). Everything else counts once per viewer per video per day.
 *
 * Members are keyed by user id. Anonymous viewers are keyed by a hash of their
 * address (IPv6: its /64) with a random salt that exists for one UTC day only
 * (search_meta 'discovery:salt:<day>'; the ranking job deletes old salts), so
 * the stored keys can't be linked across days or back to an address.
 */
import { isStaff } from '@al-ummah/shared-types';
import { isTestOwnerEmail } from './job';

export type RankExclusion = 'owner' | 'staff' | 'test_account' | 'bot' | 'autoplay';

export interface ViewFacts {
	userId?: string | null;
	roles?: unknown;
	email?: string | null;
	videoOwnerId?: string | null;
	autoplay?: boolean;
	/** request-origin device class ('bot' for crawlers and headless browsers) */
	device?: string | null;
}

/** Pure: why this view must not count, or null when it may. */
export function rankExclusion(facts: ViewFacts): RankExclusion | null {
	if (facts.userId && facts.videoOwnerId && facts.userId === facts.videoOwnerId) return 'owner';
	if (facts.userId && isStaff(facts.roles)) return 'staff';
	if (isTestOwnerEmail(facts.email)) return 'test_account';
	if (facts.device === 'bot') return 'bot';
	if (facts.autoplay === true) return 'autoplay';
	return null;
}

export const SALT_KEY_PREFIX = 'discovery:salt:';

interface SaltDb {
	prepare(sql: string): {
		bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> };
	};
}

/** This isolate's salt for the current day (one D1 read per isolate per day). */
let cached: { day: string; salt: string } | null = null;

export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The day's random salt: created by the first view of the day, shared by every isolate. */
export async function dailySalt(db: SaltDb, now = Date.now()): Promise<string> {
	const day = utcDay(now);
	if (cached?.day === day) return cached.salt;
	const key = `${SALT_KEY_PREFIX}${day}`;
	const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
	await db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING').bind(key, fresh, now).run();
	const row = await db.prepare('SELECT value FROM search_meta WHERE key = ?').bind(key).first<{ value: string }>();
	const salt = row?.value ?? fresh;
	cached = { day, salt };
	return salt;
}

/** Test hook: forget the cached salt. */
export function resetSaltCache(): void {
	cached = null;
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Pure: the part of an address that identifies one anonymous viewer. IPv4 as is;
 * IPv6 by its /64 (one household or device gets a whole /64, so rotating the
 * rest of it is still one viewer). The user agent is left out on purpose: it is
 * free to change, so it would let one address count as many viewers. Viewers
 * behind one shared address count once, which only ever under-counts.
 */
export function addressBucket(address: string): string {
	const ip = address.trim().toLowerCase();
	if (!ip.includes(':')) return ip;
	const [head, tail = ''] = ip.split('::');
	const left = head ? head.split(':') : [];
	const right = tail ? tail.split(':') : [];
	const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
	return groups
		.slice(0, 4)
		.map((g) => (g || '0').replace(/^0+(?=.)/, ''))
		.join(':') + '::/64';
}

/**
 * The viewer key for a view that may count: 'u:<userId>' for members, else
 * 'a:<16 hex>' from the address (IPv6: its /64) + the day's salt. Null when an
 * anonymous request carries no address (nothing to de-duplicate by: not counted).
 */
export async function viewerKey(db: SaltDb | undefined, request: Request, userId: string | null | undefined, now = Date.now()): Promise<string | null> {
	if (userId) return `u:${userId}`;
	const address = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip');
	if (!address || !db) return null;
	const salt = await dailySalt(db, now);
	return `a:${(await sha256Hex(`${salt}|${addressBucket(address)}`)).slice(0, 16)}`;
}
