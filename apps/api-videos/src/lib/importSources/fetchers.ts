/**
 * Reading a source's new items (wiki TOOLS-ADMIN TA-9, "Social import"). Each network through its
 * public API or feed, never a web page:
 *
 *   rss       the feed (RSS 2.0, Atom; podcast enclosures): a video enclosure → video, an image → image,
 *             else a link post to the item
 *   bluesky   app.bsky.feed.getAuthorFeed (posts without replies; reposts left out): images, link cards,
 *             videos (the blob from the account's server)
 *   mastodon  /api/v1/accounts/lookup, then the account's statuses without replies and boosts
 *   youtube   the channel's public feed: each new video waits for its file from the owner's Takeout
 *             export (the app matches it by video id, TA-13); YouTube's terms forbid downloading
 *   telegram  nothing to fetch: the bot's webhook records channel posts as they come (telegram.ts)
 *
 * Every URL fetched passes the link preview's public-address check (lib/link-preview.ts checkUrl).
 */
import { IMPORT_MAX_VIDEO_BYTES, type ImportItemKind, type ImportItemNote, type ImportSourceNetwork } from '@al-ummah/shared-types';
import { checkUrl, readLimited, safeFetch, PreviewError } from '../link-preview';
import { BSKY_RESOLVER } from '../social/adapters/bluesky';
import { SourceError } from './store';

/** Items read in one fetch at most (older ones on the first sync are left out). */
export const FETCH_LIMIT = 50;
const FEED_MAX_BYTES = 4 * 1024 * 1024;
const JSON_MAX_BYTES = 2 * 1024 * 1024;

export interface FetchedImage {
	url: string;
	alt?: string | null;
}

export interface FetchedVideo {
	url: string;
	bytes?: number | null;
	mimeType?: string | null;
}

/** One item as read from the network, kept as the item's payload until it is posted. */
export interface FetchedItem {
	itemId: string;
	url: string | null;
	postedAt: number | null;
	title?: string | null;
	text: string;
	images: FetchedImage[];
	link: { url: string; title?: string | null; description?: string | null; image?: string | null } | null;
	video: FetchedVideo | null;
	/** Not imported, and why */
	skip?: ImportItemNote;
	/** Waits for its file from the owner, and why */
	awaiting?: ImportItemNote;
}

export interface FetchResult {
	items: FetchedItem[];
	/** The newest point read, for the next fetch (null: unchanged) */
	cursor: string | null;
}

export function itemKind(item: FetchedItem): ImportItemKind | null {
	if (item.video) return 'video';
	if (item.images.length) return 'image';
	if (item.link) return 'link';
	return item.text.trim() ? 'text' : null;
}

// --- text --------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

/** Longest HTML read from one item (a post is far shorter), and the script/style passes over it. */
const HTML_MAX_CHARS = 200_000;
const SCRIPT_PASSES = 5;

/** HTML (a feed's description, a Mastodon status) as plain text: paragraphs and line breaks kept. */
export function htmlToText(html: string): string {
	let text = html.slice(0, HTML_MAX_CHARS).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
	// Repeated, so a block hidden inside another ("<scr<script>…</script>ipt>") goes too; a few passes at most, and
	// whatever still opens a block after them is dropped to the end
	for (let pass = 0, before = ''; before !== text; pass++) {
		if (pass === SCRIPT_PASSES) {
			const open = text.search(/<(script|style)\b/i);
			if (open >= 0) text = text.slice(0, open);
			break;
		}
		before = text;
		text = text.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
	}
	text = text
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n\n')
		.replace(/<[^>]*>/g, '')
		// A stray "<" left over goes too: only escaped ones (&lt;) become text
		.replace(/</g, '');
	return decodeEntities(text)
		.replace(/[ \t\f\v ]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

const toMs = (value: string | null | undefined): number | null => {
	if (!value) return null;
	const t = Date.parse(value);
	return Number.isFinite(t) ? t : null;
};

const safeUrl = (raw: string | null | undefined, base?: string): string | null => {
	if (!raw) return null;
	try {
		return checkUrl(base ? new URL(raw, base).toString() : raw).toString();
	} catch {
		return null;
	}
};

async function getText(url: string, accept: string, max: number, f: typeof fetch): Promise<string> {
	try {
		const res = await safeFetch(url, accept, f);
		return new TextDecoder().decode(await readLimited(res, max, true));
	} catch (error) {
		if (error instanceof PreviewError) throw new SourceError(502, `source_${error.code}`, `The source could not be read (${error.code})`);
		throw error;
	}
}

async function getJson<T>(url: string, f: typeof fetch): Promise<T> {
	const text = await getText(url, 'application/json', JSON_MAX_BYTES, f);
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new SourceError(502, 'source_bad_response', 'The source answered with something that is not JSON');
	}
}

// --- RSS and Atom -----------------------------------------------------------------------------

const tag = (xml: string, name: string): string | null => {
	const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
	return m ? m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim() : null;
};

const attrs = (tagText: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const m of tagText.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]!.toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? '');
	return out;
};

