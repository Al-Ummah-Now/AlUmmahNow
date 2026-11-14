/**
 * Public play data for other sites (the www home timeline, AlUmmahNowUI).
 *
 *   GET /api/v1/videos/:id/play  ─► loadPublicPlay ─► one PublicPlayItem (404 unless public and published)
 *   GET /api/v1/shorts?after=…   ─► publicShortsAfter ─► the next Shorts, each a PublicPlayItem
 *
 * An item carries what a plain <video> needs: `mp4` (a progressive file with audio, for the
 * muted hover preview) and `hls` (the adaptive stream the API's delivery switch chose,
 * lib/media/playback.ts). Every URL is signed here with the existing keys (Bunny directory
 * token for the video's own library, the R2 media token for private renditions) and expires
 * on the hour, so a response is identical, and cacheable, for up to an hour.
 *
 * MP4: the R2 transcode writes HLS only (apps/media/container/ladder.mjs), so the MP4 is
 * always Bunny's MP4 fallback file play_<res>.mp4 of the video's own library. Bunny writes
 * those up to 720p; the preview takes 480p, then 360p, 720p, 240p.
 *
 * Never served: private, unlisted (private), draft, hidden, deleted, still processing or
 * scheduled videos, live streams, videos of a removed or private channel, and videos of
 * E2E test accounts (@e2e.alummahnow.net).
 */
import { isShort, classifyVideoFormat, type MediaProviderId, type VideoFormat, type VideoR2State } from '@al-ummah/shared-types';
import { bunnyLibraryForVideo, type BunnyLibrariesEnv, type BunnyLibrary } from '../bunny/libraries';
import { bunnyDirectoryToken, bunnyFileToken, signedBunnyUrl, tokenExpiry, unsignedBunnyUrl } from '../bunny-signing';
import { isVideoPubliclyVisible } from '../visibility';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { choosePlayback, logDecision } from './playback';
import { allProviders, bunnyRef } from './providers';
import { publicMp4Url } from './r2-delivery';
import type { MediaEnv } from './r2-delivery';
import { channelNameFields } from '../channelName';

/** One playable video, as both endpoints return it. */
export interface PublicPlayItem {
	id: string;
	format: VideoFormat;
	title: string;
	channelName: string;
	channelHandle: string | null;
	width: number | null;
	height: number | null;
	durationSeconds: number | null;
	poster: string | null;
	mp4: { url: string; width: number | null; height: number | null } | null;
	hls: string | null;
	expiresAt: string;
	watchUrl: string;
}

/** Fields of a stored video this module reads. */
export interface PlayVideo {
	id: string;
	title?: string;
	userId?: string;
	channelId?: string;
	isPublic?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
	markedForDeletion?: boolean;
	isDraft?: boolean;
	isLive?: boolean;
	uploadStatus?: string;
	scheduledPublishStatus?: string;
	width?: number;
	height?: number;
	duration?: number;
	format?: unknown;
	playUrl?: string;
	thumbnailUrl?: string;
	thumbnailType?: string;
	thumbnailPending?: boolean;
	availableResolutions?: string[];
	bunnyLibraryId?: number;
	r2?: VideoR2State;
}

/** Fields of a stored channel this module reads. */
export interface PlayChannel {
	id?: string;
	name?: string;
	handle?: string;
	isDeleted?: boolean;
	isHidden?: boolean;
	markedForDeletion?: boolean;
	isPrivate?: boolean;
	isSuspended?: boolean;
}

export type PublicPlayEnv = MediaEnv &
	BunnyLibrariesEnv & {
		videos: R2Bucket;
		channels: R2Bucket;
		profiles?: R2Bucket;
		SEARCH_DB?: D1Database;
		CORS_ORIGINS?: string;
	};

/** MP4 fallback files Bunny writes, in the order the preview wants them. */
export const PREVIEW_MP4_ORDER = ['480p', '360p', '720p', '240p'] as const;
/** Assumed when the record lists no encoded resolution (older imports): Bunny writes 360p for any source of 360p or more. */
export const PREVIEW_MP4_UNKNOWN = '360p';

/** Accounts the E2E suites create (apps/web/e2e/test-utils/run-users.ts, the auth server's seeds). */
const E2E_EMAIL = /@e2e\.alummahnow\.net$/i;

export function isE2eEmail(email: unknown): boolean {
	return typeof email === 'string' && E2E_EMAIL.test(email.trim());
}

