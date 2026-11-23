/**
 * The support sheet, the channel's support settings and Settings › Support (wiki AUN-MEMBERS §2.1,
 * §2.2, §11; MEM-7). Every route answers 404 feature_off while `creatorSupport` is off, and also
 * while the server checks say no for this person or channel (lib/support/eligibility.ts), so a
 * hidden button and its API agree. One exception: a person who already has monthly support can
 * always see and stop it, whatever the switch says (stopping is never taken away).
 *
 *   GET  /api/channels/:channelId/support                  what the sheet shows (presets, kinds, note, minimum)
 *   GET  /api/channels/:channelId/support/quote            ?amount=&currency=USD&coverFees=1&lang=ar  the breakdown
 *   POST /api/channels/:channelId/support/checkout         → { checkoutId, url } (hosted checkout)
 *   PUT  /api/channels/:channelId/support/settings         the owner's own settings (Studio › Support)
 *   GET  /api/me/support                                   the person's monthly support and gifts
 *   GET  /api/me/support/checkouts/:id                     open / completed / expired
 *   POST /api/me/support/pledges/:id/stop                  stops a monthly pledge at once
 */
import type { Context } from 'hono';
import { CLIENT_HEADER, channelRoleOf } from '@al-ummah/shared-types';
import { apiError } from '../../lib/api-error';
import { checkHuman, TURNSTILE_HEADER } from '../../lib/bot-guard';
import { loadChannelRecord, roleOnChannel, type ChannelAccessEnv } from '../../lib/channelAccess';
import { resolveCreator } from '../../lib/creatorTiers';
import { featureOff } from '../../lib/features/off';
import { logger } from '../../lib/logger';
import { CheckoutError, myCheckout, mySupport, quote, saveChannelSupportSettings, startSupportCheckout, stopMyPledge } from '../../lib/support/checkout';
import { readSupportConfig } from '../../lib/support/config';
import { receiverEligibility, supporterEligibility } from '../../lib/support/eligibility';
import { vendorContext, type SupportJobEnv } from '../../lib/support/jobs';
import { supportSwitch } from '../../lib/support/switch';
import { CollectorError } from '../../lib/support/collector';

type Env = SupportJobEnv & { channels?: R2Bucket; VIDEOS_WEB_URL?: string; [k: string]: unknown };

const lang = (c: Context): 'en' | 'ar' => (c.req.query('lang') === 'ar' || c.req.header('X-App-Locale') === 'ar' ? 'ar' : 'en');
const country = (c: Context) => ((c.req.raw as { cf?: { country?: unknown } }).cf?.country as string | undefined) ?? null;

function failure(c: Context, error: unknown) {
	if (error instanceof CheckoutError) return apiError(c, error.status, error.code);
	if (error instanceof CollectorError) {
		logger.warn('[Support] Collector call failed', { error: error.message });
		return apiError(c, 503, 'service_unavailable');
	}
	throw error;
}

/** The channel, if it may receive; else null (the route answers feature_off). */
async function receivingChannel(c: Context, env: Env) {
	const channelId = c.req.param('channelId') ?? '';
	const record = await loadChannelRecord(env as unknown as ChannelAccessEnv, channelId).catch(() => null);
	if (!record) return null;
	const channel = { channelId, ownerId: record.userId ?? null, deleted: !!record.isDeleted, suspended: !!record.isSuspended };
	const db = env.SEARCH_DB!;
	const ok = await receiverEligibility(env, channel, async (ownerId) => (await resolveCreator(db as unknown as D1Database, { userId: ownerId, roles: null })).tier?.supportReceive === true);
	return ok.ok ? { ...channel, record } : null;
}

export async function handleSupportSheet(c: Context) {
	const env = c.env as Env;
	if (!(await supportSwitch(env)).on || !env.SEARCH_DB) return featureOff(c, 'creatorSupport');
	const channel = await receivingChannel(c, env);
	if (!channel) return featureOff(c, 'creatorSupport');
	const [settings, config] = await Promise.all([
		env.SEARCH_DB.prepare('SELECT one_time_enabled, monthly_enabled, presets, thank_you_note FROM support_settings WHERE channel_id = ?').bind(channel.channelId).first<{ one_time_enabled: number; monthly_enabled: number; presets: string; thank_you_note: string | null }>(),
		readSupportConfig(env.SEARCH_DB),
	]);
	let presets: number[] = [];
	try {
		presets = JSON.parse(settings?.presets || '[]');
	} catch {
		presets = [];
	}
	if (!presets.length) presets = config.policy.presetsUsdMinor ?? [];
	c.header('Cache-Control', 'private, no-store');
	return c.json({
		success: true,
		result: {
			channelId: channel.channelId,
			currency: 'USD',
			oneTime: settings?.one_time_enabled === 1,
			monthly: settings?.monthly_enabled === 1,
			presets,
			minimum: config.policy.minimumUsdMinor,
			coverFeesChoice: config.policy.collectorFeePayer === 'creatorSupporterMayCover',
			minAge: config.policy.minSupporterAge,
			thankYouNote: settings?.thank_you_note ?? null,
		},
	});
}

export async function handleSupportQuote(c: Context) {
	const env = c.env as Env;
	if (!(await supportSwitch(env)).on || !env.SEARCH_DB) return featureOff(c, 'creatorSupport');
	if (!(await receivingChannel(c, env))) return featureOff(c, 'creatorSupport');
	try {
		const config = await readSupportConfig(env.SEARCH_DB);
		const q = quote(env, config, { amount: Number(c.req.query('amount')), currency: c.req.query('currency') ?? 'USD', supporterTicked: c.req.query('coverFees') === '1' }, lang(c));
		return c.json({ success: true, result: q });
	} catch (error) {
		return failure(c, error);
	}
}

