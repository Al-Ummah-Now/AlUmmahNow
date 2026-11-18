/**
 * Planning and delivering (spec §7.3, §7.4). An event (new video, Short, live, post) becomes one delivery per
 * matching rule and one per subscribed webhook, each a queue message. The processor calls attemptPost /
 * attemptWebhook once per delivery attempt and retries with backoff; the last failure flags the admin.
 *
 * Rules applied at send time, never at plan time: the content must still be public, the account active, the
 * network and the platform switched on, and an X post must fit the month's cap.
 */
import {
	MessageType,
	SOCIAL_NETWORK_RULES,
	X_LINK_POST_COST_MICROS,
	composePostText,
	signWebhook,
	webhookEventFor,
	xPostCostMicros,
	type SocialAttemptResult,
	type SocialDeliveryPayload,
	type SocialEvent,
	type SocialNetwork,
	type SocialWebhookEvent,
	type SocialWebhookPayload,
} from '@al-ummah/shared-types';
import { openJson, openText, sealJson } from './crypto';
import {
	changes,
	claimDelivery,
	finishDelivery,
	insertDeliveries,
	listRules,
	listTemplates,
	readAccount,
	readPlatformSettings,
	readWebhook,
	releaseSpend,
	reserveSpend,
	setAccountStatus,
	socialDb,
	takeRefreshLease,
	updateAccountTokens,
	type AccountRow,
	type DeliveryRow,
	type WebhookDeliveryRow,
} from './store';
import { loadSocialContent, webhookData, type SocialContent } from './content';
import { blueskyClient, readCredentials, type SocialEnv } from './platform';
import { tokenBound } from './connect';
import { mediaSize, NetworkError, type Adapter, type PostRequest, type TokenSet } from './adapters/types';
import { xAdapter, xRefresh } from './adapters/x';
import { telegramAdapter } from './adapters/telegram';
import { blueskyAdapter, blueskyRefresh } from './adapters/bluesky';
import { mastodonAdapter } from './adapters/mastodon';
import { logger } from '../logger';

async function enqueue(env: SocialEnv, payload: SocialDeliveryPayload, delaySeconds?: number): Promise<void> {
	if (!env.queue) throw new Error('queue not bound');
	await env.queue.send({ id: crypto.randomUUID(), type: MessageType.SocialDelivery, payload, timestamp: Date.now() }, delaySeconds ? { delaySeconds } : undefined);
}

export async function enqueueDelivery(env: SocialEnv, kind: 'post' | 'webhook', deliveryId: string, delaySeconds?: number): Promise<void> {
	await enqueue(env, { kind, deliveryId }, delaySeconds);
}

/** Plans an event's deliveries and queues them. Idempotent: a repeated event plans nothing new. */
export async function planEvent(env: SocialEnv, channelId: string, event: SocialEvent, entityId: string, now = Date.now()): Promise<{ posts: number; webhooks: number }> {
	const db = socialDb(env);
	const { results: accounts } = await db.prepare(`SELECT * FROM social_accounts WHERE channel_id = ? AND status = 'active'`).bind(channelId).all<AccountRow>();
	const { results: hooks } = await db.prepare('SELECT id, events FROM social_webhooks WHERE channel_id = ? AND enabled = 1').bind(channelId).all<{ id: string; events: string }>();
	const hookEvent = webhookEventFor(event);
	const wantedHooks = (hooks ?? []).filter((h) => h.events.split(',').includes(hookEvent));
	const rules = (await listRules(env, (accounts ?? []).map((a) => a.id))).filter((r) => r.event === event && r.enabled);
	if (!rules.length && !wantedHooks.length) return { posts: 0, webhooks: 0 };

	// Nothing is planned for content that isn't public (a private upload, a members-only post)
	const content = await loadSocialContent(env, channelId, event, entityId);
	if (!content) return { posts: 0, webhooks: 0 };

	const postIds = await insertDeliveries(
		env,
		rules.map((r) => {
			const a = accounts!.find((x) => x.id === r.account_id)!;
			return { channel_id: channelId, account_id: a.id, network: a.network, event, entity_id: entityId, entity_title: content.title.en.slice(0, 200), format: r.format, include_link: r.include_link };
		}),
		now,
	);
	const hookIds: string[] = [];
	for (const h of wantedHooks) {
		const id = `wd_${crypto.randomUUID().replace(/-/g, '')}`;
		const r = await db
			.prepare(
				`INSERT INTO social_webhook_deliveries (id, webhook_id, channel_id, event, entity_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
				 ON CONFLICT (webhook_id, event, entity_id) DO NOTHING`,
			)
			.bind(id, h.id, channelId, hookEvent, entityId, now, now)
			.run();
		if (changes(r)) hookIds.push(id);
	}
	for (const id of postIds) await enqueueDelivery(env, 'post', id);
	for (const id of hookIds) await enqueueDelivery(env, 'webhook', id);
	return { posts: postIds.length, webhooks: hookIds.length };
}