function positive(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The MP4 fallback rendition for the preview (pure). */
export function pickPreviewMp4(availableResolutions: readonly string[] | null | undefined): string {
	const listed = new Set((availableResolutions ?? []).map((r) => String(r).trim().toLowerCase()).filter(Boolean));
	if (!listed.size) return PREVIEW_MP4_UNKNOWN;
	return PREVIEW_MP4_ORDER.find((r) => listed.has(r)) ?? PREVIEW_MP4_UNKNOWN;
}

/** True when the channel is gone or not public (its videos are not served). */
export function isChannelHidden(channel: PlayChannel | null | undefined): boolean {
	if (!channel) return false;
	return channel.isDeleted === true || channel.isHidden === true || channel.markedForDeletion === true || channel.isPrivate === true || channel.isSuspended === true;
}

/**
 * Whether a stored video may be served publicly (pure): the shared public listing rule
 * (shared-types video-visibility.ts: drafts, markedForDeletion and readiness included), and
 * no live streams.
 */
export function isPubliclyPlayable(video: PlayVideo | null | undefined): video is PlayVideo {
	if (!video || typeof video.id !== 'string' || typeof video.title !== 'string') return false;
	return isVideoPubliclyVisible(video) && video.isLive !== true;
}

/**
 * The web app's origin for watch links: the `videos.` origin of CORS_ORIGINS
 * (every environment lists it), else the production one.
 */
export function webOrigin(corsOrigins: string | undefined): string {
	const listed = (corsOrigins ?? '').split(',').map((o) => o.trim());
	return listed.find((o) => /^https:\/\/videos\.([a-z0-9-]+\.)*alummahnow\.net$/.test(o)) ?? 'https://videos.alummahnow.net';
}

/** Signs Bunny URLs of one video in its own library (no-op when that library has no token key). */
async function bunnySigner(library: BunnyLibrary, videoId: string, expires: number) {
	const host = library.host;
	let token: string | null = null;
	const directory = async () => (token ??= await bunnyDirectoryToken(library.tokenKey, videoId, expires));
	return {
		host,
		/** A file under /<id>/ that loads others (playlist) or is a video file: directory token in the path */
		async file(name: string): Promise<string | null> {
			if (!host) return null;
			if (!library.tokenKey) return `https://${host}/${videoId}/${name}`;
			return signedBunnyUrl(host, videoId, name, await directory(), expires);
		},
		/** A still image: a single-file token, only for this video's own files on this library's host */
		async image(url: string): Promise<string> {
			if (!host || !library.tokenKey) return url;
			const plain = unsignedBunnyUrl(url);
			const prefix = `https://${host}/${videoId}/`;
			if (!plain.startsWith(prefix)) return url;
			const file = plain.slice(prefix.length);
			if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:jpe?g|png|webp|gif|avif)$/i.test(file) || file.includes('..')) return url;
			const path = `/${videoId}/${file}`;
			return `https://${host}${path}?token=${await bunnyFileToken(library.tokenKey, path, expires)}&expires=${expires}`;
		},
	};
}

/**
 * The play item of a video already known to be publicly playable. Never throws on a
 * delivery problem: a URL that cannot be built is null.
 */