export async function handleSupportCheckout(c: Context) {
	const env = c.env as Env;
	if (!(await supportSwitch(env)).on || !env.SEARCH_DB) return featureOff(c, 'creatorSupport');
	const userId = c.get('userId') as string | undefined;
	if (!userId) return apiError(c, 401, 'authentication_required');
	const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
	const channel = await receivingChannel(c, env);
	if (!channel) return featureOff(c, 'creatorSupport');
	const supporter = await supporterEligibility(env, { userId, country: country(c), client: c.req.header(CLIENT_HEADER) ?? null });
	// Not eligible here, or their own channel (self-support is refused, §2.3). The role comes from the
	// channel record already read, so a storage error can't let a team member through.
	const role = channelRoleOf(channel.record, userId);
	if (!supporter.ok || role || channel.ownerId === userId) return featureOff(c, 'creatorSupport');
	// The human check comes after: someone who may not support here gets feature_off, not a captcha refusal
	const human = await checkHuman(env as never, c.req.raw, typeof body.turnstileToken === 'string' ? body.turnstileToken : (c.req.header(TURNSTILE_HEADER) ?? null), 'support-checkout');
	if (!human.allowed) return apiError(c, 403, 'human_check_failed');
	const kind = body.kind === 'monthly' ? 'monthly' : body.kind === 'one_time' ? 'one_time' : null;
	if (!kind) return apiError(c, 400, 'invalid_request');
	const settings = await env.SEARCH_DB.prepare('SELECT one_time_enabled, monthly_enabled FROM support_settings WHERE channel_id = ?').bind(channel.channelId).first<{ one_time_enabled: number; monthly_enabled: number }>();
	if ((kind === 'monthly' ? settings?.monthly_enabled : settings?.one_time_enabled) !== 1) return apiError(c, 400, 'invalid_request');
	const web = String(env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	const path = typeof body.returnPath === 'string' && body.returnPath.startsWith('/') && !body.returnPath.startsWith('//') && !/[\r\n\\]/.test(body.returnPath) && body.returnPath.length <= 300 ? body.returnPath : `/channel/${encodeURIComponent(channel.channelId)}`;
	try {
		const now = new Date();
		const config = await readSupportConfig(env.SEARCH_DB);
		const r = await startSupportCheckout(
			env,
			{ userId, channelId: channel.channelId },
			{
				kind,
				amount: Number(body.amount),
				currency: typeof body.currency === 'string' ? body.currency : 'USD',
				coverFees: body.coverFees === true,
				anonymous: body.anonymous === true,
				message: typeof body.message === 'string' ? body.message : null,
				ageConfirmed: body.ageConfirmed === true,
				consent: body.consent === true,
				locale: body.locale === 'ar' ? 'ar' : 'en',
				returnUrl: `${web}${path}${path.includes('?') ? '&' : '?'}support=`,
			},
			vendorContext(env, config.mode, () => now),
			now,
		);
		return c.json({ success: true, result: { checkoutId: r.checkoutId, url: r.url, quote: r.quote } });
	} catch (error) {
		return failure(c, error);
	}
}

export async function handleSupportSettingsSave(c: Context) {
	const env = c.env as Env;
	if (!(await supportSwitch(env)).on || !env.SEARCH_DB) return featureOff(c, 'creatorSupport');
	const userId = c.get('userId') as string | undefined;
	if (!userId) return apiError(c, 401, 'authentication_required');
	const channelId = c.req.param('channelId') ?? '';
	if ((await roleOnChannel(env as unknown as ChannelAccessEnv, channelId, userId).catch(() => null)) !== 'owner') return apiError(c, 404, 'channel_not_found');
	try {
		const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
		return c.json({ success: true, result: await saveChannelSupportSettings(env.SEARCH_DB, channelId, userId, body, new Date()) });
	} catch (error) {
		return failure(c, error);
	}
}

/** Off, unless the person already has monthly support or gifts to see (stopping is never taken away). */
async function meGate(c: Context, env: Env): Promise<string | Response> {
	const userId = c.get('userId') as string | undefined;
	if (!env.SEARCH_DB) return featureOff(c, 'creatorSupport');
	if (!userId) return apiError(c, 401, 'authentication_required');
	if ((await supportSwitch(env)).on) return userId;
	const has = await env.SEARCH_DB.prepare('SELECT 1 AS x FROM support_pledges WHERE supporter_user_id = ? UNION ALL SELECT 1 AS x FROM support_payments WHERE supporter_user_id = ? LIMIT 1').bind(userId, userId).first();
	return has ? userId : featureOff(c, 'creatorSupport');
}

export async function handleMySupport(c: Context) {
	const env = c.env as Env;
	const g = await meGate(c, env);
	if (g instanceof Response) return g;
	c.header('Cache-Control', 'private, no-store');
	return c.json({ success: true, result: await mySupport(env.SEARCH_DB!, g) });
}

export async function handleMySupportCheckout(c: Context) {
	const env = c.env as Env;
	const g = await meGate(c, env);
	if (g instanceof Response) return g;
	const r = await myCheckout(env.SEARCH_DB!, g, c.req.param('id') ?? '');
	if (!r) return apiError(c, 404, 'not_found');
	c.header('Cache-Control', 'private, no-store');
	return c.json({ success: true, result: r });
}

export async function handleStopMyPledge(c: Context) {
	const env = c.env as Env;
	const g = await meGate(c, env);
	if (g instanceof Response) return g;
	try {
		const now = new Date();
		return c.json({ success: true, result: await stopMyPledge(env, g, c.req.param('id') ?? '', (mode) => vendorContext(env, mode, () => now), now) });
	} catch (error) {
		return failure(c, error);
	}
}