// --- composing -----------------------------------------------------------------------------------

export interface ComposedPost {
	request: PostRequest;
	/** X: whether the text carries a URL (billed at the link price) */
	hasUrl: boolean;
}

/** The text and media of one delivery. Pure apart from the media size lookup. */
export async function composePost(
	content: SocialContent,
	delivery: Pick<DeliveryRow, 'id' | 'network' | 'format' | 'include_link' | 'event'>,
	language: 'en' | 'ar',
	templateBody: string,
	sizeOf: (url: string) => Promise<number | null>,
): Promise<ComposedPost> {
	const rules = SOCIAL_NETWORK_RULES[delivery.network];
	const url = content.url[language];
	const asVideo = delivery.format === 'video' && (delivery.event === 'video' || delivery.event === 'short');
	// The same composition Studio previews (shared-types composePostText)
	const { text } = composePostText({
		template: templateBody,
		values: { title: content.title[language], channel: content.channel.name[language], url, text: content.text ?? '' },
		network: delivery.network,
		event: delivery.event,
		format: delivery.format,
		includeLink: !!delivery.include_link,
	});

	let video: PostRequest['video'];
	if (asVideo) {
		if (!content.video) throw new NetworkError('video_not_available: the video has no downloadable file yet', 'fatal');
		const seconds = content.video.durationSeconds;
		if (seconds && seconds > rules.maxVideoSeconds) {
			throw new NetworkError(`video_too_long: ${Math.round(seconds / 60)} min; ${delivery.network} takes up to ${Math.round(rules.maxVideoSeconds / 60)} min. Switch this post to a link post`, 'fatal');
		}
		const bytes = (await sizeOf(content.video.url)) ?? undefined;
		if (bytes && bytes > rules.maxVideoBytes) {
			throw new NetworkError(`video_too_large: ${Math.round(bytes / 1048576)} MB; ${delivery.network} takes up to ${Math.round(rules.maxVideoBytes / 1048576)} MB. Switch this post to a link post`, 'fatal');
		}
		video = { url: content.video.url, bytes, durationSeconds: seconds, width: content.video.width, height: content.video.height };
	}
	const hasUrl = /https?:\/\//.test(text);
	return {
		hasUrl,
		request: {
			text,
			lang: language,
			...(text.includes(url) ? { link: url } : {}),
			card: { title: content.title[language], description: content.channel.name[language], ...(content.thumbnailUrl ? { imageUrl: content.thumbnailUrl } : {}) },
			...(video ? { video } : {}),
			idempotencyKey: delivery.id,
		},
	};
}

// --- tokens --------------------------------------------------------------------------------------

