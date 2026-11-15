/**
 * Telegram (spec §5.4, §6.3): the platform's bot posts to channels and groups that added it as an admin. No
 * OAuth: a channel connects by posting a one-time code in its Telegram channel (connect.ts). Videos up to 50 MB
 * go as native video (the cloud Bot API's upload limit); a link post gets Telegram's large link preview.
 */
import { SOCIAL_NETWORK_RULES } from '@al-ummah/shared-types';
import { call, download, NetworkError, type Adapter, type PostResult } from './types';

export const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramCredentials {
	botToken: string;
	/** @username of the bot, without @ (from getMe) */
	botUsername?: string;
}

interface TgResponse<T> {
	ok: boolean;
	result?: T;
	error_code?: number;
	description?: string;
	parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export async function tgCall<T>(f: typeof fetch, botToken: string, method: string, body: Record<string, unknown> | FormData): Promise<T> {
	const init: RequestInit =
		body instanceof FormData ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
	const res = await call(f, `${TELEGRAM_API}/bot${botToken}/${method}`, init, 'Telegram', method);
	let j: TgResponse<T>;
	try {
		j = (await res.json()) as TgResponse<T>;
	} catch {
		throw new NetworkError(`Telegram ${method}: HTTP ${res.status}`, res.status >= 500 ? 'retry' : 'fatal');
	}
	if (j.ok && j.result !== undefined) return j.result;
	const code = j.error_code ?? res.status;
	const message = `Telegram ${method}: ${code} ${j.description ?? ''}`.trim();
	if (code === 429) throw new NetworkError(message, 'retry', j.parameters?.retry_after);
	if (code >= 500) throw new NetworkError(message, 'retry');
	// Bot removed from the chat, or lost the right to post: the connection needs the channel's attention
	if (code === 403 || /not enough rights|chat not found|bot was kicked/i.test(j.description ?? '')) throw new NetworkError(message, 'auth');
	if (code === 401) throw new NetworkError('Telegram: the bot token was refused', 'fatal');
	throw new NetworkError(message, 'fatal');
}

export async function tgGetMe(f: typeof fetch, botToken: string): Promise<{ id: number; username: string }> {
	return tgCall(f, botToken, 'getMe', {});
}

export async function tgSetWebhook(f: typeof fetch, botToken: string, url: string, secret: string): Promise<void> {
	await tgCall(f, botToken, 'setWebhook', { url, secret_token: secret, allowed_updates: ['my_chat_member', 'channel_post', 'message'], drop_pending_updates: true });
}

interface TgMessage {
	message_id: number;
	chat: { id: number; username?: string };
}

export function telegramAdapter(creds: TelegramCredentials): Adapter {
	return {
		network: 'telegram',
		async publish(ctx, post): Promise<PostResult> {
			const chatId = ctx.tokens.chatId || ctx.account.remoteId;
			let msg: TgMessage;
			if (post.video) {
				const rules = SOCIAL_NETWORK_RULES.telegram;
				if (post.video.bytes && post.video.bytes > rules.maxVideoBytes) {
					throw new NetworkError(`the video is ${Math.round(post.video.bytes / 1048576)} MB; Telegram bots can send up to 50 MB`, 'fatal');
				}
				const file = await download(ctx.fetch, post.video.url, rules.maxVideoBytes, 'Telegram');
				const form = new FormData();
				form.append('chat_id', chatId);
				form.append('caption', post.text);
				form.append('supports_streaming', 'true');
				if (post.video.durationSeconds) form.append('duration', String(Math.round(post.video.durationSeconds)));
				if (post.video.width) form.append('width', String(post.video.width));
				if (post.video.height) form.append('height', String(post.video.height));
				form.append('video', new Blob([file.bytes], { type: 'video/mp4' }), 'video.mp4');
				msg = await tgCall<TgMessage>(ctx.fetch, creds.botToken, 'sendVideo', form);
			} else {
				msg = await tgCall<TgMessage>(ctx.fetch, creds.botToken, 'sendMessage', {
					chat_id: chatId,
					text: post.text,
					...(post.link ? { link_preview_options: { url: post.link, prefer_large_media: true, show_above_text: false } } : {}),
				});
			}
			const username = msg.chat.username || ctx.account.handle.replace(/^@/, '');
			return { remoteId: String(msg.message_id), ...(username ? { url: `https://t.me/${username}/${msg.message_id}` } : {}) };
		},
	};
}