const selfClosing = (xml: string, name: string): Array<Record<string, string>> => [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => attrs(m[0]));

/** Parses an RSS 2.0 or Atom feed (no namespaces needed beyond media: and the podcast enclosure). */
export function parseFeed(xml: string, feedUrl: string): FetchedItem[] {
	const atom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
	const blocks = [...xml.matchAll(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
	const items: FetchedItem[] = [];
	for (const block of blocks) {
		const title = htmlToText(tag(block, 'title') ?? '');
		let link: string | null;
		if (atom) {
			const links = selfClosing(block, 'link');
			link = safeUrl((links.find((l) => !l.rel || l.rel === 'alternate') ?? links[0])?.href, feedUrl);
		} else {
			link = safeUrl(decodeEntities(tag(block, 'link') ?? ''), feedUrl);
		}
		const id = decodeEntities(tag(block, atom ? 'id' : 'guid') ?? '') || link || '';
		if (!id) continue;
		const body = htmlToText(tag(block, 'content:encoded') ?? tag(block, 'content') ?? tag(block, 'description') ?? tag(block, 'summary') ?? '');
		const postedAt = toMs(tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated') ?? tag(block, 'dc:date'));
		// Enclosures (RSS, podcasts), Atom enclosure links and Media RSS
		const media = [
			...selfClosing(block, 'enclosure').map((e) => ({ url: e.url, type: e.type, length: e.length })),
			...selfClosing(block, 'link').filter((l) => l.rel === 'enclosure').map((l) => ({ url: l.href, type: l.type, length: l.length })),
			...selfClosing(block, 'media:content').map((m) => ({ url: m.url, type: m.type ?? (m.medium === 'video' ? 'video/mp4' : m.medium === 'image' ? 'image/jpeg' : ''), length: m.filesize })),
		].filter((m) => !!m.url);
		const videoEnc = media.find((m) => (m.type ?? '').startsWith('video/'));
		const images = media.filter((m) => (m.type ?? '').startsWith('image/')).map((m) => safeUrl(m.url, feedUrl)).filter((u): u is string => !!u);
		const thumb = safeUrl(selfClosing(block, 'media:thumbnail')[0]?.url, feedUrl);
		const videoUrl = videoEnc ? safeUrl(videoEnc.url, feedUrl) : null;
		const bytes = videoEnc?.length ? Number(videoEnc.length) || null : null;
		const text = [title, body].filter(Boolean).join('\n\n').slice(0, 5000);
		const item: FetchedItem = {
			itemId: id.slice(0, 500),
			url: link,
			postedAt,
			title: title || null,
			text,
			images: videoUrl ? [] : [...new Set(images)].slice(0, 10).map((url) => ({ url })),
			link: !videoUrl && !images.length && link ? { url: link, title: title || null, description: body ? body.slice(0, 300) : null, image: thumb } : null,
			video: videoUrl ? { url: videoUrl, bytes, mimeType: videoEnc!.type ?? null } : null,
		};
		if (item.video?.bytes && item.video.bytes > IMPORT_MAX_VIDEO_BYTES) item.awaiting = 'too_large';
		if (!itemKind(item)) item.skip = 'empty';
		items.push(item);
	}
	return items.sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0)).slice(0, FETCH_LIMIT);
}

async function fetchRss(address: string, f: typeof fetch): Promise<FetchResult> {
	const xml = await getText(address, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8', FEED_MAX_BYTES, f);
	if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new SourceError(502, 'source_not_a_feed', 'The address is not an RSS or Atom feed');
	const items = parseFeed(xml, address);
	return { items, cursor: items[0]?.postedAt ? String(items[0].postedAt) : null };
}

// --- Bluesky ------------------------------------------------------------------------------------

interface BskyImage {
	fullsize?: string;
	alt?: string;
}
interface BskyEmbedView {
	$type?: string;
	images?: BskyImage[];
	external?: { uri?: string; title?: string; description?: string; thumb?: string };
	cid?: string;
	playlist?: string;
	media?: BskyEmbedView;
}
interface BskyFeedItem {
	post: { uri: string; cid: string; author: { did: string; handle: string }; record: { text?: string; createdAt?: string; embed?: { video?: { ref?: { $link?: string }; size?: number; mimeType?: string }; media?: { video?: { ref?: { $link?: string }; size?: number; mimeType?: string } } } }; embed?: BskyEmbedView; indexedAt?: string };
	reason?: { $type?: string };
	reply?: unknown;
}

/** The account's server, from its DID document (video blobs are read there). */
async function blueskyPds(did: string, f: typeof fetch): Promise<string | null> {
	try {
		const doc = did.startsWith('did:plc:')
			? await getJson<{ service?: Array<{ id: string; serviceEndpoint: string }> }>(`https://plc.directory/${encodeURIComponent(did)}`, f)
			: await getJson<{ service?: Array<{ id: string; serviceEndpoint: string }> }>(`https://${did.slice(8)}/.well-known/did.json`, f);
		const s = (doc.service ?? []).find((x) => x.id.endsWith('#atproto_pds'));
		return s ? safeUrl(s.serviceEndpoint)?.replace(/\/$/, '') ?? null : null;
	} catch {
		return null;
	}
}

/** A handle as its DID (the stored address is the DID, so a renamed handle keeps importing). */
export async function resolveBlueskyAddress(address: string, f: typeof fetch = fetch): Promise<string> {
	if (address.startsWith('did:')) return address;
	const out = await getJson<{ did?: string }>(`${BSKY_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(address)}`, f);
	if (!out.did) throw new SourceError(422, 'source_not_found', 'No Bluesky account has that handle');
	return out.did;
}

export function blueskyPostUrl(handle: string, uri: string): string {
	return `https://bsky.app/profile/${handle}/post/${uri.split('/').pop()}`;
}

async function fetchBluesky(address: string, cursor: string | null, f: typeof fetch): Promise<FetchResult> {
	const did = await resolveBlueskyAddress(address, f);
	const feed = await getJson<{ feed?: BskyFeedItem[] }>(`${BSKY_RESOLVER}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}&filter=posts_no_replies&limit=${FETCH_LIMIT}`, f);
	const since = cursor ? Number(cursor) : 0;
	let pds: string | null | undefined;
	const items: FetchedItem[] = [];
	for (const entry of feed.feed ?? []) {
		const p = entry.post;
		const postedAt = toMs(p.record?.createdAt) ?? toMs(p.indexedAt);
		if (since && postedAt && postedAt <= since) continue;
		const item: FetchedItem = { itemId: p.uri, url: blueskyPostUrl(p.author.handle, p.uri), postedAt, text: (p.record?.text ?? '').slice(0, 5000), images: [], link: null, video: null };
		// Reposts are someone else's post; replies are left out by the filter
		if (entry.reason?.$type?.includes('reasonRepost') || p.author.did !== did) {
			item.skip = 'reply_or_repost';
			items.push(item);
			continue;
		}
		const view = p.embed?.media ?? p.embed;
		// Every URL from the network is checked like a feed's (public http(s) only), never trusted as given
		if (view?.images?.length) item.images = view.images.map((i) => ({ url: safeUrl(i.fullsize), alt: i.alt ?? null })).filter((i): i is { url: string; alt: string | null } => !!i.url).slice(0, 10);
		const external = safeUrl(view?.external?.uri);
		if (external) item.link = { url: external, title: view!.external!.title ?? null, description: view!.external!.description ?? null, image: safeUrl(view!.external!.thumb) };
		const blob = p.record?.embed?.video ?? p.record?.embed?.media?.video;
		if (blob?.ref?.$link) {
			if (pds === undefined) pds = await blueskyPds(did, f);
			if (pds) item.video = { url: `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(blob.ref.$link)}`, bytes: blob.size ?? null, mimeType: blob.mimeType ?? 'video/mp4' };
			else item.skip = 'media_unavailable';
		}
		if (item.video) item.link = null;
		if (!item.skip && !itemKind(item)) item.skip = 'empty';
		items.push(item);
	}
	const newest = items.reduce((m, i) => Math.max(m, i.postedAt ?? 0), since);
	return { items, cursor: newest ? String(newest) : null };
}

// --- Mastodon -----------------------------------------------------------------------------------

interface MastoStatus {
	id: string;
	url?: string;
	uri?: string;
	created_at?: string;
	content?: string;
	spoiler_text?: string;
	in_reply_to_id?: string | null;
	reblog?: unknown;
	visibility?: string;
	media_attachments?: Array<{ type: string; url?: string; remote_url?: string | null; description?: string | null; meta?: { original?: { size?: string } } }>;
	card?: { url?: string; title?: string; description?: string; image?: string | null } | null;
}

async function fetchMastodon(address: string, cursor: string | null, f: typeof fetch): Promise<FetchResult> {
	const [user, instance] = address.split('@');
	const origin = safeUrl(`https://${instance}`);
	if (!user || !origin) throw new SourceError(400, 'invalid_address');
	const base = origin.replace(/\/$/, '');
	const account = await getJson<{ id?: string }>(`${base}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`, f);
	if (!account.id) throw new SourceError(422, 'source_not_found', 'No account with that name on that server');
	const statuses = await getJson<MastoStatus[]>(
		`${base}/api/v1/accounts/${encodeURIComponent(account.id)}/statuses?exclude_replies=true&exclude_reblogs=true&limit=40${cursor ? `&since_id=${encodeURIComponent(cursor)}` : ''}`,
		f,
	);
	const items: FetchedItem[] = [];
	for (const s of Array.isArray(statuses) ? statuses : []) {
		const text = [s.spoiler_text ? htmlToText(s.spoiler_text) : '', htmlToText(s.content ?? '')].filter(Boolean).join('\n\n').slice(0, 5000);
		const item: FetchedItem = { itemId: s.id, url: safeUrl(s.url ?? s.uri ?? null), postedAt: toMs(s.created_at), text, images: [], link: null, video: null };
		// Only what everyone may see: public and unlisted posts
		if (s.reblog || s.in_reply_to_id || (s.visibility && !['public', 'unlisted'].includes(s.visibility))) {
			item.skip = 'reply_or_repost';
			items.push(item);
			continue;
		}
		const media = s.media_attachments ?? [];
		const video = media.find((m) => m.type === 'video' || m.type === 'gifv');
		const videoUrl = safeUrl(video?.url);
		if (videoUrl) item.video = { url: videoUrl, bytes: null, mimeType: 'video/mp4' };
		else {
			item.images = media.filter((m) => m.type === 'image').map((m) => ({ url: safeUrl(m.url), alt: m.description ?? null })).filter((i): i is { url: string; alt: string | null } => !!i.url).slice(0, 10);
			const card = safeUrl(s.card?.url);
			if (!item.images.length && card) item.link = { url: card, title: s.card!.title ?? null, description: s.card!.description ?? null, image: safeUrl(s.card!.image) };
		}
		if (media.some((m) => m.type === 'audio' || m.type === 'unknown') && !itemKind(item)) item.skip = 'unsupported_media';
		if (!item.skip && !itemKind(item)) item.skip = 'empty';
		items.push(item);
	}
	// Status ids grow with time: the largest is the newest
	const newest = items.map((i) => i.itemId).sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0)).pop() ?? null;
	return { items, cursor: newest };
}