/** The account's tokens, refreshed first when under a tenth of their life (or two minutes) is left. */
async function freshTokens(env: SocialEnv, account: AccountRow, f: typeof fetch): Promise<TokenSet> {
	if (account.network === 'telegram') return { chatId: account.remote_id };
	if (!account.token_ciphertext) throw new NetworkError('not connected', 'auth');
	const tokens = await openJson<TokenSet>(env, account.token_ciphertext, tokenBound(account.id));
	const expires = account.token_expires_at ?? tokens.expiresAt ?? null;
	if (!expires || expires - Date.now() > 2 * 60_000) return tokens;
	if (!(await takeRefreshLease(env, account.id))) throw new NetworkError('token refresh in progress', 'retry', 15);
	let next: TokenSet;
	if (account.network === 'x') {
		const creds = await readCredentials(env, 'x');
		if (!creds) throw new NetworkError('network_not_configured', 'fatal');
		next = { ...tokens, ...(await xRefresh(f, creds, tokens.refreshToken ?? '')) };
	} else if (account.network === 'bluesky') {
		next = await blueskyRefresh(f, await blueskyClient(env), tokens);
	} else {
		return tokens;
	}
	// Saved before use: the old refresh token is spent
	await updateAccountTokens(env, account.id, await sealJson(env, next, tokenBound(account.id)), next.expiresAt ?? null);
	return next;
}

async function adapterFor(env: SocialEnv, network: SocialNetwork): Promise<Adapter> {
	switch (network) {
		case 'x':
			return xAdapter;
		case 'bluesky':
			return blueskyAdapter;
		case 'mastodon':
			return mastodonAdapter;
		case 'telegram': {
			const creds = await readCredentials(env, 'telegram');
			if (!creds?.botToken) throw new NetworkError('network_not_configured', 'fatal');
			return telegramAdapter(creds);
		}
	}
}

// --- attempts ------------------------------------------------------------------------------------

const short = (s: string) => s.slice(0, 500);

/** One attempt at one post. */
export async function attemptPost(env: SocialEnv, deliveryId: string, f: typeof fetch = fetch): Promise<SocialAttemptResult> {
	const d = await claimDelivery(env, deliveryId);
	if (!d) return { outcome: 'skipped' };
	const account = await readAccount(env, d.account_id);
	if (!account || account.status !== 'active') {
		const error = account ? `account_${account.status}` : 'account_disconnected';
		await finishDelivery(env, d.id, { status: account ? 'failed' : 'cancelled', error });
		return account ? { outcome: 'failed', error } : { outcome: 'skipped' };
	}
	const settings = await readPlatformSettings(env);
	if (!settings.enabled || !settings.networks[d.network]?.enabled) {
		await finishDelivery(env, d.id, { status: 'blocked', error: 'paused_by_admin' });
		return { outcome: 'blocked', error: 'paused_by_admin' };
	}
	const content = await loadSocialContent(env, d.channel_id, d.event, d.entity_id);
	if (!content) {
		await finishDelivery(env, d.id, { status: 'cancelled', error: 'no_longer_public' });
		return { outcome: 'skipped' };
	}

	let reserved = 0;
	try {
		const templates = await listTemplates(env, d.channel_id);
		const lang = account.language === 'ar' ? 'ar' : 'en';
		const template = templates.find((t) => t.event === d.event && t.lang === lang)!.body;
		const composed = await composePost(content, d, lang, template, (u) => mediaSize(f, u));

		if (d.network === 'x') {
			if (!(await readCredentials(env, 'x'))) throw new NetworkError('network_not_configured', 'fatal');
			const cost = xPostCostMicros(composed.hasUrl);
			const cap = Math.round(settings.xMonthlyCapUsd * 1_000_000);
			const limit = cost >= X_LINK_POST_COST_MICROS ? Math.floor(cap * 0.9) : cap;
			if (!(await reserveSpend(env, 'x', cost, cap, limit))) {
				await finishDelivery(env, d.id, { status: 'blocked', error: 'x_budget_reached' });
				return { outcome: 'blocked', error: 'x_budget_reached', flagAdmin: true };
			}
			reserved = cost;
		}

		const tokens = await freshTokens(env, account, f);
		const adapter = await adapterFor(env, d.network);
		const result = await adapter.publish(
			{
				fetch: f,
				account: { id: account.id, network: account.network, remoteId: account.remote_id, handle: account.handle, instance: account.instance },
				tokens,
				saveTokens: async (t) => updateAccountTokens(env, account.id, await sealJson(env, t, tokenBound(account.id)), t.expiresAt ?? null),
			},
			composed.request,
		);
		await finishDelivery(env, d.id, { status: 'sent', error: null, remoteId: result.remoteId, remoteUrl: result.url ?? null, costMicros: reserved });
		return { outcome: 'sent' };
	} catch (error) {
		if (reserved) await releaseSpend(env, 'x', reserved).catch(() => undefined);
		const message = short(error instanceof Error ? error.message : String(error));
		if (error instanceof NetworkError) {
			if (error.kind === 'auth') {
				await setAccountStatus(env, account.id, 'needs_reconnect', message);
				await finishDelivery(env, d.id, { status: 'failed', error: `reconnect_needed: ${message}` });
				return { outcome: 'failed', error: `reconnect_needed: ${message}` };
			}
			if (error.kind === 'retry') {
				await finishDelivery(env, d.id, { status: 'failed', error: message });
				return { outcome: 'retry', error: message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) };
			}
			await finishDelivery(env, d.id, { status: 'failed', error: message });
			return { outcome: 'failed', error: message, ...(message.startsWith('network_not_configured') ? { flagAdmin: true } : {}) };
		}
		logger.error('[Social] Post attempt crashed', { deliveryId, network: d.network, error: message });
		await finishDelivery(env, d.id, { status: 'failed', error: 'internal_error' });
		return { outcome: 'retry', error: 'internal_error' };
	}
}

