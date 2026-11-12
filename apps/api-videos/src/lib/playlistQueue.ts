/**
 * Playlist playback queue (docs/specs/PLAYLIST-PLAYBACK.md section 3).
 *
 * Every player asks for "the queue": the list's ids in its saved order (manual
 * order, automatic sort, Watch later's user order, Liked newest first), cut to
 * a page around the playing video. The order is resolved here only; clients
 * never sort.
 *
 * Positions: `index` is the item's place in the stored list (what watch URLs
 * carry, stable for every viewer); `position` is its place among the items
 * this viewer may see (what "3 / 12" shows). Short lists are filtered exactly;
 * a list longer than FULL_SCAN_MAX is paged over the stored ids and the items a
 * viewer may not see are dropped from each page (`exact: false`).
 */
import { isShort } from '@al-ummah/shared-types';
import { canViewVideo, type VideoType } from './playlists';
import { loadPlaylistVideos } from './playlistOrder';
import { publicVideoFields } from './transformations';
import { withPlayback } from './media/playback';

/** Lists up to this length are loaded whole and filtered for the viewer. */
export const FULL_SCAN_MAX = 300;
export const QUEUE_PAGE_DEFAULT = 50;
export const QUEUE_PAGE_MAX = 100;

/** Private list aliases, resolved from the caller's session (never from the URL). */
export const LIST_ALIASES = { WL: 'watch_later', LL: 'liked' } as const;
export type ListAlias = keyof typeof LIST_ALIASES;
export type QueueKind = 'playlist' | 'watch_later' | 'liked';

export function listAliasOf(listId: string): ListAlias | null {
	return listId === 'WL' || listId === 'LL' ? listId : null;
}

export interface QueueEntry {
	id: string;
	/** Place in the stored list */
	index: number;
}

export interface QueueItem {
	id: string;
	index: number;
	position: number;
	title: string;
	titleLocalized?: Record<string, string>;
	thumbnailUrl?: string;
	duration?: number | null;
	channelId?: string;
	channelName?: string;
	isShort: boolean;
	/** HLS playlist (signed by the bunny-signing middleware like every response), for players that play the list in place (embeds, native apps) */
	playUrl?: string;
	uploadStatus?: string;
	/** Which source the API chose for playUrl (lib/media/playback.ts; a label only) */
	delivery?: { source: string };
}

export interface QueueWindow {
	total: number;
	exact: boolean;
	/** Where `video` is among the visible entries (null when it is not in the list) */
	position: number | null;
	/** The visible position that follows `index` when `video` is not in the list */
	nextPosition: number | null;
	offset: number;
	entries: QueueEntry[];
	prevOffset: number | null;
	nextOffset: number | null;
}

/**
 * Where the requested video is. With several occurrences the one nearest
 * `index` wins (playlists reject duplicates today; the rule keeps URLs right if
 * that changes).
 */
export function locate(entries: readonly QueueEntry[], videoId: string | undefined, index: number | undefined): number | null {
	if (!videoId) return null;
	let best: number | null = null;
	for (let i = 0; i < entries.length; i++) {
		if (entries[i].id !== videoId) continue;
		if (best === null || (index !== undefined && Math.abs(entries[i].index - index) < Math.abs(entries[best].index - index))) best = i;
		if (index === undefined) break;
	}
	return best;
}

/** The first visible entry at or after a stored index (the next item when the video left the list). */
export function positionAfter(entries: readonly QueueEntry[], index: number | undefined): number | null {
	if (index === undefined) return null;
	const at = entries.findIndex((e) => e.index >= index);
	return at === -1 ? null : at;
}

