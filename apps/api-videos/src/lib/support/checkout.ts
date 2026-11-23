/**
 * Supporting a channel: the breakdown and the hosted checkout (wiki AUN-MEMBERS §2.1, §5.4; MEM-7,
 * Linear AUN-619), and the supporter's own records (Settings › Support, §2.2).
 *
 *   quote     the breakdown before paying: gift, card fee, "cover the fees" (MEM-D3), tax,
 *             "Al Ummah Now takes $0.00", what the creator receives
 *   checkout  eligibility (eligibility.ts) → amount rules (MEM-D4) → age confirmation (MEM-D9) →
 *             monthly consent ("Charge me {amount} every month until I stop", kept word for word) →
 *             a checkout row → the collector's hosted page. Card data never reaches us.
 *   stop      a monthly pledge stops at once at the collector; no further charges
 *
 * Amounts are integer minor units. A currency can be given in once it has its MEM-D4 amounts and the
 * collector's fee is known (a live quote, or the admin's fee setting; O43).
 */
import { effectiveCoverFees, formatSupportMoney, isSupportCurrency, money, MoneyError, quoteGift, type CollectorFeeSchedule, type GiftBreakdown, type Money, type SearchDb, type SupportCurrency } from '@al-ummah/shared-types';
import { collectorFor, type SupportAdapterEnv } from './adapters';
import type { CancelReason, CollectorContext } from './collector';
import { readSupportConfig, type SupportConfig } from './config';
import { feeSetting } from './fees';

export class CheckoutError extends Error {
	constructor(
		readonly status: 400 | 404 | 409 | 429,
		readonly code: 'invalid_request' | 'support_amount_too_small' | 'support_currency_unavailable' | 'support_age_required' | 'support_consent_required' | 'support_message_too_long' | 'rate_limited' | 'not_found' | 'support_pledge_ended',
		message: string,
	) {
		super(message);
		this.name = 'CheckoutError';
	}
}

export const SUPPORT_MESSAGE_MAX = 500;
/** The largest amount a gift or a preset may be, in minor units (the same bound as the admin's presets) */
const MAX_AMOUNT_MINOR = 1_000_000_000;
/** Checkouts one account may start per hour (card testing, §2.3); the admin-set daily limits are MEM-D4's sibling settings */
export const SUPPORT_CHECKOUTS_PER_HOUR = 10;

/**
 * The collector's fee for a currency and method (O43): the vendor's live quote when it gives one, else
 * the newest fee setting in force, else null (nobody can pay in that currency).
 */
export async function collectorFeeFor(env: SupportAdapterEnv & { SEARCH_DB?: SearchDb }, config: SupportConfig, currency: SupportCurrency, method: string | null, ctx: CollectorContext, now: Date): Promise<CollectorFeeSchedule | null> {
	const collector = collectorFor(env, config.collector);
	if (collector?.liveFee) {
		const live = await collector.liveFee(ctx, currency, method).catch(() => null);
		if (live) return live;
	}
	return feeSetting(env.SEARCH_DB!, 'collector', config.collector, currency, method, now);
}

export interface QuoteInput {
	amount: number;
	currency: string;
	supporterTicked: boolean;
	/** The payment method, when the sheet knows it ('card', …); null = any */
	method?: string | null;
}

export interface Quote extends GiftBreakdown {
	/** The supporter may choose to cover the fees (MEM-D3 'creatorSupporterMayCover') */
	coverFeesChoice: boolean;
	/** The same amounts as text in the asked language, for clients that show them as they are */
	text: Record<'charged' | 'gift' | 'coverFees' | 'collectorFee' | 'tax' | 'platformFee' | 'creatorReceives', string>;
}

/**
 * The breakdown, or a CheckoutError for an amount the rules refuse. The currency needs its MEM-D4
 * amounts and a collector fee (live or set, O43); the fee is always shown, and covering it is the
 * supporter's choice, off unless they tick it (MEM-D3).
 */
