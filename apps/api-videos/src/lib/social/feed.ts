/**
 * Channel feeds (RSS 2.0) for scheduler tools: Hootsuite, Buffer, Later, Sprout, Zapier/Make and IFTTT read a
 * feed and post each new item (owner 2026-11-14: "if someone uses hootsuite or similar we need to be able help
 * them somehow"). Public items only, newest first, each with its link, thumbnail enclosure and Media RSS
 * thumbnail. The web app serves them at /feeds/{channelId}/{kind}.xml (socialFeedPath).
 *
 * Items come from the search index (public rows of the channel, one indexed query) and are then read like a
 * post would be (loadSocialContent), so anything made private since it was indexed is left out.
 */
import { metaSeparator, type SocialEvent, type SocialFeedKind, type SocialLanguage, type SocialPreview } from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { loadSocialContent, webOrigin, type SocialContent, type SocialContentEnv } from './content';

export const FEED_ITEMS = 30;
/** Scheduler tools poll every 15–60 minutes; a feed may be that stale */
export const FEED_CACHE_SECONDS = 900;

export interface FeedEnv extends SocialContentEnv {
	SEARCH_DB?: unknown;
}

/** The tab names the channel page uses, per language (kinds of content, not copy of ours). */
const KIND_LABEL: Record<SocialFeedKind, Record<SocialLanguage, string>> = {
	all: { en: '', ar: '' },
	videos: { en: 'Videos', ar: 'المرئيات' },
	shorts: { en: 'Shorts', ar: 'المقاطع القصيرة' },
	posts: { en: 'Posts', ar: 'المنشورات' },
	live: { en: 'Live', ar: 'البث المباشر' },
};

interface Row {
	id: string;
	created_at: number | null;
	is_short: number;
	is_live: number;
}

async function videoRows(db: D1Database, channelId: string, kind: SocialFeedKind): Promise<Row[]> {
	const filter = kind === 'videos' ? 'AND is_short = 0 AND is_live = 0' : kind === 'shorts' ? 'AND is_short = 1' : kind === 'live' ? 'AND is_live = 1' : '';
	const { results } = await db
		.prepare(`SELECT id, created_at, is_short, is_live FROM search_videos WHERE channel_id = ? AND visible = 1 ${filter} ORDER BY created_at DESC LIMIT ?`)
		.bind(channelId, FEED_ITEMS)
		.all<Row>();
	return results ?? [];
}

async function postRows(db: D1Database, channelId: string): Promise<Row[]> {
	const { results } = await db
		.prepare('SELECT id, created_at, 0 AS is_short, 0 AS is_live FROM search_posts WHERE channel_id = ? AND visible = 1 ORDER BY created_at DESC LIMIT ?')
		.bind(channelId, FEED_ITEMS)
		.all<Row>();
	return results ?? [];
}

export interface FeedItem {
	content: SocialContent;
	date: number;
}