// --- YouTube ------------------------------------------------------------------------------------

async function fetchYoutube(address: string, f: typeof fetch): Promise<FetchResult> {
	const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(address)}`, 'application/atom+xml', FEED_MAX_BYTES, f);
	const items: FetchedItem[] = [];
	for (const block of [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0])) {
		const videoId = tag(block, 'yt:videoId');
		if (!videoId) continue;
		items.push({
			itemId: videoId,
			url: `https://www.youtube.com/watch?v=${videoId}`,
			postedAt: toMs(tag(block, 'published')),
			title: htmlToText(tag(block, 'title') ?? ''),
			text: htmlToText(tag(block, 'media:description') ?? ''),
			images: [],
			link: null,
			video: null,
			// YouTube's terms forbid downloading: the file comes from the owner's Takeout export (TA-13)
			awaiting: 'takeout_file',
		});
	}
	return { items, cursor: null };
}

/** Reads the source's new items. Telegram items come by webhook, so it has nothing to fetch. */
export async function fetchSource(network: ImportSourceNetwork, address: string, cursor: string | null, f: typeof fetch = fetch): Promise<FetchResult> {
	switch (network) {
		case 'rss':
			return fetchRss(address, f);
		case 'bluesky':
			return fetchBluesky(address, cursor, f);
		case 'mastodon':
			return fetchMastodon(address, cursor, f);
		case 'youtube':
			return fetchYoutube(address, f);
		case 'telegram':
			return { items: [], cursor: null };
	}
}