export async function buildPublicPlay(
	env: PublicPlayEnv,
	video: PlayVideo,
	channel: PlayChannel | null,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<PublicPlayItem> {
	const expires = tokenExpiry(nowSeconds);
	const library = await bunnyLibraryForVideo(env, video);
	const bunnyId = bunnyRef(video as never);
	// Signed under Bunny's own id of the video (legacy rows: the video id itself)
	const bunny = await bunnySigner(library, bunnyId ?? video.id, expires);

	let hls: string | null = null;
	let poster: string | null = null;
	const ownThumbnail = video.thumbnailType === 'custom' || !video.thumbnailPending ? video.thumbnailUrl ?? null : null;

	// The adaptive stream: the provider rules decide, as on the watch page (lib/media/playback.ts)
	let source: MediaProviderId | null = null;
	try {
		const choice = await choosePlayback(env, video as never, { context: 'public-play', nowSeconds });
		logDecision(choice.decision);
		const first = choice.sources[0];
		if (first) {
			source = first.provider;
			hls = first.playUrl;
			// A custom or legacy image stays; a provider's own frame follows the provider that plays
			const replaceable = video.thumbnailType !== 'custom' && !!ownThumbnail && allProviders().some((p) => p.isOwnAutoThumbnail(video as never, ownThumbnail));
			// thumbnailPending is Bunny's sync saying its frame does not exist yet
			const frameExists = first.provider !== 'bunny' || !video.thumbnailPending;
			poster = replaceable || (!ownThumbnail && frameExists) ? first.thumbnailUrl ?? null : null;
		}
	} catch (error) {
		logger.warn('[PublicPlay] Delivery choice failed; serving Bunny', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
	}
	const onBunny = !!bunnyId;
	if (!source && onBunny) hls = await bunny.file('playlist.m3u8');
	if (!poster && ownThumbnail) poster = await bunny.image(ownThumbnail);

	// Preview MP4: Bunny's MP4 fallback when Bunny holds the video, else R2's public MP4
	const mp4Url = onBunny ? await bunny.file(`play_${pickPreviewMp4(video.availableResolutions)}.mp4`) : publicMp4Url(env, video as never);
	const id = video.id;
	const format = classifyVideoFormat(video).format;
	return {
		id,
		format,
		title: video.title ?? '',
		...channelNameFields(channel),
		channelHandle: channel?.handle ? channel.handle : null,
		width: positive(video.width),
		height: positive(video.height),
		durationSeconds: positive(video.duration),
		poster,
		mp4: mp4Url ? { url: mp4Url, width: null, height: null } : null,
		hls,
		expiresAt: new Date(expires * 1000).toISOString(),
		// A Short's page is /shorts/{id} (D-SEO-10)
		watchUrl: `${webOrigin(env.CORS_ORIGINS)}/en/${format === 'short' ? 'shorts' : 'video'}/${encodeURIComponent(id)}`,
	};
}

/** Per-request reads of channels and uploader profiles (one R2 read each). */
export class PlayLookups {
	private channels = new Map<string, Promise<PlayChannel | null>>();
	private e2e = new Map<string, Promise<boolean>>();
	constructor(private env: PublicPlayEnv) {}

	channel(id: string | undefined): Promise<PlayChannel | null> {
		if (!id) return Promise.resolve(null);
		let entry = this.channels.get(id);
		if (!entry) {
			entry = new R2Repository<PlayChannel>(this.env.channels).getObject(id).catch(() => null);
			this.channels.set(id, entry);
		}
		return entry;
	}

	/** True when the uploader is an E2E test account. A profile that cannot be read is not one. */
	isE2eUser(userId: string | undefined): Promise<boolean> {
		if (!userId || !this.env.profiles) return Promise.resolve(false);
		let entry = this.e2e.get(userId);
		if (!entry) {
			entry = (async () => {
				try {
					const profile = (await (await this.env.profiles!.get(userId))?.json<{ email?: unknown }>()) ?? null;
					return isE2eEmail(profile?.email);
				} catch {
					return false;
				}
			})();
			this.e2e.set(userId, entry);
		}
		return entry;
	}
}

/**
 * The stored video and its channel when the video may be served publicly, else null.
 * `requireShort` keeps only Shorts (the Shorts feed).
 */
export async function loadPlayable(
	env: PublicPlayEnv,
	lookups: PlayLookups,
	id: string,
	opts: { requireShort?: boolean } = {},
): Promise<{ video: PlayVideo; channel: PlayChannel | null } | null> {
	const video = await new R2Repository<PlayVideo>(env.videos).getObject(id).catch(() => null);
	if (!isPubliclyPlayable(video) || video.id !== id) return null;
	if (opts.requireShort && !isShort(video)) return null;
	const [channel, e2e] = await Promise.all([lookups.channel(video.channelId), lookups.isE2eUser(video.userId)]);
	if (isChannelHidden(channel) || e2e) return null;
	return { video, channel };
}

/** One video's play item, or null (404) when it is not public and published. */
export async function loadPublicPlay(env: PublicPlayEnv, id: string, nowSeconds?: number): Promise<PublicPlayItem | null> {
	const found = await loadPlayable(env, new PlayLookups(env), id);
	return found ? buildPublicPlay(env, found.video, found.channel, nowSeconds) : null;
}

// ---------------------------------------------------------------------------
// The Shorts feed
// ---------------------------------------------------------------------------

export const SHORTS_DEFAULT_LIMIT = 10;
export const SHORTS_MAX_LIMIT = 20;
/** Index pages read per request at most (rows the R2 check drops are replaced from the next page). */
const SHORTS_MAX_PAGES = 4;

interface ShortRow {
	id: string;
	created_at: number | null;
	rowid: number;
}

/**
 * Public Shorts, newest first: the search index's browse order for Shorts
 * (GET /api/search?type=video&format=short&sort=date: created_at DESC, rowid DESC,
 * created_at = publishedAt, else dateCreated). Visible rows of visible channels only.
 */
const SHORTS_FROM = `FROM search_videos d LEFT JOIN search_channels c ON c.id = d.channel_id
	WHERE d.visible = 1 AND (c.id IS NULL OR c.visible = 1) AND d.is_short = 1 AND d.is_live = 0`;

/** Where `after` sits in the order, or null when it is not a listed Short. */
async function anchorOf(db: D1Database, after: string): Promise<ShortRow | null> {
	return db.prepare(`SELECT d.id AS id, d.created_at AS created_at, d.rowid AS rowid ${SHORTS_FROM} AND d.id = ?`).bind(after).first<ShortRow>();
}

/** One page of Short ids strictly after `anchor` in the feed order (pure SQL; tested on SQLite). */
export async function shortRowsAfter(db: D1Database, anchor: ShortRow | null, take: number): Promise<ShortRow[]> {
	const select = `SELECT d.id AS id, d.created_at AS created_at, d.rowid AS rowid ${SHORTS_FROM}`;
	const order = 'ORDER BY d.created_at DESC, d.rowid DESC LIMIT ?';
	let stmt: D1PreparedStatement;
	if (!anchor) {
		stmt = db.prepare(`${select} ${order}`).bind(take);
	} else if (anchor.created_at === null) {
		// NULL sorts last under DESC: only older-rowid NULL rows follow
		stmt = db.prepare(`${select} AND d.created_at IS NULL AND d.rowid < ? ${order}`).bind(anchor.rowid, take);
	} else {
		stmt = db
			.prepare(`${select} AND (d.created_at < ? OR d.created_at IS NULL OR (d.created_at = ? AND d.rowid < ?)) ${order}`)
			.bind(anchor.created_at, anchor.created_at, anchor.rowid, take);
	}
	const { results } = await stmt.all<ShortRow>();
	return results ?? [];
}

export class ShortsUnavailableError extends Error {}

/**
 * The next `limit` public Shorts after `after` (from the newest when `after` is
 * missing or not a listed Short). Each candidate is re-checked against its stored
 * record (the index can lag a visibility change by a moment). `next` is the id to
 * pass as `after` for the following page, null at the end.
 */
export async function publicShortsAfter(
	env: PublicPlayEnv,
	after: string | null | undefined,
	limit: number,
	nowSeconds?: number,
): Promise<{ items: PublicPlayItem[]; next: string | null }> {
	const db = env.SEARCH_DB;
	if (!db) throw new ShortsUnavailableError('SEARCH_DB is not bound');
	const take = Math.min(Math.max(Math.floor(limit) || SHORTS_DEFAULT_LIMIT, 1), SHORTS_MAX_LIMIT);
	const lookups = new PlayLookups(env);
	let anchor = after ? await anchorOf(db, after) : null;
	if (after && !anchor) logger.debug('[PublicPlay] Shorts cursor not listed; starting from the newest', { after });

	const found: { video: PlayVideo; channel: PlayChannel | null }[] = [];
	let more = false;
	const pageSize = Math.min(take * 2 + 5, 50);
	for (let page = 0; page < SHORTS_MAX_PAGES && found.length < take; page++) {
		const rows = await shortRowsAfter(db, anchor, pageSize);
		const checked = await Promise.all(rows.map((r) => loadPlayable(env, lookups, r.id, { requireShort: true })));
		let used = 0;
		for (const item of checked) {
			used++;
			if (item) found.push(item);
			if (found.length === take) break;
		}
		more = used < rows.length || rows.length === pageSize;
		if (!rows.length || rows.length < pageSize) {
			if (found.length === take) more = used < rows.length;
			break;
		}
		anchor = rows[used - 1]!;
	}

	const items = await Promise.all(found.map((f) => buildPublicPlay(env, f.video, f.channel, nowSeconds)));
	return { items, next: more && items.length ? items[items.length - 1]!.id : null };
}
