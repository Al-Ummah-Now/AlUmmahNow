/**
 * Social auto-post and scheduler-tool support (wiki AUN-SOCIAL, SOC-1).
 *
 * Studio (signed in; the channel's owner and admins, `channel.edit`; the share kit also for editors, `video.edit`):
 *   GET    /api/social/channel/:channelId                         → SocialOverview
 *   POST   /api/social/channel/:channelId/connect                 { network, language, handle?, instance?, returnLang } → ConnectStartResult
 *   POST   /api/social/channel/:channelId/connect/confirm         { id } (the callback's confirm id; same person, same channel) → { account }
 *   GET    /api/social/channel/:channelId/telegram/:code          → { pending }   (Studio polls while the person posts the code)
 *   PATCH  /api/social/channel/:channelId/accounts/:accountId     { language?, rules? } → { account }
 *   DELETE /api/social/channel/:channelId/accounts/:accountId     → { ok }
 *   PUT    /api/social/channel/:channelId/templates               { templates: SocialTemplate[] } → { templates }
 *   GET    /api/social/channel/:channelId/deliveries              → { deliveries }
 *   POST   /api/social/channel/:channelId/deliveries/:id/retry    { format? } → { ok }
 *   POST   /api/social/channel/:channelId/webhooks                { url, events } → 201 { webhook, secret }   (the secret is shown once)
 *   PATCH  /api/social/channel/:channelId/webhooks/:id            { enabled?, events? } → { webhook }
 *   DELETE /api/social/channel/:channelId/webhooks/:id            → { ok }
 *   POST   /api/social/channel/:channelId/webhooks/:id/test       → { deliveryId }   (a signed "ping")
 *   POST   /api/social/channel/:channelId/webhooks/:id/secret     → { secret }   (rotate)
 *   GET    /api/social/channel/:channelId/webhooks/:id/deliveries → { deliveries }
 *   GET    /api/social/channel/:channelId/share-kit/:videoId[?clip=<shortId>] → ShareKit
 *
 * Public:
 *   GET  /api/social/feeds/:channelId/:kind.xml[?lang=ar]       RSS 2.0 for scheduler tools (lib/social/feed.ts)
 *   GET  /api/social/bluesky/client-metadata.json, /api/social/bluesky/jwks.json   (our AT Protocol OAuth client)
 *   GET  /api/social/oauth/:network/callback                    → 302 to Studio with ?confirm=<id> (nothing linked yet)
 *   POST /api/social/webhooks/telegram                          (X-Telegram-Bot-Api-Secret-Token)
 *
 * Internal (/internal/social, INTERNAL_API_KEY; the processor and admin-api):
 *   POST /events                         SocialEventPayload → { posts, webhooks }
 *   POST /deliveries/:id/attempt         { kind } → SocialAttemptResult
 *   POST /deliveries/:id/give-up         { kind, error } → { channelId, network?, entityId, status }
 *   POST /deliveries/retry               { kind, deliveryId } (the admin Errors page's Retry) → { ok } | 404
 *   GET  /admin                          → SocialAdminOverview
 *   PUT  /admin/settings                 SocialPlatformSettings (X-Admin-Actor) → { settings }
 *   PUT  /admin/credentials/:network     { clientId, clientSecret } | { botToken } → { readiness }
 *   DELETE /admin/credentials/:network   → { readiness }
 *   POST /channels/:channelId/erase      (channel deleted) → { disconnected }
 */
