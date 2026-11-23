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
 * Amounts are integer minor units. The checkout currency is USD while the decisions (MEM-D4
 * minimum and presets) are set in USD; other currencies are refused until a rule exists for them.
 */
import { effectiveCoverFees, formatSupportMoney, money, quoteGift, type CollectorFeeSchedule, type GiftBreakdown, type Money, type SearchDb, type SupportCurrency } from '@al-ummah/shared-types';
import { collectorFor, type SupportAdapterEnv } from './adapters';
import type { CancelReason, CollectorContext } from './collector';
import { readSupportConfig, type SupportConfig } from './config';
import { testCollectorFee } from './test-collector';

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
/** Checkouts one account may start per hour (card testing, §2.3); the admin-set daily limits are MEM-D4's sibling settings */
export const SUPPORT_CHECKOUTS_PER_HOUR = 10;

/** The collector's fee schedule for a currency: the admin-set one, or the test collector's fixed one. */
export function feeScheduleFor(env: SupportAdapterEnv, config: SupportConfig, currency: SupportCurrency): CollectorFeeSchedule | null {
	const set = config.collectorFees[currency];
	if (set) return set;
	return config.collector === 'test' && collectorFor(env, 'test') ? testCollectorFee(currency) : null;
}

export interface QuoteInput {
	amount: number;
	currency: string;
	supporterTicked: boolean;
}

export interface Quote extends GiftBreakdown {
	/** The supporter may choose to cover the fees (MEM-D3 'creatorSupporterMayCover') */
	coverFeesChoice: boolean;
	/** The same amounts as text in the asked language, for clients that show them as they are */
	text: Record<'charged' | 'gift' | 'coverFees' | 'collectorFee' | 'tax' | 'platformFee' | 'creatorReceives', string>;
}

/** The breakdown, or a CheckoutError for an amount the rules refuse. */
export function quote(env: SupportAdapterEnv, config: SupportConfig, input: QuoteInput, locale: 'en' | 'ar'): Quote {
	if (input.currency !== 'USD') throw new CheckoutError(400, 'support_currency_unavailable', 'Support is in US dollars for now');
	if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new CheckoutError(400, 'invalid_request', 'Amount must be a whole number of cents');
	const p = config.policy;
	if (p.minimumUsdMinor === null || p.collectorFeePayer === null) throw new CheckoutError(409, 'support_currency_unavailable', 'Support amounts are not set yet');
	if (input.amount < p.minimumUsdMinor) throw new CheckoutError(400, 'support_amount_too_small', 'Below the minimum');
	const fee = feeScheduleFor(env, config, 'USD');
	if (!fee) throw new CheckoutError(409, 'support_currency_unavailable', 'No fee schedule for this currency');
	const covers = effectiveCoverFees(p.collectorFeePayer, input.supporterTicked) as boolean;
	const b = quoteGift({ gift: money(input.amount, 'USD'), fee, supporterCovers: covers });
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
	const q = quote(env, config, { amount: input.amount, currency: input.currency, supporterTicked: input.coverFees }, input.locale);
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
	const consentText = input.kind === 'monthly' ? monthlyConsentText(q.charged, input.locale) : null;
	await db
		.prepare(
			`INSERT INTO support_checkouts (id, supporter_user_id, channel_id, kind, collector, mode, gift, charged, currency, supporter_covers_fees, anonymous, message, consent_text, consent_at, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
		)
		.bind(checkoutId, who.userId, who.channelId, input.kind, config.collector, config.mode, q.gift.amount, q.charged.amount, 'USD', q.coverFees.amount > 0 ? 1 : 0, input.anonymous ? 1 : 0, message, consentText, consentText ? now.toISOString() : null, now.toISOString())
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
export async function stopMyPledge(env: SupportAdapterEnv & { SEARCH_DB?: SearchDb }, userId: string, pledgeId: string, ctx: CollectorContext, now: Date, reason: CancelReason = 'supporter'): Promise<{ status: string }> {
	const db = env.SEARCH_DB!;
	const p = await db.prepare('SELECT id, collector, collector_pledge_ref, status FROM support_pledges WHERE id = ? AND supporter_user_id = ?').bind(pledgeId, userId).first<{ id: string; collector: string; collector_pledge_ref: string | null; status: string }>();
	if (!p) throw new CheckoutError(404, 'not_found', 'No such pledge');
	if (p.status === 'canceled' || p.status === 'ended') return { status: p.status };
	const collector = collectorFor(env, p.collector as never);
	if (!collector || !p.collector_pledge_ref) throw new CheckoutError(409, 'support_pledge_ended', 'This monthly support can’t be reached at the payment provider');
	await collector.cancelPledge(ctx, p.collector_pledge_ref, reason);
	await db.prepare("UPDATE support_pledges SET status = 'canceled', canceled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status IN ('active', 'past_due')").bind(now.toISOString(), reason, now.toISOString(), p.id).run();
	return { status: 'canceled' };
}

/** Studio › Support: the channel's own settings (owner). Presets are minor units in USD, at or above the minimum. */
export async function saveChannelSupportSettings(db: SearchDb, channelId: string, ownerId: string, input: { enabled?: unknown; oneTime?: unknown; monthly?: unknown; presets?: unknown; thankYouNote?: unknown }, now: Date): Promise<Record<string, unknown>> {
	const config = await readSupportConfig(db);
	const min = config.policy.minimumUsdMinor ?? 1;
	const presets = input.presets === undefined ? undefined : input.presets;
	if (presets !== undefined && (!Array.isArray(presets) || presets.length > 6 || presets.some((x) => !Number.isSafeInteger(x) || (x as number) < min || (x as number) > 1_000_000))) {
		throw new CheckoutError(400, 'invalid_request', 'Presets must be up to 6 whole amounts at or above the minimum');
	}
	const note = input.thankYouNote === undefined ? undefined : input.thankYouNote === null ? null : String(input.thankYouNote).trim().slice(0, 1000);
	const bool = (v: unknown) => (v === undefined ? undefined : v ? 1 : 0);
	const at = now.toISOString();
	await db
		.prepare(
			`INSERT INTO support_settings (channel_id, enabled, one_time_enabled, monthly_enabled, presets, currency, thank_you_note, updated_at, updated_by)
			 VALUES (?, COALESCE(?, 0), COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, '[]'), 'USD', ?, ?, ?)
			 ON CONFLICT(channel_id) DO UPDATE SET enabled = COALESCE(?, enabled), one_time_enabled = COALESCE(?, one_time_enabled), monthly_enabled = COALESCE(?, monthly_enabled),
			   presets = COALESCE(?, presets), thank_you_note = CASE WHEN ? = 1 THEN ? ELSE thank_you_note END, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		)
		.bind(
			channelId, bool(input.enabled) ?? null, bool(input.oneTime) ?? null, bool(input.monthly) ?? null, presets === undefined ? null : JSON.stringify(presets), note ?? null, at, ownerId,
			bool(input.enabled) ?? null, bool(input.oneTime) ?? null, bool(input.monthly) ?? null, presets === undefined ? null : JSON.stringify(presets), note === undefined ? 0 : 1, note ?? null,
		)
		.run();
	const row = await db.prepare('SELECT enabled, one_time_enabled AS oneTime, monthly_enabled AS monthly, presets, thank_you_note AS thankYouNote, admin_paused AS adminPaused FROM support_settings WHERE channel_id = ?').bind(channelId).first<Record<string, unknown>>();
	return { ...row, presets: JSON.parse(String(row?.presets ?? '[]')) };
}