/** The newest public items of a kind; null when the channel isn't public. */
export async function feedItems(env: FeedEnv, channelId: string, kind: SocialFeedKind): Promise<{ channel: SocialContent['channel']; items: FeedItem[] } | null> {
	const channel = await new R2Repository<{ name?: string; isDeleted?: boolean; isHidden?: boolean; isPrivate?: boolean; isSuspended?: boolean }>(env.channels).getObject(channelId);
	if (!channel || channel.isDeleted || channel.isHidden || channel.isPrivate || channel.isSuspended) return null;
	const db = env.SEARCH_DB as D1Database | undefined;
	const rows: Array<Row & { event: SocialEvent }> = [];
	if (db) {
		if (kind !== 'posts') for (const r of await videoRows(db, channelId, kind)) rows.push({ ...r, event: r.is_short ? 'short' : 'video' });
		if (kind === 'posts' || kind === 'all') for (const r of await postRows(db, channelId)) rows.push({ ...r, event: 'post' });
	}
	rows.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
	const picked = rows.slice(0, FEED_ITEMS);
	const loaded = await Promise.all(picked.map((r) => loadSocialContent(env, channelId, r.event, r.id, { playable: false })));
	const items: FeedItem[] = [];
	loaded.forEach((content, i) => {
		if (!content) return;
		const published = Date.parse(content.publishedAt ?? '');
		items.push({ content, date: Number.isFinite(published) ? published : picked[i]!.created_at ?? Date.now() });
	});
	// The channel part comes from any item; with none, read it the same way loadSocialContent does
	const first = items[0]?.content.channel;
	const origin = webOrigin(env);
	const handle = (channel as { handle?: string }).handle;
	const names = (channel as { nameLocalized?: Record<string, string> }).nameLocalized ?? {};
	const name = channel.name?.trim() || names.en || '';
	return {
		channel: first ?? {
			id: channelId,
			name: { en: names.en || name, ar: names.ar || name },
			...(handle ? { handle } : {}),
			url: handle ? `${origin}/en/@${handle}` : `${origin}/en/channels/${encodeURIComponent(channelId)}`,
		},
		items,
	};
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** XML text: escaped, with characters XML 1.0 forbids removed. */
export function xml(value: string): string {
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

const localizedPath = (url: string, lang: SocialLanguage) => (lang === 'ar' ? url.replace(/\/en(\/|$)/, '/ar$1') : url);

/** The feed document. `feedUrl` is the feed's own public address (atom:link rel=self). */
export function buildRss(feed: { channel: SocialContent['channel']; items: FeedItem[] }, kind: SocialFeedKind, lang: SocialLanguage, feedUrl: string, now = Date.now()): string {
	const label = KIND_LABEL[kind][lang];
	const channelName = feed.channel.name[lang] || feed.channel.name.en;
	const title = label ? `${channelName}${metaSeparator(lang, '·')}${label}` : channelName;
	const lastBuild = feed.items[0]?.date ?? now;
	const items = feed.items.map(({ content: c, date }) => {
		const text = c.event === 'post' ? (c.text ?? c.title[lang]) : c.title[lang];
		const thumb = c.thumbnailUrl
			? `
      <enclosure url="${xml(c.thumbnailUrl)}" length="0" type="image/jpeg"/>
      <media:thumbnail url="${xml(c.thumbnailUrl)}"/>
      <media:content url="${xml(c.thumbnailUrl)}" medium="image" type="image/jpeg"/>`
			: '';
		return `
    <item>
      <title>${xml(c.title[lang])}</title>
      <link>${xml(c.canonicalUrl[lang])}</link>
      <guid isPermaLink="false">${xml(`${c.event === 'post' ? 'post' : 'video'}:${c.entityId}`)}</guid>
      <pubDate>${new Date(date).toUTCString()}</pubDate>
      <description>${xml(text)}</description>
      <category>${c.event}</category>${thumb}
    </item>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xml(title)}</title>
    <link>${xml(localizedPath(feed.channel.url, lang))}</link>
    <description>${xml(title)}</description>
    <language>${lang}</language>
    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>
    <ttl>${FEED_CACHE_SECONDS / 60}</ttl>
    <atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml"/>${items.join('')}
  </channel>
</rss>
`;
}

const PREVIEW_ROWS = 3;

/**
 * The newest public video, Short, live recording and community post of a channel (a few rows each, the first that is
 * still public wins). Null when the channel isn't public. Live recordings are listed as videos (search_videos is_live).
 */
export async function previewItems(env: FeedEnv, channelId: string): Promise<SocialPreview | null> {
	const channel = await new R2Repository<{ name?: string; nameLocalized?: Record<string, string>; handle?: string; userId?: string; isDeleted?: boolean; isHidden?: boolean; isPrivate?: boolean; isSuspended?: boolean }>(env.channels).getObject(channelId);
	if (!channel || channel.isDeleted || channel.isHidden || channel.isPrivate || channel.isSuspended) return null;
	const origin = webOrigin(env);
	const names = channel.nameLocalized ?? {};
	const name = channel.name?.trim() || names.en || '';
	const page = (lang: SocialLanguage) => (channel.handle ? `${origin}/${lang}/@${channel.handle}` : `${origin}/${lang}/channels/${encodeURIComponent(channelId)}`);
	const preview: SocialPreview = { channel: { en: names.en || name, ar: names.ar || name }, channelUrl: { en: page('en'), ar: page('ar') }, items: {} };
	const db = env.SEARCH_DB as D1Database | undefined;
	if (!db) return preview;
	const videoIds = (filter: string) =>
		db.prepare(`SELECT id FROM search_videos WHERE channel_id = ? AND visible = 1 ${filter} ORDER BY created_at DESC LIMIT ?`).bind(channelId, PREVIEW_ROWS).all<{ id: string }>();
	// Live: the channel's newest streams that aired (live_sessions, through the owner index; owner_id is the channel
	// owner), loaded the way the sender loads a live event, so the preview links to the live page as the post does
	const ownerId = channel.userId;
	const liveIds = ownerId
		? db
				.prepare(
					"SELECT stream_id AS id, MAX(created_at) AS at FROM live_sessions WHERE owner_id = ? AND channel_id = ? AND is_test = 0 AND status IN ('live', 'ended') GROUP BY stream_id ORDER BY at DESC LIMIT ?",
				)
				.bind(ownerId, channelId, PREVIEW_ROWS)
				.all<{ id: string }>()
		: Promise.resolve({ results: [] as { id: string }[] });
	const [videos, shorts, lives, posts] = await Promise.all([
		videoIds('AND is_short = 0 AND is_live = 0'),
		videoIds('AND is_short = 1'),
		liveIds.catch((error: unknown) => {
			logger.warn('[Social] Live preview lookup failed', { channelId, error: error instanceof Error ? error.message : String(error) });
			return { results: [] as { id: string }[] };
		}),
		db.prepare('SELECT id FROM search_posts WHERE channel_id = ? AND visible = 1 ORDER BY created_at DESC LIMIT ?').bind(channelId, PREVIEW_ROWS).all<{ id: string }>(),
	]);
	const lists: Array<[SocialEvent, { id: string }[]]> = [
		['video', videos.results ?? []],
		['short', shorts.results ?? []],
		['live', lives.results ?? []],
		['post', posts.results ?? []],
	];
	await Promise.all(
		lists.map(async ([event, rows]) => {
			for (const { id } of rows) {
				const content = await loadSocialContent(env, channelId, event, id, { playable: false });
				if (!content) continue;
				preview.items[event] = { title: content.title, url: content.url, ...(content.text ? { text: content.text } : {}) };
				return;
			}
		}),
	);
	return preview;
}
