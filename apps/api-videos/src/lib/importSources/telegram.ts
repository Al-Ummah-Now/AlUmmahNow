/**
 * Telegram import (wiki TOOLS-ADMIN TA-9): the bot SOC-1 connected to the owner's channel receives its
 * posts by webhook (lib/social/connect.ts handleTelegramUpdate). A channel post of a chat with an
 * enabled source is recorded here as a pending item and a sync job posts it. Files are named by
 * Telegram file id (`tg-file:<id>`), never by their download URL, which carries the bot token; they are
 * resolved with getFile when posted. The Bot API downloads at most 20 MB, so a bigger video waits for
 * the owner to drop the file into the app.
 */
import type { ImportItemNote } from '@al-ummah/shared-types';
import { readCredentials, type SocialEnv } from '../social/platform';
import { tgCall, TELEGRAM_API } from '../social/adapters/telegram';
import { changes, sourceDb, sourcesFor, type SourceDbEnv } from './store';
import type { FetchedItem } from './fetchers';
import { itemKind } from './fetchers';

/** The Bot API's download limit. */
export const TELEGRAM_BOT_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const TG_FILE = 'tg-file:';

export interface TgChannelPost {
	message_id: number;
	date?: number;
	chat: { id: number; type: string; username?: string };
	text?: string;
	caption?: string;
	media_group_id?: string;
	photo?: Array<{ file_id: string; width: number; height: number; file_size?: number }>;
	video?: { file_id: string; file_size?: number; mime_type?: string };
	animation?: { file_id: string; file_size?: number; mime_type?: string };
	document?: { file_id: string; file_size?: number; mime_type?: string };
	audio?: unknown;
	voice?: unknown;
	sticker?: unknown;
	poll?: unknown;
	entities?: Array<{ type: string; url?: string; offset: number; length: number }>;
}

/** A channel post as an item (an album's posts share one item, named by the album). */
export function telegramItem(post: TgChannelPost): FetchedItem {
	const itemId = post.media_group_id ? `album:${post.media_group_id}` : String(post.message_id);
	const url = post.chat.username ? `https://t.me/${post.chat.username}/${post.message_id}` : null;
	const item: FetchedItem = { itemId, url, postedAt: post.date ? post.date * 1000 : null, text: (post.text ?? post.caption ?? '').slice(0, 5000), images: [], link: null, video: null };
	const largest = (post.photo ?? []).slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
	const video = post.video ?? post.animation ?? (post.document?.mime_type?.startsWith('video/') ? post.document : undefined);
	if (largest) item.images = [{ url: `${TG_FILE}${largest.file_id}` }];
	else if (post.document?.mime_type?.startsWith('image/')) item.images = [{ url: `${TG_FILE}${post.document.file_id}` }];
	if (video) {
		item.images = [];
		item.video = { url: `${TG_FILE}${video.file_id}`, bytes: video.file_size ?? null, mimeType: video.mime_type ?? 'video/mp4' };
		if ((video.file_size ?? 0) > TELEGRAM_BOT_DOWNLOAD_BYTES) item.awaiting = 'too_large_for_bot_api';
	}
	// A link in the text with nothing else: a link post
	const textLink = post.entities?.find((e) => e.type === 'text_link' && e.url)?.url;
	const bare = post.entities?.find((e) => e.type === 'url');
	const linked = textLink ?? (bare ? (post.text ?? post.caption ?? '').slice(bare.offset, bare.offset + bare.length) : null);
	// (Telegram's offsets count UTF-16 units, as JavaScript strings do)
	if (!item.video && !item.images.length && linked && /^https?:\/\//.test(linked)) item.link = { url: linked };
	if (!itemKind(item)) item.skip = (post.audio || post.voice || post.sticker || post.poll ? 'unsupported_media' : 'empty') as ImportItemNote;
	return item;
}

/**
 * Records a channel post for every enabled source reading that chat; returns the sources that got a
 * new pending item (the caller queues their sync). An album's later photos join its pending item.
 */
export async function recordTelegramPost(env: SourceDbEnv, post: TgChannelPost, now = Date.now()): Promise<string[]> {
	const sources = await sourcesFor(env, 'telegram', String(post.chat.id));
	if (!sources.length) return [];
	const item = telegramItem(post);
	const db = sourceDb(env);
	const queued: string[] = [];
	for (const source of sources) {
		const state = item.skip ? 'skipped' : item.awaiting ? 'awaiting_file' : 'pending';
		const inserted = await db
			.prepare(
				`INSERT INTO import_source_items (source_id, item_id, kind, state, payload, original_url, original_at, note, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (source_id, item_id) DO NOTHING`,
			)
			.bind(source.id, item.itemId, itemKind(item), state, state === 'pending' ? JSON.stringify(item) : null, item.url, item.postedAt, item.skip ?? item.awaiting ?? null, now, now)
			.run();
		if (changes(inserted)) {
			if (state === 'pending') queued.push(source.id);
			continue;
		}
		// Another photo of an album still waiting to be posted
		if (post.media_group_id && item.images.length) {
			const row = await db.prepare(`SELECT payload FROM import_source_items WHERE source_id = ? AND item_id = ? AND state = 'pending'`).bind(source.id, item.itemId).first<{ payload: string | null }>();
			if (row?.payload) {
				const current = JSON.parse(row.payload) as FetchedItem;
				const images = [...current.images, ...item.images.filter((i) => !current.images.some((c) => c.url === i.url))].slice(0, 10);
				const merged: FetchedItem = { ...current, images, text: current.text || item.text };
				await db.prepare('UPDATE import_source_items SET payload = ?, kind = ?, updated_at = ? WHERE source_id = ? AND item_id = ?').bind(JSON.stringify(merged), itemKind(merged), now, source.id, item.itemId).run();
			}
		}
	}
	return queued;
}

/** The download URL of a Telegram file (holds the bot token: used at once, never stored or logged). */
export async function telegramFileUrl(env: SocialEnv, fileId: string, f: typeof fetch = fetch): Promise<{ url: string; bytes: number | null } | null> {
	const creds = await readCredentials(env, 'telegram');
	if (!creds?.botToken) return null;
	const file = await tgCall<{ file_path?: string; file_size?: number }>(f, creds.botToken, 'getFile', { file_id: fileId });
	if (!file.file_path) return null;
	return { url: `${TELEGRAM_API}/file/bot${creds.botToken}/${file.file_path}`, bytes: file.file_size ?? null };
}