export async function quote(env: SupportAdapterEnv & { SEARCH_DB?: SearchDb }, config: SupportConfig, input: QuoteInput, locale: 'en' | 'ar', ctx: CollectorContext, now: Date): Promise<Quote> {
	if (!isSupportCurrency(input.currency)) throw new CheckoutError(400, 'support_currency_unavailable', 'Unknown currency');
	const currency = input.currency;
	if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT_MINOR) throw new CheckoutError(400, 'invalid_request', 'Amount must be a whole number of minor units');
	const p = config.policy;
	const rule = p.amounts?.[currency];
	if (!rule || p.collectorFeePayer === null) throw new CheckoutError(409, 'support_currency_unavailable', 'Support amounts are not set for this currency');
	if (input.amount < rule.minimum) throw new CheckoutError(400, 'support_amount_too_small', 'Below the minimum');
	const fee = await collectorFeeFor(env, config, currency, input.method ?? null, ctx, now);
	if (!fee) throw new CheckoutError(409, 'support_currency_unavailable', 'No fee is known for this currency');
	const covers = effectiveCoverFees(p.collectorFeePayer, input.supporterTicked) as boolean;
	let b: GiftBreakdown;
	try {
		b = quoteGift({ gift: money(input.amount, currency), fee, supporterCovers: covers });
	} catch (error) {
		// The card fee would take the whole gift
		if (error instanceof MoneyError) throw new CheckoutError(400, 'support_amount_too_small', error.message);
		throw error;
	}
	const t = (m: Money) => formatSupportMoney(locale, m);
	return {
		...b,
		coverFeesChoice: p.collectorFeePayer === 'creatorSupporterMayCover',
		text: { charged: t(b.charged), gift: t(b.gift), coverFees: t(b.coverFees), collectorFee: t(b.collectorFee), tax: t(b.tax), platformFee: t(b.platformFee), creatorReceives: t(b.creatorReceives) },
	};
}

/** The monthly consent line, word for word as it is shown and kept (§2.1; the California standard). */
export function monthlyConsentText(amount: Money, locale: 'en' | 'ar'): string {
	const a = formatSupportMoney(locale, amount);
	return locale === 'ar' ? `اقتطع مني ${a} كل شهر إلى أن أوقف ذلك.` : `Charge me ${a} every month until I stop.`;
}

export interface CheckoutInput {
	kind: 'one_time' | 'monthly';
	amount: number;
	currency: string;
	coverFees: boolean;
	anonymous: boolean;
	message: string | null;
	ageConfirmed: boolean;
	consent: boolean;
	locale: 'en' | 'ar';
	returnUrl: string;
	/** The payment method the sheet showed the fee for ('card', …); null = any. The checkout charges what that quote said. */
	method?: string | null;
}

