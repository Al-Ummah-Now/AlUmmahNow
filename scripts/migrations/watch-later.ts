/** Pure part of watch-later-channel.ts (unit tested). */

/** Key prefix of the Watch later lists (api-videos lib/library.ts watchLaterId). */
export const WATCH_LATER_PREFIX = 'watch-later-';

/**
 * The stored JSON with `channelId` cleared, or null when nothing changes (no
 * channel already, not a JSON object, or not a Watch later list).
 */
export function clearedWatchLater(text: string): string | null {
	let record: unknown;
	try {
		record = JSON.parse(text);
	} catch {
		return null;
	}
	if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
	const r = record as Record<string, unknown>;
	const isWatchLater = r.systemType === 'watch_later' || (typeof r.id === 'string' && r.id.startsWith(WATCH_LATER_PREFIX));
	if (!isWatchLater || !r.channelId) return null;
	return JSON.stringify({ ...r, channelId: '' });
}