/** The last attempt gave up: the delivery stays failed with its reason (Studio shows it with Retry). */
export async function giveUpPost(env: SocialEnv, deliveryId: string, error: string): Promise<DeliveryRow | null> {
	await socialDb(env).prepare(`UPDATE social_deliveries SET status = 'failed', last_error = COALESCE(last_error, ?), updated_at = ? WHERE id = ? AND status != 'sent'`).bind(short(error), Date.now(), deliveryId).run();
	return socialDb(env).prepare('SELECT * FROM social_deliveries WHERE id = ?').bind(deliveryId).first<DeliveryRow>();
}

// --- webhooks ------------------------------------------------------------------------------------

export const webhookSecretBound = (webhookId: string) => `webhook:${webhookId}:secret`;
const WEBHOOK_TIMEOUT_MS = 10_000;

export async function buildWebhookPayload(env: SocialEnv, row: Pick<WebhookDeliveryRow, 'id' | 'channel_id' | 'event' | 'entity_id'>): Promise<SocialWebhookPayload | null> {
	const createdAt = new Date().toISOString();
	if (row.event === 'ping') {
		const channel = await new (await import('../r2Repo')).default<{ name?: string; handle?: string }>(env.channels).getObject(row.channel_id);
		const origin = (env.VIDEOS_WEB_URL || 'https://videos.alummahnow.net').replace(/\/+$/, '');
		return {
			id: row.id,
			event: 'ping',
			createdAt,
			channel: { id: row.channel_id, name: channel?.name ?? '', ...(channel?.handle ? { handle: channel.handle } : {}), url: channel?.handle ? `${origin}/en/@${channel.handle}` : `${origin}/en/channels/${row.channel_id}` },
		};
	}
	const kind = ({ 'video.published': 'video', 'short.published': 'short', 'live.started': 'live', 'post.published': 'post' } as const)[row.event as Exclude<SocialWebhookEvent, 'ping'>];
	const content = await loadSocialContent(env, row.channel_id, kind, row.entity_id);
	if (!content) return null;
	return {
		id: row.id,
		event: row.event,
		createdAt,
		channel: { id: content.channel.id, name: content.channel.name.en, ...(content.channel.handle ? { handle: content.channel.handle } : {}), url: content.channel.url },
		data: webhookData(content),
	};
}