export async function startSupportCheckout(
	env: SupportAdapterEnv & { SEARCH_DB?: SearchDb },
	who: { userId: string; channelId: string },
	input: CheckoutInput,
	ctx: CollectorContext,
	now: Date,
): Promise<{ checkoutId: string; url: string; quote: Quote }> {
	const db = env.SEARCH_DB!;
	const config = await readSupportConfig(db);
	const q = await quote(env, config, { amount: input.amount, currency: input.currency, supporterTicked: input.coverFees, method: input.method ?? null }, input.locale, ctx, now);
	if (!input.ageConfirmed) throw new CheckoutError(400, 'support_age_required', `Supporters confirm they are ${config.policy.minSupporterAge ?? 18} or over`);
	if (input.kind === 'monthly' && !input.consent) throw new CheckoutError(400, 'support_consent_required', 'Monthly support needs the supporter’s consent');
	const message = input.message?.trim() || null;
	if (message && message.length > SUPPORT_MESSAGE_MAX) throw new CheckoutError(400, 'support_message_too_long', 'Message too long');
	const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
	const recent = await db.prepare('SELECT COUNT(*) AS n FROM support_checkouts WHERE supporter_user_id = ? AND created_at >= ?').bind(who.userId, hourAgo).first<{ n: number }>();
	if (Number(recent?.n ?? 0) >= SUPPORT_CHECKOUTS_PER_HOUR) throw new CheckoutError(429, 'rate_limited', 'Too many checkouts');
	const collector = collectorFor(env, config.collector);
	if (!collector) throw new CheckoutError(409, 'support_currency_unavailable', 'No collector here');
	const checkoutId = `sco_${crypto.randomUUID().replace(/-/g, '')}`;
	const currency = q.gift.currency;
	const consentText = input.kind === 'monthly' ? monthlyConsentText(q.charged, input.locale) : null;
	await db
		.prepare(
			`INSERT INTO support_checkouts (id, supporter_user_id, channel_id, kind, collector, mode, gift, charged, currency, supporter_covers_fees, anonymous, message, consent_text, consent_at, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
		)
		.bind(checkoutId, who.userId, who.channelId, input.kind, config.collector, config.mode, q.gift.amount, q.charged.amount, currency, q.coverFees.amount > 0 ? 1 : 0, input.anonymous ? 1 : 0, message, consentText, consentText ? now.toISOString() : null, now.toISOString())
		.run();
	// A return URL ending in '=' gets this checkout's id, so the page coming back can poll it
	const returnUrl = input.returnUrl.endsWith('=') ? `${input.returnUrl}${checkoutId}` : input.returnUrl;
	const r = await collector.createCheckout(ctx, { checkoutId, kind: input.kind, channelId: who.channelId, supporterUserId: who.userId, charged: q.charged, returnUrl, locale: input.locale });
	await db.prepare('UPDATE support_checkouts SET checkout_ref = ? WHERE id = ?').bind(r.checkoutRef, checkoutId).run();
	return { checkoutId, url: r.url, quote: q };
}

/** The supporter's own checkout (the page they come back to polls it). */
export async function myCheckout(db: SearchDb, userId: string, checkoutId: string): Promise<{ id: string; status: string; kind: string; channelId: string } | null> {
	const r = await db.prepare('SELECT id, status, kind, channel_id FROM support_checkouts WHERE id = ? AND supporter_user_id = ?').bind(checkoutId, userId).first<{ id: string; status: string; kind: string; channel_id: string }>();
	return r ? { id: r.id, status: r.status, kind: r.kind, channelId: r.channel_id } : null;
}

/** Settings › Support: the person's monthly support and their last gifts (newest first). */
export async function mySupport(db: SearchDb, userId: string): Promise<{ pledges: Record<string, unknown>[]; payments: Record<string, unknown>[] }> {
	const [pledges, payments] = await Promise.all([
		db.prepare('SELECT id, channel_id AS channelId, amount, currency, status, anonymous, started_at AS startedAt, current_period_end AS currentPeriodEnd, canceled_at AS canceledAt FROM support_pledges WHERE supporter_user_id = ? ORDER BY created_at DESC LIMIT 100').bind(userId).all<Record<string, unknown>>(),
		db.prepare('SELECT id, channel_id AS channelId, pledge_id AS pledgeId, gross, currency, refunded, status, anonymous, created_at AS createdAt FROM support_payments WHERE supporter_user_id = ? ORDER BY created_at DESC LIMIT 100').bind(userId).all<Record<string, unknown>>(),
	]);
	return { pledges: pledges.results ?? [], payments: payments.results ?? [] };
}

/** Stops a monthly pledge: at the collector first (no further charges), then here. Idempotent. */
export async function stopMyPledge(env: SupportAdapterEnv & { SEARCH_DB?: SearchDb }, userId: string, pledgeId: string, ctxFor: (mode: 'test' | 'live') => CollectorContext, now: Date, reason: CancelReason = 'supporter'): Promise<{ status: string }> {
	const db = env.SEARCH_DB!;
	const p = await db.prepare('SELECT id, collector, mode, collector_pledge_ref, status FROM support_pledges WHERE id = ? AND supporter_user_id = ?').bind(pledgeId, userId).first<{ id: string; collector: string; mode: 'test' | 'live'; collector_pledge_ref: string | null; status: string }>();
	if (!p) throw new CheckoutError(404, 'not_found', 'No such pledge');
	if (p.status === 'canceled' || p.status === 'ended') return { status: p.status };
	const collector = collectorFor(env, p.collector as never);
	if (!collector || !p.collector_pledge_ref) throw new CheckoutError(409, 'support_pledge_ended', 'This monthly support can’t be reached at the payment provider');
	// The pledge's own mode, not today's setting
	await collector.cancelPledge(ctxFor(p.mode), p.collector_pledge_ref, reason);
	// last_event_at moves too: a collector event from before the stop never brings the pledge back
	await db
		.prepare("UPDATE support_pledges SET status = 'canceled', canceled_at = ?, cancel_reason = ?, last_event_at = CASE WHEN last_event_at IS NULL OR last_event_at < ? THEN ? ELSE last_event_at END, updated_at = ? WHERE id = ? AND status IN ('active', 'past_due')")
		.bind(now.toISOString(), reason, now.toISOString(), now.toISOString(), now.toISOString(), p.id)
		.run();
	return { status: 'canceled' };
}

/** Studio › Support: the channel's own settings (owner). Presets are minor units in USD, at or above the minimum. */
export async function saveChannelSupportSettings(db: SearchDb, channelId: string, ownerId: string, input: { enabled?: unknown; oneTime?: unknown; monthly?: unknown; presets?: unknown; currency?: unknown; thankYouNote?: unknown }, now: Date): Promise<Record<string, unknown>> {
	const config = await readSupportConfig(db);
	const presets = input.presets === undefined ? undefined : input.presets;
	// MEM-D4: presets are in one of the currencies the admin set amounts for, at or above its minimum
	const existing = await db.prepare('SELECT currency FROM support_settings WHERE channel_id = ?').bind(channelId).first<{ currency: string }>();
	const currency = typeof input.currency === 'string' ? input.currency.toUpperCase() : (existing?.currency ?? 'USD');
	const rule = isSupportCurrency(currency) ? config.policy.amounts?.[currency] : undefined;
	if ((presets !== undefined || input.currency !== undefined) && !rule) throw new CheckoutError(400, 'invalid_request', 'Support amounts are not set for this currency');
	if (presets !== undefined && (!Array.isArray(presets) || presets.length > 6 || presets.some((x) => !Number.isSafeInteger(x) || (x as number) < rule!.minimum || (x as number) > MAX_AMOUNT_MINOR))) {
		throw new CheckoutError(400, 'invalid_request', 'Presets must be up to 6 whole amounts at or above the minimum');
	}
	const note = input.thankYouNote === undefined ? undefined : input.thankYouNote === null ? null : String(input.thankYouNote).trim().slice(0, 1000);
	const bool = (v: unknown) => (v === undefined ? undefined : v ? 1 : 0);
	const at = now.toISOString();
	await db
		.prepare(
			`INSERT INTO support_settings (channel_id, enabled, one_time_enabled, monthly_enabled, presets, currency, thank_you_note, updated_at, updated_by)
			 VALUES (?, COALESCE(?, 0), COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, '[]'), ?, ?, ?, ?)
			 ON CONFLICT(channel_id) DO UPDATE SET enabled = COALESCE(?, enabled), one_time_enabled = COALESCE(?, one_time_enabled), monthly_enabled = COALESCE(?, monthly_enabled),
			   presets = COALESCE(?, presets), currency = excluded.currency, thank_you_note = CASE WHEN ? = 1 THEN ? ELSE thank_you_note END, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		)
		.bind(
			channelId, bool(input.enabled) ?? null, bool(input.oneTime) ?? null, bool(input.monthly) ?? null, presets === undefined ? null : JSON.stringify(presets), currency, note ?? null, at, ownerId,
			bool(input.enabled) ?? null, bool(input.oneTime) ?? null, bool(input.monthly) ?? null, presets === undefined ? null : JSON.stringify(presets), note === undefined ? 0 : 1, note ?? null,
		)
		.run();
	const row = await db.prepare('SELECT enabled, one_time_enabled AS oneTime, monthly_enabled AS monthly, presets, thank_you_note AS thankYouNote, admin_paused AS adminPaused FROM support_settings WHERE channel_id = ?').bind(channelId).first<Record<string, unknown>>();
	return { ...row, presets: JSON.parse(String(row?.presets ?? '[]')) };
}