import { Hono, type Context } from 'hono';
import {
	MAX_WEBHOOKS_PER_CHANNEL,
	SOCIAL_EVENTS,
	SOCIAL_FEED_KINDS,
	SOCIAL_LANGUAGES,
	SOCIAL_WEBHOOK_EVENTS,
	can,
	channelNameFields,
	formatsFor,
	isShort,
	isSocialNetwork,
	normalizeSocialSettings,
	renderTemplate,
	socialFeedPath,
	isSocialFeedKind,
	socialFailureReason,
	spendMonth,
	templateProblems,
	webhookUrlProblem,
	type SocialFormat,
	type SocialLanguage,
	type SocialTemplate,
	type SocialWebhookEvent,
	type VideoObject,
	type NamedChannel,
} from '@al-ummah/shared-types';
import { buildRss, feedItems, FEED_CACHE_SECONDS } from '../lib/social/feed';
import { logger } from '../lib/logger';
import { roleOnChannel } from '../lib/channelAccess';
import R2Repository from '../lib/r2Repo';
import {
	SocialError,
	accountView,
	audit,
	channelAccountViews,
	listDeliveries,
	listRules,
	listTemplates,
	listWebhookDeliveries,
	listWebhooks,
	parseEvent,
	readAccount,
	readDelivery,
	readPlatformSettings,
	readSpend,
	readWebhook,
	requeueDelivery,
	saveRule,
	saveTemplate,
	setAccountLanguage,
	socialDb,
	webhookView,
	writeSetting,
} from '../lib/social/store';
import { randomToken, sealText, socialCryptoReady } from '../lib/social/crypto';
import { apiOrigin, blueskyClient, blueskyJwks, clearCredentials, networkReadiness, readCredentials, writeCredentials, type SocialEnv } from '../lib/social/platform';
import { confirmConnect, disconnect, disconnectChannel, ensureTelegramWebhook, finishOAuth, handleTelegramUpdate, startConnect, studioReturnUrl, telegramCodePending } from '../lib/social/connect';
import { clientMetadata } from '../lib/social/adapters/bluesky';
import { attemptPost, attemptWebhook, enqueueDelivery, giveUpPost, giveUpWebhook, planEvent, requeueWebhookDelivery, webhookSecretBound } from '../lib/social/deliver';
import { loadSocialContent, webOrigin } from '../lib/social/content';
import { loadPublicPlay, type PublicPlayEnv } from '../lib/media/public-play';
import { constantTimeEqual } from '@al-ummah/shared-types';
import { featureOff } from '../lib/features/off';
import { socialConfigured } from '../lib/features';

type Env = { Bindings: SocialEnv & { videos: R2Bucket; channels: R2Bucket }; Variables: { userId?: string } };

const CHANNEL_ID = /^[A-Za-z0-9_-]{1,64}$/;

function fail(c: Context<Env>, error: unknown) {
	if (error instanceof SocialError) return c.json({ error: error.code, ...(error.message !== error.code ? { message: error.message } : {}) }, error.status);
	logger.error('[Social] Request failed', { path: c.req.path, method: c.req.method, error: error instanceof Error ? error.message : String(error) });
	return c.json({ error: 'internal_error' }, 500);
}

async function requireRole(c: Context<Env>, channelId: string, capability: 'channel.edit' | 'video.edit'): Promise<string> {
	const userId = c.get('userId');
	if (!userId) throw new SocialError(403, 'unauthorized');
	if (!CHANNEL_ID.test(channelId)) throw new SocialError(404, 'channel_not_found');
	const role = await roleOnChannel(c.env as never, channelId, userId);
	if (!role) throw new SocialError(404, 'channel_not_found');
	if (!can(role, capability)) throw new SocialError(403, 'forbidden');
	return userId;
}

const body = async <T>(c: Context<Env>): Promise<Partial<T>> => ((await c.req.json().catch(() => null)) ?? {}) as Partial<T>;
const lang = (v: unknown): SocialLanguage => (v === 'ar' ? 'ar' : 'en');

function feedUrls(env: SocialEnv, channelId: string) {
	const origin = webOrigin(env);
	return Object.fromEntries(SOCIAL_FEED_KINDS.map((k) => [k, { en: `${origin}${socialFeedPath(channelId, k, 'en')}`, ar: `${origin}${socialFeedPath(channelId, k, 'ar')}` }]));
}

async function ownedAccount(c: Context<Env>, channelId: string, accountId: string) {
	const account = await readAccount(c.env, accountId);
	if (!account || account.channel_id !== channelId) throw new SocialError(404, 'account_not_found');
	return account;
}

async function ownedWebhook(c: Context<Env>, channelId: string, id: string) {
	const hook = await readWebhook(c.env, id);
	if (!hook || hook.channel_id !== channelId) throw new SocialError(404, 'webhook_not_found');
	return hook;
}

