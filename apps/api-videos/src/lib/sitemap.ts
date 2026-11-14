/**
 * Sitemap data for the videos site (wiki AUN-SEO, "Sitemap architecture"): what search engines
 * may list, read from the search index. Its rows exist only for publicly visible items (public,
 * ready, published, not removed; lib/search, shared-types search/documents.ts), and an item of a
 * hidden channel is left out, the same rule as search. Unlisted and private videos are never here.
 */
import { PUBLIC_MP4_PATH, type SearchDb } from '@al-ummah/shared-types';

export const SITEMAP_PAGE_SIZE = 2000;
export const SITEMAP_KINDS = ['videos', 'channels', 'playlists', 'posts'] as const;
export type SitemapKind = (typeof SITEMAP_KINDS)[number];

const TABLE: Record<SitemapKind, string> = { videos: 'search_videos', channels: 'search_channels', playlists: 'search_playlists', posts: 'search_posts' };

/** Rows of one kind, oldest first (stable pages), only visible ones in visible channels. */
function visibleFrom(kind: SitemapKind): string {
	const base = TABLE[kind];
	if (kind === 'channels') return `FROM ${base} d WHERE d.visible = 1`;
	return `FROM ${base} d LEFT JOIN search_channels c ON c.id = d.channel_id WHERE d.visible = 1 AND (c.id IS NULL OR c.visible = 1)`;
}

const iso = (ms: unknown): string | null => (typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null);

export interface SitemapSummary {
	pageSize: number;
	kinds: Record<SitemapKind, { count: number; pages: number; lastModified: string | null }>;
}

export async function sitemapSummary(db: SearchDb): Promise<SitemapSummary> {
	const kinds = {} as SitemapSummary['kinds'];
	for (const kind of SITEMAP_KINDS) {
		const row = await db.prepare(`SELECT count(*) AS n, max(d.indexed_at) AS m ${visibleFrom(kind)}`).first<{ n: number; m: number | null }>();
		const count = Number(row?.n ?? 0);
		kinds[kind] = { count, pages: Math.ceil(count / SITEMAP_PAGE_SIZE), lastModified: iso(row?.m) };
	}
	return { pageSize: SITEMAP_PAGE_SIZE, kinds };
}

export interface SitemapVideo {
	id: string;
	title: string;
	titleLocalized?: Record<string, string>;
	description?: string;
	duration: number | null;
	isShort: boolean;
	isLive: boolean;
	publishedAt: string | null;
	lastModified: string | null;
	views: number;
	channelName?: string;
	/** The stable public 480p MP4 (D-SEO-11, the watch page's VideoObject contentUrl); public R2 videos only */
	contentUrl?: string;
}
export interface SitemapChannel { id: string; handle?: string; name: string; lastModified: string | null }
export interface SitemapPlaylist { id: string; title: string; lastModified: string | null }
/** A public community post (its permalink /{locale}/post/{id}); only public, published ones are indexed */
export interface SitemapPost { id: string; channelId: string; lastModified: string | null }

type Row = { id: string; payload: string; created_at: number | null; indexed_at: number | null; duration: number | null; is_short: number; is_live: number; views: number };

function parse(payload: string): Record<string, unknown> {
	try {
		const value = JSON.parse(payload) as unknown;
		return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const record = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, string>) : undefined);

/**
 * The public MP4 of an indexed video: its `mp4Path` (set only for a ready pub/ rendition with an MP4,
 * media-delivery publicMp4Path) on the media host. The row itself is already public; the path is
 * re-checked so a stale or foreign value never becomes a URL.
 */
function contentUrl(mediaHost: string | undefined, id: string, path: unknown): string | undefined {
	if (!mediaHost || typeof path !== 'string' || !PUBLIC_MP4_PATH.test(path) || !path.startsWith(`pub/${id}/`)) return undefined;
	return `https://${mediaHost}/${path}`;
}

export async function sitemapPage(db: SearchDb, kind: SitemapKind, page: number, mediaHost?: string): Promise<(SitemapVideo | SitemapChannel | SitemapPlaylist | SitemapPost)[]> {
	const { results } = await db
		.prepare(`SELECT d.id, d.payload, d.created_at, d.indexed_at, d.duration, d.is_short, d.is_live, d.views ${visibleFrom(kind)} ORDER BY d.rowid LIMIT ? OFFSET ?`)
		.bind(SITEMAP_PAGE_SIZE, page * SITEMAP_PAGE_SIZE)
		.all<Row>();
	return (results ?? []).map((r) => {
		const p = parse(r.payload);
		if (kind === 'channels') return { id: r.id, handle: text(p.handle), name: text(p.name) ?? '', lastModified: iso(r.indexed_at) };
		if (kind === 'posts') return { id: r.id, channelId: text(p.channelId) ?? '', lastModified: iso(r.indexed_at) };
		if (kind === 'playlists') return { id: r.id, title: text(p.title) ?? text(p.name) ?? '', lastModified: iso(r.indexed_at) };
		return {
			id: r.id,
			title: text(p.title) ?? '',
			titleLocalized: record(p.titleLocalized),
			description: text(p.description)?.slice(0, 2048),
			duration: typeof r.duration === 'number' && r.duration > 0 ? r.duration : null,
			isShort: r.is_short === 1,
			isLive: r.is_live === 1,
			publishedAt: iso(r.created_at),
			lastModified: iso(r.indexed_at),
			views: Number(r.views ?? 0),
			channelName: text(p.channelName),
			contentUrl: contentUrl(mediaHost, r.id, p.mp4Path),
		};
	});
}