export async function attemptWebhook(env: SocialEnv, deliveryId: string, f: typeof fetch = fetch): Promise<SocialAttemptResult> {
	const db = socialDb(env);
	const now = Date.now();
	const claimed = await db
		.prepare(`UPDATE social_webhook_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND (status IN ('queued', 'failed') OR (status = 'sending' AND updated_at < ?))`)
		.bind(now, deliveryId, now - 15 * 60_000)
		.run();
	if (!changes(claimed)) return { outcome: 'skipped' };
	const row = (await db.prepare('SELECT * FROM social_webhook_deliveries WHERE id = ?').bind(deliveryId).first<WebhookDeliveryRow>())!;
	const hook = await readWebhook(env, row.webhook_id);
	const finish = async (status: 'sent' | 'failed', responseStatus: number | null, error: string | null) => {
		await db.prepare('UPDATE social_webhook_deliveries SET status = ?, response_status = ?, last_error = ?, updated_at = ? WHERE id = ?').bind(status, responseStatus, error, Date.now(), deliveryId).run();
		if (hook) {
			await db
				.prepare(`UPDATE social_webhooks SET last_status = ?, last_delivery_at = ?, failure_count = CASE WHEN ? = 'sent' THEN 0 ELSE failure_count + 1 END, updated_at = ? WHERE id = ?`)
				.bind(status === 'sent' ? `${responseStatus}` : error ?? 'failed', Date.now(), status, Date.now(), hook.id)
				.run();
		}
	};
	if (!hook || (!hook.enabled && row.event !== 'ping')) {
		await finish('failed', null, 'webhook_disabled');
		return { outcome: 'skipped' };
	}
	const payload = await buildWebhookPayload(env, row);
	if (!payload) {
		await finish('failed', null, 'no_longer_public');
		return { outcome: 'skipped' };
	}
	const body = JSON.stringify(payload);
	const secret = await openText(env, hook.secret_ciphertext, webhookSecretBound(hook.id));
	const signature = await signWebhook(secret, body, Math.floor(Date.now() / 1000));
	let res: Response;
	try {
		res = await f(hook.url, {
			method: 'POST',
			redirect: 'manual',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'AlUmmahNow-Webhooks/1.0',
				'X-AUN-Event': payload.event,
				'X-AUN-Delivery': row.id,
				'X-AUN-Signature': signature,
			},
			body,
			signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
		});
		await res.body?.cancel();
	} catch (error) {
		const message = short(`request failed: ${error instanceof Error ? error.message : String(error)}`);
		await finish('failed', null, message);
		return { outcome: 'retry', error: message };
	}
	if (res.status >= 200 && res.status < 300) {
		await finish('sent', res.status, null);
		return { outcome: 'sent' };
	}
	const error = `HTTP ${res.status}`;
	await finish('failed', res.status, error);
	// 410 Gone: the receiver says this hook is gone for good (Zapier does this when a Zap is deleted)
	if (res.status === 410) {
		await db.prepare('UPDATE social_webhooks SET enabled = 0, last_status = ?, updated_at = ? WHERE id = ?').bind('disabled: 410 Gone', Date.now(), hook.id).run();
		return { outcome: 'failed', error };
	}
	if (res.status === 408 || res.status === 429 || res.status >= 500) {
		const ra = Number(res.headers.get('retry-after'));
		return { outcome: 'retry', error, ...(Number.isFinite(ra) && ra > 0 ? { retryAfterSeconds: Math.min(3600, ra) } : {}) };
	}
	return { outcome: 'failed', error };
}

export async function giveUpWebhook(env: SocialEnv, deliveryId: string, error: string): Promise<WebhookDeliveryRow | null> {
	const db = socialDb(env);
	await db.prepare(`UPDATE social_webhook_deliveries SET status = 'failed', last_error = COALESCE(last_error, ?), updated_at = ? WHERE id = ? AND status != 'sent'`).bind(short(error), Date.now(), deliveryId).run();
	return db.prepare('SELECT * FROM social_webhook_deliveries WHERE id = ?').bind(deliveryId).first<WebhookDeliveryRow>();
}

export async function requeueWebhookDelivery(env: SocialEnv, deliveryId: string): Promise<boolean> {
	const r = await socialDb(env)
		.prepare(`UPDATE social_webhook_deliveries SET status = 'queued', attempts = 0, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'failed'`)
		.bind(Date.now(), deliveryId)
		.run();
	return changes(r) > 0;
}