function webhookHostsAllowed(env: SocialEnv): string[] {
	return (env.SOCIAL_WEBHOOK_ALLOW_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function parseHookEvents(v: unknown): SocialWebhookEvent[] {
	const list = Array.isArray(v) ? v : [];
	const events = list.filter((e): e is SocialWebhookEvent => (SOCIAL_WEBHOOK_EVENTS as readonly string[]).includes(e as string));
	if (!events.length) throw new SocialError(400, 'events_required');
	return [...new Set(events)];
}

// =================================================================================================
// Studio
// =================================================================================================
export const socialRouter = new Hono<Env>();

// Auto-post to networks is hidden while it is off or no network is configured and on
// (lib/features): connecting, account settings and templates answer 404 feature_off.
// Removing an account already connected stays possible.
const autopostOff = async (c: Context<Env>, next: () => Promise<void>) => {
	if (c.req.method === 'DELETE' || (await socialConfigured(c.env as never))) return next();
	return featureOff(c as never);
};
for (const path of ['/channel/:channelId/connect', '/channel/:channelId/connect/*', '/channel/:channelId/telegram/*', '/channel/:channelId/accounts/*', '/channel/:channelId/templates']) {
	socialRouter.use(path, autopostOff);
}

socialRouter.get('/channel/:channelId', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		await requireRole(c, channelId, 'channel.edit');
		const [accounts, templates, deliveries, webhooks, readiness, settings] = await Promise.all([
			channelAccountViews(c.env, channelId),
			listTemplates(c.env, channelId),
			listDeliveries(c.env, channelId, 30),
			listWebhooks(c.env, channelId),
			networkReadiness(c.env),
			readPlatformSettings(c.env),
		]);
		c.header('Cache-Control', 'private, no-store');
		return c.json({
			accounts,
			templates,
			deliveries,
			webhooks: webhooks.map(webhookView),
			// Only the networks a creator can connect now (hidden otherwise; admin keeps readiness)
			networks: Object.fromEntries(
				(Object.keys(readiness) as Array<keyof typeof readiness>)
					.filter((n) => readiness[n].configured && settings.enabled && settings.networks[n].enabled)
					.map((n) => [n, { available: true, configured: true }]),
			),
			feeds: feedUrls(c.env, channelId),
			limits: { webhooks: MAX_WEBHOOKS_PER_CHANNEL },
		});
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.post('/channel/:channelId/connect', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const b = await body<{ network: string; language: string; handle: string; instance: string; returnLang: string }>(c);
		if (!isSocialNetwork(b.network)) throw new SocialError(400, 'invalid_network');
		const [readiness, settings] = await Promise.all([networkReadiness(c.env), readPlatformSettings(c.env)]);
		if (!readiness[b.network].configured || !settings.enabled || !settings.networks[b.network].enabled) return featureOff(c as never);
		const result = await startConnect(c.env, { network: b.network, channelId, userId, language: lang(b.language), returnLang: lang(b.returnLang), handle: b.handle, instance: b.instance });
		return c.json(result);
	} catch (error) {
		return fail(c, error);
	}
});

// The network sent the person back; only the signed-in person who started the flow can link the account
socialRouter.post('/channel/:channelId/connect/confirm', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const b = await body<{ id: string }>(c);
		const account = await confirmConnect(c.env, typeof b.id === 'string' ? b.id : '', { userId, channelId });
		return c.json({ account: accountView(account, await listRules(c.env, [account.id])) });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.get('/channel/:channelId/telegram/:code', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		await requireRole(c, channelId, 'channel.edit');
		return c.json({ pending: await telegramCodePending(c.env, c.req.param('code'), channelId) });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.patch('/channel/:channelId/accounts/:accountId', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const account = await ownedAccount(c, channelId, c.req.param('accountId'));
		const b = await body<{ language: string; rules: Array<{ event: string; enabled: boolean; format: string; includeLink: boolean }> }>(c);
		if (b.language !== undefined) {
			if (!(SOCIAL_LANGUAGES as readonly string[]).includes(b.language)) throw new SocialError(400, 'invalid_language');
			await setAccountLanguage(c.env, account.id, b.language as SocialLanguage);
		}
		for (const r of Array.isArray(b.rules) ? b.rules.slice(0, SOCIAL_EVENTS.length) : []) {
			const event = parseEvent(r.event);
			const format = (formatsFor(event) as readonly string[]).includes(r.format) ? (r.format as SocialFormat) : null;
			if (!format) throw new SocialError(400, 'invalid_format');
			await saveRule(c.env, account.id, { event, enabled: r.enabled === true, format, includeLink: account.network === 'x' && r.includeLink === true });
		}
		await audit(c.env, channelId, userId, 'account.update', account.id, { language: b.language, rules: b.rules });
		const fresh = (await readAccount(c.env, account.id))!;
		return c.json({ account: accountView(fresh, await listRules(c.env, [account.id])) });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.delete('/channel/:channelId/accounts/:accountId', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const account = await ownedAccount(c, channelId, c.req.param('accountId'));
		await disconnect(c.env, account.id, userId);
		return c.json({ ok: true });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.put('/channel/:channelId/templates', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const b = await body<{ templates: SocialTemplate[] }>(c);
		const list = Array.isArray(b.templates) ? b.templates.slice(0, SOCIAL_EVENTS.length * 2) : [];
		const problems: Array<{ event: string; lang: string; problems: string[] }> = [];
		for (const t of list) {
			const event = parseEvent(t.event);
			const p = templateProblems(event, String(t.body ?? ''));
			if (p.length) problems.push({ event, lang: lang(t.lang), problems: p });
		}
		if (problems.length) return c.json({ error: 'invalid_template', problems }, 422);
		for (const t of list) await saveTemplate(c.env, channelId, { event: parseEvent(t.event), lang: lang(t.lang), body: String(t.body) }, userId);
		await audit(c.env, channelId, userId, 'templates.update', undefined, { count: list.length });
		return c.json({ templates: await listTemplates(c.env, channelId) });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.get('/channel/:channelId/deliveries', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		await requireRole(c, channelId, 'channel.edit');
		return c.json({ deliveries: await listDeliveries(c.env, channelId, Number(c.req.query('limit')) || 50) });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.post('/channel/:channelId/deliveries/:id/retry', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const d = await readDelivery(c.env, c.req.param('id'));
		if (!d || d.channel_id !== channelId) throw new SocialError(404, 'delivery_not_found');
		const b = await body<{ format: string }>(c);
		const format = b.format && (formatsFor(d.event) as readonly string[]).includes(b.format) ? (b.format as SocialFormat) : undefined;
		if (!(await requeueDelivery(c.env, d.id, { format }))) throw new SocialError(409, 'not_retryable');
		await enqueueDelivery(c.env, 'post', d.id);
		await audit(c.env, channelId, userId, 'delivery.retry', d.id, format ? { format } : undefined);
		return c.json({ ok: true });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.post('/channel/:channelId/webhooks', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		if (!(await socialCryptoReady(c.env))) return featureOff(c as never);
		const b = await body<{ url: string; events: string[] }>(c);
		const url = String(b.url ?? '').trim();
		const problem = webhookUrlProblem(url, webhookHostsAllowed(c.env));
		if (problem) throw new SocialError(400, problem);
		const events = parseHookEvents(b.events);
		if ((await listWebhooks(c.env, channelId)).length >= MAX_WEBHOOKS_PER_CHANNEL) throw new SocialError(409, 'webhook_limit');
		const id = `wh_${crypto.randomUUID().replace(/-/g, '')}`;
		const secret = `whsec_${randomToken(32)}`;
		const now = Date.now();
		await socialDb(c.env)
			.prepare('INSERT INTO social_webhooks (id, channel_id, url, secret_ciphertext, events, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
			.bind(id, channelId, url, await sealText(c.env, secret, webhookSecretBound(id)), events.join(','), userId, now, now)
			.run();
		await audit(c.env, channelId, userId, 'webhook.create', id, { host: new URL(url).host, events });
		return c.json({ webhook: webhookView((await readWebhook(c.env, id))!), secret }, 201);
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.patch('/channel/:channelId/webhooks/:id', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const hook = await ownedWebhook(c, channelId, c.req.param('id'));
		const b = await body<{ enabled: boolean; events: string[] }>(c);
		const events = b.events !== undefined ? parseHookEvents(b.events).join(',') : hook.events;
		const enabled = typeof b.enabled === 'boolean' ? (b.enabled ? 1 : 0) : hook.enabled;
		await socialDb(c.env).prepare('UPDATE social_webhooks SET events = ?, enabled = ?, failure_count = CASE WHEN ? = 1 THEN 0 ELSE failure_count END, updated_at = ? WHERE id = ?').bind(events, enabled, enabled, Date.now(), hook.id).run();
		await audit(c.env, channelId, userId, 'webhook.update', hook.id, { enabled: !!enabled, events });
		return c.json({ webhook: webhookView((await readWebhook(c.env, hook.id))!) });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.delete('/channel/:channelId/webhooks/:id', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const hook = await ownedWebhook(c, channelId, c.req.param('id'));
		const db = socialDb(c.env);
		await db.batch([db.prepare('DELETE FROM social_webhook_deliveries WHERE webhook_id = ?').bind(hook.id), db.prepare('DELETE FROM social_webhooks WHERE id = ?').bind(hook.id)]);
		await audit(c.env, channelId, userId, 'webhook.delete', hook.id);
		return c.json({ ok: true });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.post('/channel/:channelId/webhooks/:id/test', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		await requireRole(c, channelId, 'channel.edit');
		const hook = await ownedWebhook(c, channelId, c.req.param('id'));
		const id = `wd_${crypto.randomUUID().replace(/-/g, '')}`;
		const now = Date.now();
		await socialDb(c.env)
			.prepare(`INSERT INTO social_webhook_deliveries (id, webhook_id, channel_id, event, entity_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ping', ?, 'queued', ?, ?)`)
			.bind(id, hook.id, channelId, id, now, now)
			.run();
		await enqueueDelivery(c.env, 'webhook', id);
		return c.json({ deliveryId: id });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.post('/channel/:channelId/webhooks/:id/secret', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		const userId = await requireRole(c, channelId, 'channel.edit');
		const hook = await ownedWebhook(c, channelId, c.req.param('id'));
		const secret = `whsec_${randomToken(32)}`;
		await socialDb(c.env).prepare('UPDATE social_webhooks SET secret_ciphertext = ?, updated_at = ? WHERE id = ?').bind(await sealText(c.env, secret, webhookSecretBound(hook.id)), Date.now(), hook.id).run();
		await audit(c.env, channelId, userId, 'webhook.rotate_secret', hook.id);
		return c.json({ secret });
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.get('/channel/:channelId/webhooks/:id/deliveries', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		await requireRole(c, channelId, 'channel.edit');
		const hook = await ownedWebhook(c, channelId, c.req.param('id'));
		const rows = await listWebhookDeliveries(c.env, hook.id, 20);
		return c.json({
			deliveries: rows.map((r) => ({ id: r.id, event: r.event, entityId: r.entity_id, status: r.status, attempts: r.attempts, responseStatus: r.response_status, error: r.last_error, createdAt: new Date(r.created_at).toISOString() })),
		});
	} catch (error) {
		return fail(c, error);
	}
});

/** Studio "Share kit": captions in both languages, the links, the thumbnail and an optional vertical clip. */
socialRouter.get('/channel/:channelId/share-kit/:videoId', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		await requireRole(c, channelId, 'video.edit');
		const videoId = c.req.param('videoId');
		const video = await new R2Repository<VideoObject>(c.env.videos).getObject(videoId);
		if (!video || video.channelId !== channelId) throw new SocialError(404, 'video_not_found');
		const event = isShort(video as never) ? 'short' : 'video';
		const content = await loadSocialContent(c.env, channelId, event, videoId);
		// A private, scheduled or processing video has no public page to share yet
		if (!content) return c.json({ videoId, available: false, reason: 'not_public' });
		const templates = await listTemplates(c.env, channelId);
		const captions = Object.fromEntries(
			SOCIAL_LANGUAGES.map((l) => [l, renderTemplate(templates.find((t) => t.event === event && t.lang === l)!.body, { title: content.title[l], channel: content.channel.name[l], url: content.url[l] })]),
		);
		let clip: { videoId: string; title: string; downloadPath: string; width: number | null; height: number | null; durationSeconds: number | null } | null = null;
		const clipId = event === 'short' ? videoId : c.req.query('clip');
		if (clipId) {
			const clipVideo = clipId === videoId ? video : await new R2Repository<VideoObject>(c.env.videos).getObject(clipId);
			if (!clipVideo || clipVideo.channelId !== channelId || !isShort(clipVideo as never)) throw new SocialError(404, 'clip_not_found');
			const play = await loadPublicPlay(c.env as unknown as PublicPlayEnv, clipId).catch(() => null);
			if (play?.mp4?.url) clip = { videoId: clipId, title: play.title, downloadPath: `/studio-download/clip/${encodeURIComponent(channelId)}/${encodeURIComponent(clipId)}.mp4`, width: play.width, height: play.height, durationSeconds: play.durationSeconds };
		}
		c.header('Cache-Control', 'private, no-store');
		return c.json({
			videoId,
			available: true,
			kind: event,
			title: content.title,
			captions,
			links: content.url,
			canonicalLinks: content.canonicalUrl,
			thumbnail: { url: content.thumbnailUrl, downloadPath: `/thumb/${encodeURIComponent(videoId)}.jpg` },
			clip,
		});
	} catch (error) {
		return fail(c, error);
	}
});

/** The MP4 behind a share-kit clip (the web streams it to the creator as a download). */
socialRouter.get('/channel/:channelId/share-kit/:videoId/clip-source', async (c) => {
	const channelId = c.req.param('channelId');
	try {
		await requireRole(c, channelId, 'video.edit');
		const video = await new R2Repository<VideoObject>(c.env.videos).getObject(c.req.param('videoId'));
		if (!video || video.channelId !== channelId || !isShort(video as never)) throw new SocialError(404, 'clip_not_found');
		const play = await loadPublicPlay(c.env as unknown as PublicPlayEnv, video.id).catch(() => null);
		if (!play?.mp4?.url) throw new SocialError(404, 'clip_not_found');
		c.header('Cache-Control', 'private, no-store');
		return c.json({ url: play.mp4.url });
	} catch (error) {
		return fail(c, error);
	}
});

// =================================================================================================
// Public
// =================================================================================================
socialRouter.get('/feeds/:channelId/:file', async (c) => {
	try {
		const channelId = c.req.param('channelId');
		const kind = /^([a-z]+)\.xml$/.exec(c.req.param('file'))?.[1];
		if (!/^[A-Za-z0-9_-]{1,80}$/.test(channelId) || !isSocialFeedKind(kind)) throw new SocialError(404, 'feed_not_found');
		const lang = c.req.query('lang') === 'ar' ? 'ar' : 'en';
		const feed = await feedItems(c.env, channelId, kind);
		if (!feed) throw new SocialError(404, 'feed_not_found');
		const body = buildRss(feed, kind, lang, `${webOrigin(c.env)}${socialFeedPath(channelId, kind, lang)}`);
		return c.body(body, 200, {
			'Content-Type': 'application/rss+xml; charset=utf-8',
			'Cache-Control': `public, max-age=${FEED_CACHE_SECONDS}`,
			'Access-Control-Allow-Origin': '*',
			'X-Content-Type-Options': 'nosniff',
		});
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.get('/bluesky/client-metadata.json', async (c) => {
	try {
		const client = await blueskyClient(c.env);
		c.header('Cache-Control', 'public, max-age=300');
		return c.json(clientMetadata(client, `${apiOrigin(c.env)}/api/social/bluesky/jwks.json`, webOrigin(c.env)));
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.get('/bluesky/jwks.json', async (c) => {
	try {
		c.header('Cache-Control', 'public, max-age=300');
		return c.json(await blueskyJwks(c.env));
	} catch (error) {
		return fail(c, error);
	}
});

socialRouter.get('/oauth/:network/callback', async (c) => {
	const network = c.req.param('network');
	if (!isSocialNetwork(network) || network === 'telegram') return c.redirect(studioReturnUrl(c.env, 'en', null, { error: 'expired' }), 302);
	try {
		const result = await finishOAuth(c.env, network, new URL(c.req.url).searchParams, async (userId, channelId) => can(await roleOnChannel(c.env as never, channelId, userId), 'channel.edit'));
		c.header('Cache-Control', 'no-store');
		c.header('Referrer-Policy', 'no-referrer');
		return c.redirect(studioReturnUrl(c.env, result.lang, result.channelId, result.confirm ? { confirm: result.confirm } : { error: result.error }), 302);
	} catch (error) {
		logger.error('[Social] OAuth callback failed', { network, error: error instanceof Error ? error.message : String(error) });
		return c.redirect(studioReturnUrl(c.env, 'en', null, { error: 'internal_error' }), 302);
	}
});

socialRouter.post('/webhooks/telegram', async (c) => {
	try {
		const creds = await readCredentials(c.env, 'telegram');
		if (!creds?.webhookSecret || !constantTimeEqual(c.req.header('X-Telegram-Bot-Api-Secret-Token'), creds.webhookSecret)) return c.json({ error: 'unauthorized' }, 401);
		const update = await c.req.json().catch(() => null);
		if (update && typeof update === 'object') await handleTelegramUpdate(c.env, update as never);
		// Telegram resends anything that isn't 200; a failure here is logged, never retried by Telegram
		return c.json({ ok: true });
	} catch (error) {
		logger.error('[Social] Telegram update failed', { error: error instanceof Error ? error.message : String(error) });
		return c.json({ ok: true });
	}
});

// =================================================================================================
// Internal
// =================================================================================================
export const socialInternalRouter = new Hono<Env>();

socialInternalRouter.post('/events', async (c) => {
	try {
		const b = await body<{ channelId: string; event: string; entityId: string }>(c);
		if (!b.channelId || !b.entityId) throw new SocialError(400, 'invalid_event');
		return c.json(await planEvent(c.env, String(b.channelId), parseEvent(b.event), String(b.entityId)));
	} catch (error) {
		return fail(c, error);
	}
});

socialInternalRouter.post('/deliveries/:id/attempt', async (c) => {
	try {
		const b = await body<{ kind: string }>(c);
		const id = c.req.param('id');
		return c.json(b.kind === 'webhook' ? await attemptWebhook(c.env, id) : await attemptPost(c.env, id));
	} catch (error) {
		return fail(c, error);
	}
});

socialInternalRouter.post('/deliveries/:id/give-up', async (c) => {
	try {
		const b = await body<{ kind: string; error: string }>(c);
		const id = c.req.param('id');
		const error = String(b.error ?? 'failed');
		if (b.kind === 'webhook') {
			const row = await giveUpWebhook(c.env, id, error);
			if (!row) throw new SocialError(404, 'delivery_not_found');
			const hook = await readWebhook(c.env, row.webhook_id);
			return c.json({ channelId: row.channel_id, entityId: row.entity_id, status: row.status, error: row.last_error, host: hook ? new URL(hook.url).host : undefined });
		}
		const row = await giveUpPost(c.env, id, error);
		if (!row) throw new SocialError(404, 'delivery_not_found');
		return c.json({ channelId: row.channel_id, network: row.network, entityId: row.entity_id, event: row.event, status: row.status, error: row.last_error });
	} catch (error) {
		return fail(c, error);
	}
});

socialInternalRouter.post('/deliveries/retry', async (c) => {
	try {
		const b = await body<{ kind: string; deliveryId: string }>(c);
		const id = String(b.deliveryId ?? '');
		const ok = b.kind === 'webhook' ? await requeueWebhookDelivery(c.env, id) : await requeueDelivery(c.env, id);
		// Sent, cancelled or deleted meanwhile: nothing left to retry (the Errors page dismisses the item)
		if (!ok) return c.json({ success: false, error: 'not_retryable' }, 404);
		await enqueueDelivery(c.env, b.kind === 'webhook' ? 'webhook' : 'post', id);
		return c.json({ success: true });
	} catch (error) {
		return fail(c, error);
	}
});

socialInternalRouter.get('/admin', async (c) => {
	try {
		const db = socialDb(c.env);
		const since = Date.now() - 7 * 86_400_000;
		const [settings, readiness, spend, counts, failures, accounts] = await Promise.all([
			readPlatformSettings(c.env),
			networkReadiness(c.env),
			readSpend(c.env, 'x'),
			db.prepare('SELECT network, status, COUNT(*) AS n FROM social_deliveries WHERE created_at >= ? GROUP BY network, status').bind(since).all<{ network: string; status: string; n: number }>(),
			db.prepare(`SELECT id, channel_id, network, event, entity_id, entity_title, last_error, updated_at FROM social_deliveries WHERE status IN ('failed', 'blocked') ORDER BY updated_at DESC LIMIT 20`).all<Record<string, unknown>>(),
			db.prepare('SELECT network, status, COUNT(*) AS n FROM social_accounts GROUP BY network, status').all<{ network: string; status: string; n: number }>(),
		]);
		const tg = await readCredentials(c.env, 'telegram');
		// Admins see channel names, never ids (at most 20 rows, so at most 20 small reads of the channel records)
		const failureRows = failures.results ?? [];
		const channelIds = [...new Set(failureRows.map((f) => String(f.channel_id ?? '')).filter(Boolean))];
		const names = new Map(
			await Promise.all(
				channelIds.map(async (id) => {
					const channel = await new R2Repository<NamedChannel>(c.env.channels).getObject(id).catch(() => null);
					return [id, channel ? channelNameFields(channel) : null] as const;
				}),
			),
		);
		return c.json({
			settings,
			readiness,
			telegramBot: tg?.botUsername ?? null,
			callbacks: { x: `${apiOrigin(c.env)}/api/social/oauth/x/callback` },
			spend: { month: spendMonth(), x: { costUsd: spend.costMicros / 1_000_000, posts: spend.posts, capUsd: settings.xMonthlyCapUsd } },
			deliveries7d: counts.results ?? [],
			accounts: accounts.results ?? [],
			recentFailures: failureRows.map((f) => {
				const name = names.get(String(f.channel_id ?? ''));
				return {
					...f,
					channel_name: name?.channelName || null,
					...(name?.channelNameLocalized ? { channel_name_localized: name.channelNameLocalized } : {}),
					reason: socialFailureReason(typeof f.last_error === 'string' ? f.last_error : null),
					updated_at: new Date(Number(f.updated_at)).toISOString(),
				};
			}),
		});
	} catch (error) {
		return fail(c, error);
	}
});

socialInternalRouter.put('/admin/settings', async (c) => {
	try {
		const actor = c.req.header('X-Admin-Actor')?.slice(0, 128) || 'admin';
		const before = await readPlatformSettings(c.env);
		const settings = normalizeSocialSettings(await c.req.json().catch(() => null));
		await writeSetting(c.env, 'platform', JSON.stringify(settings), actor);
		return c.json({ before, settings });
	} catch (error) {
		return fail(c, error);
	}
});

socialInternalRouter.put('/admin/credentials/:network', async (c) => {
	try {
		const actor = c.req.header('X-Admin-Actor')?.slice(0, 128) || 'admin';
		const network = c.req.param('network');
		if (!(await socialCryptoReady(c.env))) throw new SocialError(503, 'token_key_missing');
		const b = await body<{ clientId: string; clientSecret: string; botToken: string }>(c);
		if (network === 'x') {
			const clientId = String(b.clientId ?? '').trim();
			const clientSecret = String(b.clientSecret ?? '').trim();
			if (!/^[A-Za-z0-9_-]{8,200}$/.test(clientId) || clientSecret.length < 8 || clientSecret.length > 500) throw new SocialError(400, 'invalid_credentials');
			await writeCredentials(c.env, 'x', { clientId, clientSecret }, actor);
		} else if (network === 'telegram') {
			const botToken = String(b.botToken ?? '').trim();
			if (!/^\d{5,20}:[A-Za-z0-9_-]{30,100}$/.test(botToken)) throw new SocialError(400, 'invalid_credentials');
			await writeCredentials(c.env, 'telegram', { botToken }, actor);
			// Registers the webhook now, so a wrong token shows at once
			try {
				await ensureTelegramWebhook(c.env);
			} catch (error) {
				await clearCredentials(c.env, 'telegram');
				throw error instanceof SocialError ? new SocialError(422, 'invalid_credentials', error.message) : error;
			}
		} else {
			throw new SocialError(400, 'invalid_network');
		}
		return c.json({ readiness: await networkReadiness(c.env) });
	} catch (error) {
		return fail(c, error);
	}
});

socialInternalRouter.delete('/admin/credentials/:network', async (c) => {
	try {
		const network = c.req.param('network');
		if (network !== 'x' && network !== 'telegram') throw new SocialError(400, 'invalid_network');
		await clearCredentials(c.env, network);
		return c.json({ readiness: await networkReadiness(c.env) });
	} catch (error) {
		return fail(c, error);
	}
});

socialInternalRouter.post('/channels/:channelId/erase', async (c) => {
	try {
		return c.json({ disconnected: await disconnectChannel(c.env, c.req.param('channelId'), 'system') });
	} catch (error) {
		return fail(c, error);
	}
});