/** The page of `entries` to return: an explicit offset, else a window around the video, else the start. */
export function queueWindow(
	entries: readonly QueueEntry[],
	opts: { video?: string; index?: number; offset?: number; limit?: number; exact: boolean },
): QueueWindow {
	const limit = Math.min(QUEUE_PAGE_MAX, Math.max(1, opts.limit ?? QUEUE_PAGE_DEFAULT));
	const position = locate(entries, opts.video, opts.index);
	const nextPosition = position === null ? positionAfter(entries, opts.index) : null;
	let start: number;
	if (opts.offset !== undefined) start = opts.offset;
	else {
		const anchor = position ?? nextPosition;
		start = anchor === null ? 0 : anchor - Math.floor(limit / 2);
	}
	start = Math.max(0, Math.min(start, Math.max(0, entries.length - 1)));
	const end = Math.min(entries.length, start + limit);
	return {
		total: entries.length,
		exact: opts.exact,
		position,
		nextPosition,
		offset: start,
		entries: entries.slice(start, end),
		prevOffset: start > 0 ? Math.max(0, start - limit) : null,
		nextOffset: end < entries.length ? end : null,
	};
}

/**
 * The viewer's entries for a list of ids. Short lists are filtered exactly
 * (`known` saves re-reading videos an automatic sort already loaded).
 */
export async function visibleEntries(
	env: { videos: R2Bucket },
	ids: readonly string[],
	userId: string | undefined,
	known?: ReadonlyMap<string, VideoType>,
): Promise<{ entries: QueueEntry[]; exact: boolean; videos: Map<string, VideoType> }> {
	const all = ids.map((id, index) => ({ id, index }));
	if (ids.length > FULL_SCAN_MAX) return { entries: all, exact: false, videos: new Map(known ?? []) };
	const missing = ids.filter((id) => !known?.has(id));
	const videos = new Map(known ?? []);
	for (const [id, video] of await loadPlaylistVideos(env, missing)) videos.set(id, video);
	const entries = all.filter((e) => {
		const video = videos.get(e.id);
		return !!video && canViewVideo(video, userId);
	});
	return { entries, exact: true, videos };
}

/** The page's items, in order, without the ones this viewer may not see. */
export async function queueItems(
	env: { videos: R2Bucket; channels: R2Bucket; MEDIA_PUBLIC_HOST?: string },
	window: QueueWindow,
	userId: string | undefined,
	known: Map<string, VideoType>,
	channelNames: (channelIds: string[]) => Promise<Map<string, string>>,
): Promise<QueueItem[]> {
	const missing = window.entries.map((e) => e.id).filter((id) => !known.has(id));
	for (const [id, video] of await loadPlaylistVideos(env, missing)) known.set(id, video);
	const visible = window.entries
		.map((entry, i) => ({ entry, position: window.offset + i, video: known.get(entry.id) }))
		.filter((x): x is { entry: QueueEntry; position: number; video: VideoType } => !!x.video && canViewVideo(x.video, userId));
	const names = await channelNames([...new Set(visible.map((x) => x.video.channelId).filter(Boolean) as string[])]);
	return Promise.all(visible.map(async ({ entry, position, video }) => {
		// The public fields hide a thumbnail that is not ready yet; the API picks the playback
		// source (Bunny or R2) like every other read, so the queue's playUrl is that source's
		const view = publicVideoFields(video) as VideoType & { titleLocalized?: Record<string, string>; thumbnailUrl?: string; duration?: number | null; playUrl?: string; uploadStatus?: string; delivery?: { source: string } };
		const extra = (await withPlayback(env as never, video as never, view as never, 'queue')) as typeof view;
		return {
			id: entry.id,
			index: entry.index,
			position,
			title: video.title,
			...(extra.titleLocalized ? { titleLocalized: extra.titleLocalized } : {}),
			...(extra.thumbnailUrl ? { thumbnailUrl: extra.thumbnailUrl } : {}),
			duration: extra.duration ?? null,
			channelId: video.channelId,
			channelName: names.get(video.channelId) ?? '',
			isShort: isShort(video as never),
			...(extra.playUrl ? { playUrl: extra.playUrl } : {}),
			...(extra.uploadStatus ? { uploadStatus: extra.uploadStatus } : {}),
			...(extra.delivery ? { delivery: extra.delivery } : {}),
		};
	}));
}
