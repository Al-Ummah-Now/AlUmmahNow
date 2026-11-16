/**
 * Subscriptions, payments and webhook events (search D1, migration 0040), and
 * the entitlement rule that turns them into the user's creator tier.
 *
 * Entitlement (syncEntitlement):
 * - A subscription entitles while its status is active, past_due (the provider
 *   is still retrying) or canceled, and its access_until (null = open-ended)
 *   is in the future. A comp is a 'manual' subscription.
 * - The best entitling tier (highest sortOrder) is assigned with source
 *   'subscription'. A tier an admin assigned that ranks at least as high is
 *   kept. A lower admin tier is remembered (restore_tier_id) and comes back
 *   when the subscription ends. The automatic super admin row is never touched.
 * - With nothing entitling, a 'subscription' assignment is replaced by the
 *   remembered admin tier, or removed (Member).
 */
import { recordTierChange } from '../tierChanges';
import {
	SUPER_ADMIN_TIER_ASSIGNER,
	type BillingEventRow,
	type BillingEventStatus,
	type BillingPayment,
	type BillingPaymentStatus,
	type BillingPeriod,
	type BillingProviderId,
	type BillingSubscription,
	type BillingSubscriptionStatus,
	type CreatorTier,
	type PaymentMode,
	type PaymentProviderId,
	DEFAULT_TIER_ID,
} from '@al-ummah/shared-types';
import { assignTier, readAssignment, readTiers } from '../creatorTiers';
import { logger } from '../logger';
import { BillingError, type BillingEnv, linkByRef, readPrice } from './config';
import type { NormalizedEvent, ParsedWebhook, ProviderSubscription } from './provider';

/** Who the automatic tier changes are recorded as. */
export const BILLING_ACTOR = 'system:billing';

function db(env: BillingEnv): D1Database {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB;
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface SubscriptionRow {
	id: string;
	user_id: string;
	tier_id: string;
	tier_name: string;
	provider: string;
	mode: string;
	provider_ref: string | null;
	customer_ref: string | null;
	price_id: string | null;
	status: string;
	period: string | null;
	currency: string | null;
	amount: number | null;
	current_period_end: string | null;
	cancel_at_period_end: number;
	access_until: string | null;
	restore_tier_id: string | null;
	comp_by: string | null;
	comp_reason: string | null;
	last_event_at: string | null;
	entitlement_synced: number;
	reconcile_requested_at: string | null;
	created_at: string;
	updated_at: string;
	ended_at: string | null;
}

export function toSubscription(r: SubscriptionRow): BillingSubscription {
	return {
		id: r.id,
		userId: r.user_id,
		tierId: r.tier_id,
		tierName: r.tier_name,
		provider: r.provider as BillingProviderId,
		mode: r.mode as PaymentMode,
		providerRef: r.provider_ref,
		status: r.status as BillingSubscriptionStatus,
		period: (r.period as BillingPeriod | null) ?? null,
		currency: r.currency,
		amount: r.amount === null ? null : Number(r.amount),
		currentPeriodEnd: r.current_period_end,
		cancelAtPeriodEnd: Number(r.cancel_at_period_end) === 1,
		accessUntil: r.access_until,
		compBy: r.comp_by,
		compReason: r.comp_reason,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		endedAt: r.ended_at,
	};
}

interface PaymentRow {
	id: string;
	user_id: string;
	subscription_id: string | null;
	provider: string;
	mode: string;
	provider_ref: string;
	status: string;
	currency: string;
	amount: number;
	refunded_amount: number;
	receipt_url: string | null;
	occurred_at: string;
}

export const toPayment = (r: PaymentRow): BillingPayment => ({
	id: r.id,
	userId: r.user_id,
	subscriptionId: r.subscription_id,
	provider: r.provider as BillingProviderId,
	mode: r.mode as PaymentMode,
	providerRef: r.provider_ref,
	status: r.status as BillingPaymentStatus,
	currency: r.currency,
	amount: Number(r.amount),
	refundedAmount: Number(r.refunded_amount),
	receiptUrl: r.receipt_url,
	occurredAt: r.occurred_at,
});

interface EventRow {
	id: string;
	provider: string;
	mode: string;
	event_id: string;
	type: string;
	payload: string;
	status: string;
	error: string | null;
	user_id: string | null;
	subscription_id: string | null;
	job_id: string | null;
	received_at: string;
	processed_at: string | null;
}

export const toEventRow = (r: EventRow): BillingEventRow => ({
	id: r.id,
	provider: r.provider as PaymentProviderId,
	mode: r.mode as PaymentMode,
	eventId: r.event_id,
	type: r.type,
	status: r.status as BillingEventStatus,
	error: r.error,
	receivedAt: r.received_at,
	processedAt: r.processed_at,
	jobId: r.job_id,
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function readSubscription(env: BillingEnv, id: string): Promise<SubscriptionRow | null> {
	return db(env).prepare('SELECT * FROM billing_subscriptions WHERE id = ?').bind(id).first<SubscriptionRow>();
}

export async function subscriptionByRef(env: BillingEnv, provider: string, mode: string, ref: string): Promise<SubscriptionRow | null> {
	return db(env).prepare('SELECT * FROM billing_subscriptions WHERE provider = ? AND mode = ? AND provider_ref = ?').bind(provider, mode, ref).first<SubscriptionRow>();
}

export async function userSubscriptions(env: BillingEnv, userId: string): Promise<SubscriptionRow[]> {
	return (await db(env).prepare('SELECT * FROM billing_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(userId).all<SubscriptionRow>()).results ?? [];
}

export async function userPayments(env: BillingEnv, userId: string, limit = 100): Promise<BillingPayment[]> {
	return ((await db(env).prepare('SELECT * FROM billing_payments WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ?').bind(userId, limit).all<PaymentRow>()).results ?? []).map(toPayment);
}

export async function subscriptionPayments(env: BillingEnv, subscriptionId: string): Promise<BillingPayment[]> {
	return ((await db(env).prepare('SELECT * FROM billing_payments WHERE subscription_id = ? ORDER BY occurred_at DESC LIMIT 200').bind(subscriptionId).all<PaymentRow>()).results ?? []).map(toPayment);
}

export async function readPayment(env: BillingEnv, id: string): Promise<BillingPayment | null> {
	const row = await db(env).prepare('SELECT * FROM billing_payments WHERE id = ?').bind(id).first<PaymentRow>();
	return row ? toPayment(row) : null;
}

export async function subscriptionEvents(env: BillingEnv, subscriptionId: string): Promise<BillingEventRow[]> {
	return ((await db(env).prepare('SELECT * FROM billing_events WHERE subscription_id = ? ORDER BY received_at DESC LIMIT 100').bind(subscriptionId).all<EventRow>()).results ?? []).map(toEventRow);
}

export async function readEvent(env: BillingEnv, id: string): Promise<EventRow | null> {
	return db(env).prepare('SELECT * FROM billing_events WHERE id = ?').bind(id).first<EventRow>();
}

/** The admin subscriptions list, newest change first, keyset (updated_at, id). */
export async function listSubscriptions(env: BillingEnv, q: { filter: string; cursor?: string | null; limit?: number }): Promise<{ items: BillingSubscription[]; next: string | null }> {
	const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
	const where: string[] = [];
	const args: unknown[] = [];
	if (q.filter === 'comp') where.push(`provider = 'manual'`);
	else if (q.filter !== 'all') {
		where.push('status = ?');
		args.push(q.filter);
	}
	if (q.cursor) {
		const [at, id] = q.cursor.split('|');
		where.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
		args.push(at, at, id);
	}
	const rows =
		(
			await db(env)
				.prepare(`SELECT * FROM billing_subscriptions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC LIMIT ?`)
				.bind(...args, limit + 1)
				.all<SubscriptionRow>()
		).results ?? [];
	const page = rows.slice(0, limit);
	return { items: page.map(toSubscription), next: rows.length > limit ? `${page.at(-1)!.updated_at}|${page.at(-1)!.id}` : null };
}

export async function counts(env: BillingEnv): Promise<{ active: number; pastDue: number; failedEvents: number }> {
	const [a, p, f] = await db(env).batch([
		db(env).prepare(`SELECT COUNT(*) AS n FROM billing_subscriptions WHERE status = 'active'`),
		db(env).prepare(`SELECT COUNT(*) AS n FROM billing_subscriptions WHERE status = 'past_due'`),
		db(env).prepare(`SELECT COUNT(*) AS n FROM billing_events WHERE status = 'failed'`),
	]);
	const n = (r: D1Result) => Number((r.results?.[0] as { n?: number } | undefined)?.n ?? 0);
	return { active: n(a), pastDue: n(p), failedEvents: n(f) };
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

/** Stores a verified webhook once. `duplicate`: the provider sent it before (answer 200, do nothing). */
export async function recordWebhook(env: BillingEnv, provider: PaymentProviderId, mode: PaymentMode, parsed: ParsedWebhook, now = new Date().toISOString()): Promise<{ id: string; duplicate: boolean }> {
	const id = newId('bev');
	const result = await db(env)
		.prepare(
			`INSERT INTO billing_events (id, provider, mode, event_id, type, payload, status, received_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
			 ON CONFLICT (provider, mode, event_id) DO NOTHING`,
		)
		.bind(id, provider, mode, parsed.eventId.slice(0, 200), parsed.type.slice(0, 100), JSON.stringify(parsed.payload), now)
		.run();
	if ((result.meta?.changes ?? 0) > 0) return { id, duplicate: false };
	const existing = await db(env).prepare('SELECT id FROM billing_events WHERE provider = ? AND mode = ? AND event_id = ?').bind(provider, mode, parsed.eventId.slice(0, 200)).first<{ id: string }>();
	return { id: existing?.id ?? id, duplicate: true };
}

export async function setEventJob(env: BillingEnv, eventId: string, jobId: string) {
	await db(env).prepare('UPDATE billing_events SET job_id = ? WHERE id = ?').bind(jobId, eventId).run();
}

export async function finishEvent(env: BillingEnv, eventId: string, fields: { status: BillingEventStatus; error?: string | null; userId?: string | null; subscriptionId?: string | null }, now = new Date().toISOString()) {
	await db(env)
		.prepare('UPDATE billing_events SET status = ?, error = ?, user_id = COALESCE(?, user_id), subscription_id = COALESCE(?, subscription_id), processed_at = ? WHERE id = ?')
		.bind(fields.status, fields.error ?? null, fields.userId ?? null, fields.subscriptionId ?? null, now, eventId)
		.run();
}

// ---------------------------------------------------------------------------
// Customers and checkouts
// ---------------------------------------------------------------------------

export async function customerFor(env: BillingEnv, userId: string, provider: PaymentProviderId, mode: PaymentMode): Promise<string | null> {
	const row = await db(env).prepare('SELECT provider_ref FROM billing_customers WHERE user_id = ? AND provider = ? AND mode = ? ORDER BY created_at DESC LIMIT 1').bind(userId, provider, mode).first<{ provider_ref: string }>();
	return row?.provider_ref ?? null;
}

export async function userOfCustomer(env: BillingEnv, provider: string, mode: string, customerRef: string): Promise<string | null> {
	const row = await db(env).prepare('SELECT user_id FROM billing_customers WHERE provider = ? AND mode = ? AND provider_ref = ?').bind(provider, mode, customerRef).first<{ user_id: string }>();
	return row?.user_id ?? null;
}

export async function saveCustomer(env: BillingEnv, provider: string, mode: string, customerRef: string, userId: string, now = new Date().toISOString()) {
	await db(env).prepare('INSERT INTO billing_customers (provider, mode, provider_ref, user_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(provider, mode, customerRef, userId, now).run();
}

export interface CheckoutRow {
	id: string;
	user_id: string;
	tier_id: string;
	price_id: string;
	provider: string;
	mode: string;
	provider_ref: string | null;
	status: string;
	created_at: string;
	completed_at: string | null;
}

export async function createCheckoutRow(env: BillingEnv, row: Omit<CheckoutRow, 'status' | 'completed_at' | 'provider_ref'>) {
	await db(env)
		.prepare(`INSERT INTO billing_checkouts (id, user_id, tier_id, price_id, provider, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
		.bind(row.id, row.user_id, row.tier_id, row.price_id, row.provider, row.mode, row.created_at)
		.run();
}

export async function setCheckoutRef(env: BillingEnv, id: string, providerRef: string | null) {
	await db(env).prepare('UPDATE billing_checkouts SET provider_ref = ? WHERE id = ?').bind(providerRef, id).run();
}

export async function readCheckout(env: BillingEnv, id: string): Promise<CheckoutRow | null> {
	return db(env).prepare('SELECT * FROM billing_checkouts WHERE id = ?').bind(id).first<CheckoutRow>();
}

/** Open checkouts of a price (PayGood fallback match), newest first, in the last `hours`. */
async function openCheckoutsFor(env: BillingEnv, provider: string, mode: string, priceId: string, sinceIso: string): Promise<CheckoutRow[]> {
	return (
		(
			await db(env)
				.prepare(`SELECT * FROM billing_checkouts WHERE provider = ? AND mode = ? AND price_id = ? AND status = 'open' AND created_at >= ? ORDER BY created_at DESC LIMIT 5`)
				.bind(provider, mode, priceId, sinceIso)
				.all<CheckoutRow>()
		).results ?? []
	);
}

// ---------------------------------------------------------------------------
// Applying events
// ---------------------------------------------------------------------------

/** The event cannot be tied to a user or tier: retrying will not help, an admin has to look. */
export class UnmatchedEventError extends Error {}

const ENTITLING: BillingSubscriptionStatus[] = ['active', 'past_due', 'canceled'];

interface Resolved {
	userId: string;
	tierId: string;
	tierName: string;
	priceId: string | null;
	checkoutId: string | null;
}

async function tierName(env: BillingEnv, tierId: string): Promise<string> {
	return (await readTiers(db(env))).find((t) => t.id === tierId)?.name ?? tierId;
}

/** Who and which tier a provider subscription belongs to. */
async function resolveOwner(env: BillingEnv, provider: PaymentProviderId, mode: PaymentMode, event: NormalizedEvent, sub: Partial<ProviderSubscription>, existing: SubscriptionRow | null, now: Date): Promise<Resolved> {
	const link = sub.priceRef ? await linkByRef(env, provider, mode, sub.priceRef) : null;
	const price = link ? await readPrice(env, link.price_id) : null;
	const checkoutId = event.checkoutId ?? sub.checkoutId ?? null;
	const checkout = checkoutId ? await readCheckout(env, checkoutId) : null;
	let userId = existing?.user_id ?? null;
	// Our own ids echoed back (Paddle custom_data, the test provider): only when the checkout agrees
	if (!userId && checkout && checkout.provider === provider && (!event.userId || event.userId === checkout.user_id)) userId = checkout.user_id;
	const customerRef = event.customerRef ?? sub.customerRef ?? null;
	if (!userId && customerRef) userId = await userOfCustomer(env, provider, mode, customerRef);
	let matchedCheckout = checkout;
	// PayGood's hosted checkout may make its own customer: the one open checkout of this price in the last 2 hours
	if (!userId && price) {
		const since = new Date(now.getTime() - 2 * 3600_000).toISOString();
		const open = await openCheckoutsFor(env, provider, mode, price.id, since);
		const users = new Set(open.map((c) => c.user_id));
		if (users.size === 1) {
			userId = open[0].user_id;
			matchedCheckout = open[0];
		} else if (users.size > 1) {
			throw new UnmatchedEventError(`Several open checkouts match subscription ${sub.ref}; link it to the right user`);
		}
	}
	if (!userId) throw new UnmatchedEventError(`No user matches subscription ${sub.ref}`);
	const tierId = price?.tierId ?? existing?.tier_id ?? checkout?.tier_id ?? null;
	if (!tierId) throw new UnmatchedEventError(`No tier matches subscription ${sub.ref} (unknown price ${sub.priceRef ?? 'none'})`);
	return { userId, tierId, tierName: existing?.tier_id === tierId ? existing.tier_name : await tierName(env, tierId), priceId: price?.id ?? existing?.price_id ?? null, checkoutId: matchedCheckout?.id ?? null };
}

/** Applies one subscription.updated event; returns the subscription row id and user. */
async function applySubscription(env: BillingEnv, provider: PaymentProviderId, mode: PaymentMode, event: NormalizedEvent, now: Date): Promise<{ subscriptionId: string; userId: string }> {
	const sub = event.subscription!;
	const at = now.toISOString();
	const existing = await subscriptionByRef(env, provider, mode, sub.ref);
	const owner = await resolveOwner(env, provider, mode, event, sub, existing, now);
	const customerRef = event.customerRef ?? sub.customerRef ?? existing?.customer_ref ?? null;
	if (customerRef) await saveCustomer(env, provider, mode, customerRef, owner.userId, at);
	if (owner.checkoutId) await db(env).prepare(`UPDATE billing_checkouts SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'open'`).bind(at, owner.checkoutId).run();

	// Out of order: an older event than the last applied one never moves the status back
	const stale = !!existing?.last_event_at && event.occurredAt < existing.last_event_at;
	const providerStatus = sub.status;
	let status = (existing?.status as BillingSubscriptionStatus | undefined) ?? 'pending';
	let accessUntil = existing?.access_until ?? null;
	let endedAt = existing?.ended_at ?? null;
	const periodEnd = sub.currentPeriodEnd ?? existing?.current_period_end ?? null;
	const cancelAtPeriodEnd = stale ? Number(existing?.cancel_at_period_end ?? 0) === 1 : sub.cancelAtPeriodEnd ?? Number(existing?.cancel_at_period_end ?? 0) === 1;
	if (!stale && providerStatus) {
		status = providerStatus;
		if (providerStatus === 'active' || providerStatus === 'past_due' || providerStatus === 'pending') {
			// Set to cancel at period end: access stops then even if the final event is lost (the sweep ends it)
			accessUntil = cancelAtPeriodEnd && periodEnd ? periodEnd : null;
			endedAt = null;
		} else if (providerStatus === 'canceled') {
			// Billing stopped now (PayGood): the paid period is kept
			accessUntil = periodEnd && periodEnd > at ? periodEnd : at;
		} else if (providerStatus === 'ended') {
			accessUntil = at;
			endedAt = endedAt ?? at;
		}
	}
	const lastEventAt = stale ? existing!.last_event_at : event.occurredAt;
	const id = existing?.id ?? newId('bsub');
	await db(env)
		.prepare(
			`INSERT INTO billing_subscriptions (id, user_id, tier_id, tier_name, provider, mode, provider_ref, customer_ref, price_id, status, period, currency, amount,
			   current_period_end, cancel_at_period_end, access_until, last_event_at, entitlement_synced, created_at, updated_at, ended_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET tier_id = excluded.tier_id, tier_name = excluded.tier_name, customer_ref = excluded.customer_ref,
			   price_id = excluded.price_id, status = excluded.status, period = excluded.period, currency = excluded.currency, amount = excluded.amount,
			   current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, access_until = excluded.access_until,
			   last_event_at = excluded.last_event_at, entitlement_synced = 0, updated_at = excluded.updated_at, ended_at = excluded.ended_at`,
		)
		.bind(
			id,
			owner.userId,
			owner.tierId,
			owner.tierName,
			provider,
			mode,
			sub.ref,
			customerRef,
			owner.priceId,
			status,
			sub.period ?? existing?.period ?? null,
			sub.currency ?? existing?.currency ?? null,
			sub.amount ?? existing?.amount ?? null,
			periodEnd,
			cancelAtPeriodEnd ? 1 : 0,
			accessUntil,
			lastEventAt,
			existing?.created_at ?? at,
			at,
			endedAt,
		)
		.run();
	return { subscriptionId: id, userId: owner.userId };
}

async function applyPayment(env: BillingEnv, provider: PaymentProviderId, mode: PaymentMode, event: NormalizedEvent, now: Date): Promise<{ subscriptionId: string | null; userId: string }> {
	const p = event.payment!;
	const at = now.toISOString();
	const sub = event.subscriptionRef ? await subscriptionByRef(env, provider, mode, event.subscriptionRef) : null;
	const existing = await db(env).prepare('SELECT * FROM billing_payments WHERE provider = ? AND mode = ? AND provider_ref = ?').bind(provider, mode, p.ref).first<PaymentRow>();
	if (event.type === 'payment.refunded') {
		if (!existing) throw new Error(`Refund for unknown payment ${p.ref}; retrying until the payment is recorded`);
		const refunded = Math.min(Number(existing.amount), Number(existing.refunded_amount) + (p.refundedAmount ?? 0));
		const status: BillingPaymentStatus = refunded >= Number(existing.amount) ? 'refunded' : refunded > 0 ? 'partially_refunded' : (existing.status as BillingPaymentStatus);
		await db(env).prepare('UPDATE billing_payments SET refunded_amount = ?, status = ? WHERE id = ?').bind(refunded, status, existing.id).run();
		return { subscriptionId: existing.subscription_id, userId: existing.user_id };
	}
	let userId = sub?.user_id ?? null;
	if (!userId && event.checkoutId) {
		const checkout = await readCheckout(env, event.checkoutId);
		if (checkout?.provider === provider) userId = checkout.user_id;
	}
	if (!userId && event.customerRef) userId = await userOfCustomer(env, provider, mode, event.customerRef);
	if (!userId) {
		// The subscription event may simply not have been applied yet (no ordering guarantee): retry
		if (event.subscriptionRef) throw new Error(`Payment ${p.ref} for subscription ${event.subscriptionRef} arrived first; retrying`);
		throw new UnmatchedEventError(`No user matches payment ${p.ref}`);
	}
	const status: BillingPaymentStatus = event.type === 'payment.failed' ? 'failed' : 'succeeded';
	if (existing) {
		if (existing.status === 'failed' && status === 'succeeded') await db(env).prepare(`UPDATE billing_payments SET status = 'succeeded', occurred_at = ? WHERE id = ?`).bind(event.occurredAt, existing.id).run();
		return { subscriptionId: existing.subscription_id, userId: existing.user_id };
	}
	await db(env)
		.prepare(
			`INSERT INTO billing_payments (id, user_id, subscription_id, provider, mode, provider_ref, status, currency, amount, refunded_amount, receipt_url, occurred_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT (provider, mode, provider_ref) DO NOTHING`,
		)
		.bind(newId('bpay'), userId, sub?.id ?? null, provider, mode, p.ref, status, p.currency, p.amount, p.receiptUrl ?? null, event.occurredAt || at)
		.run();
	return { subscriptionId: sub?.id ?? null, userId };
}

/**
 * Applies a webhook's normalized events (idempotent: subscriptions and
 * payments are keyed by the provider's ids, so a redelivery changes nothing)
 * and brings each touched user's tier in line.
 */
export async function applyEvents(env: BillingEnv, provider: PaymentProviderId, mode: PaymentMode, events: NormalizedEvent[], now = new Date()): Promise<{ userIds: string[]; subscriptionId: string | null; ignored: boolean }> {
	const users = new Set<string>();
	let subscriptionId: string | null = null;
	let applied = 0;
	// Subscription state first: a payment in the same webhook refers to it
	const ordered = [...events].sort((a, b) => Number(b.type === 'subscription.updated') - Number(a.type === 'subscription.updated'));
	for (const event of ordered) {
		if (event.type === 'ignored') continue;
		applied++;
		const r = event.type === 'subscription.updated' ? await applySubscription(env, provider, mode, event, now) : await applyPayment(env, provider, mode, event, now);
		users.add(r.userId);
		subscriptionId = subscriptionId ?? r.subscriptionId;
	}
	for (const userId of users) await syncEntitlement(env, userId, now);
	return { userIds: [...users], subscriptionId, ignored: applied === 0 };
}

// ---------------------------------------------------------------------------
// Local state changes after an admin or user action (the provider confirmed)
// ---------------------------------------------------------------------------

export async function markCanceled(env: BillingEnv, id: string, opts: { atPeriodEnd: boolean }, now = new Date()) {
	const row = await readSubscription(env, id);
	if (!row) throw new BillingError(404, 'billing_not_found');
	const at = now.toISOString();
	if (opts.atPeriodEnd && row.current_period_end && row.current_period_end > at) {
		// Access runs to the period end even if the provider's final event never arrives (the sweep ends it)
		await db(env)
			.prepare('UPDATE billing_subscriptions SET cancel_at_period_end = 1, access_until = current_period_end, updated_at = ?, entitlement_synced = 0 WHERE id = ?')
			.bind(at, id)
			.run();
	} else {
		const ended = !opts.atPeriodEnd;
		const until = ended ? at : row.current_period_end && row.current_period_end > at ? row.current_period_end : at;
		await db(env)
			.prepare(`UPDATE billing_subscriptions SET status = ?, access_until = ?, cancel_at_period_end = 0, ended_at = CASE WHEN ? THEN ? ELSE ended_at END, updated_at = ?, entitlement_synced = 0 WHERE id = ?`)
			.bind(ended ? 'ended' : 'canceled', until, ended ? 1 : 0, at, at, id)
			.run();
	}
	await syncEntitlement(env, row.user_id, now);
	return toSubscription((await readSubscription(env, id))!);
}

export async function markRefunded(env: BillingEnv, paymentId: string, amount: number | null) {
	const p = await readPayment(env, paymentId);
	if (!p) throw new BillingError(404, 'billing_not_found');
	const refunded = Math.min(p.amount, amount === null ? p.amount : p.refundedAmount + amount);
	await db(env)
		.prepare('UPDATE billing_payments SET refunded_amount = ?, status = ? WHERE id = ?')
		.bind(refunded, refunded >= p.amount ? 'refunded' : 'partially_refunded', paymentId)
		.run();
	return (await readPayment(env, paymentId))!;
}

/** Admin comp: a 'manual' subscription that entitles until `until` (null: until ended). */
export async function createComp(env: BillingEnv, input: { userId: string; tierId: string; until: string | null; reason: string }, actorId: string, now = new Date()) {
	const tiers = await readTiers(db(env));
	const tier = tiers.find((t) => t.id === input.tierId);
	if (!tier) throw new BillingError(404, 'tier_not_found', 'No such tier');
	const at = now.toISOString();
	if (input.until !== null && input.until <= at) throw new BillingError(400, 'invalid_billing_request', 'until must be in the future');
	const id = newId('bsub');
	await db(env)
		.prepare(
			`INSERT INTO billing_subscriptions (id, user_id, tier_id, tier_name, provider, mode, status, access_until, current_period_end, comp_by, comp_reason, last_event_at, entitlement_synced, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'manual', 'live', 'active', ?, ?, ?, ?, ?, 0, ?, ?)`,
		)
		.bind(id, input.userId, tier.id, tier.name, input.until, input.until, actorId, input.reason, at, at, at)
		.run();
	await syncEntitlement(env, input.userId, now);
	return toSubscription((await readSubscription(env, id))!);
}

// ---------------------------------------------------------------------------
// Entitlement
// ---------------------------------------------------------------------------

const rank = (tiers: CreatorTier[], id: string | null | undefined) => {
	const t = tiers.find((x) => x.id === id);
	return t ? (t.unlimited ? Number.MAX_SAFE_INTEGER : t.sortOrder) : -1;
};

export function entitles(row: Pick<SubscriptionRow, 'status' | 'access_until'>, at: string): boolean {
	return ENTITLING.includes(row.status as BillingSubscriptionStatus) && (row.access_until === null || row.access_until > at);
}

/** Brings the user's creator tier in line with their subscriptions. */
export async function syncEntitlement(env: BillingEnv, userId: string, now = new Date()): Promise<{ from: string | null; to: string | null; changed: boolean }> {
	const at = now.toISOString();
	const [subs, tiers, current] = await Promise.all([userSubscriptions(env, userId), readTiers(db(env)), readAssignment(db(env), userId)]);
	const markSynced = () => db(env).prepare('UPDATE billing_subscriptions SET entitlement_synced = 1 WHERE user_id = ?').bind(userId).run();
	const from = current?.tierId ?? null;
	if (current?.assignedBy === SUPER_ADMIN_TIER_ASSIGNER) {
		await markSynced();
		return { from, to: from, changed: false };
	}
	const entitling = subs.filter((s) => entitles(s, at) && tiers.some((t) => t.id === s.tier_id)).sort((a, b) => rank(tiers, b.tier_id) - rank(tiers, a.tier_id));
	const best = entitling[0] ?? null;
	if (best) {
		if (current?.source === 'subscription' && current.tierId === best.tier_id) {
			await markSynced();
			return { from, to: from, changed: false };
		}
		if (current?.source === 'admin' && rank(tiers, current.tierId) >= rank(tiers, best.tier_id)) {
			await markSynced();
			return { from, to: from, changed: false };
		}
		if (current?.source === 'admin' && !best.restore_tier_id) {
			await db(env).prepare('UPDATE billing_subscriptions SET restore_tier_id = ? WHERE id = ?').bind(current.tierId, best.id).run();
		}
		await assignTier(db(env), userId, best.tier_id, BILLING_ACTOR, 'subscription', at);
		await recordTierChange(env as never, { userId, from: from ?? DEFAULT_TIER_ID, to: best.tier_id, reason: 'subscription' }, now);
		await markSynced();
		logger.info('[Billing] Tier assigned from a subscription', { userId, from, to: best.tier_id, subscriptionId: best.id });
		return { from, to: best.tier_id, changed: true };
	}
	if (current?.source === 'subscription') {
		const restore = subs.find((s) => s.restore_tier_id && tiers.some((t) => t.id === s.restore_tier_id))?.restore_tier_id ?? null;
		await assignTier(db(env), userId, restore, BILLING_ACTOR, 'admin', at);
		await recordTierChange(env as never, { userId, from, to: restore ?? DEFAULT_TIER_ID, reason: 'subscription' }, now);
		await markSynced();
		logger.info('[Billing] Subscription tier ended', { userId, from, to: restore });
		return { from, to: restore, changed: true };
	}
	await markSynced();
	return { from, to: from, changed: false };
}

/**
 * The sweep (every 10 minutes): subscriptions whose access ran out or that
 * changed without a sync get their user's tier brought in line; manual comps
 * past their date end. Bounded per run; the next run continues.
 */
export async function sweepEntitlements(env: BillingEnv, now = new Date(), limit = 50): Promise<{ synced: number; ended: number }> {
	const at = now.toISOString();
	// Time is up: manual comps past their date, canceled subscriptions, and ones set to cancel at period end
	const ended = await db(env)
		.prepare(
			`UPDATE billing_subscriptions SET status = 'ended', ended_at = COALESCE(ended_at, access_until), updated_at = ?, entitlement_synced = 0
			 WHERE access_until IS NOT NULL AND access_until <= ?
			   AND (status = 'canceled' OR (status IN ('active', 'past_due') AND (provider = 'manual' OR cancel_at_period_end = 1)))`,
		)
		.bind(at, at)
		.run();
	const due = (await db(env).prepare('SELECT DISTINCT user_id FROM billing_subscriptions WHERE entitlement_synced = 0 LIMIT ?').bind(limit).all<{ user_id: string }>()).results ?? [];
	let synced = 0;
	for (const { user_id } of due) {
		try {
			await syncEntitlement(env, user_id, now);
			synced++;
		} catch (error) {
			logger.error('[Billing] Entitlement sync failed', { userId: user_id, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { synced, ended: Number(ended.meta?.changes ?? 0) };
}

/** Active provider subscriptions whose period ended 2+ days ago without a renewal event: ask the provider (reconcile job). */
export async function staleSubscriptions(env: BillingEnv, now = new Date(), limit = 20): Promise<SubscriptionRow[]> {
	const cutoff = new Date(now.getTime() - 2 * 86400_000).toISOString();
	const again = new Date(now.getTime() - 86400_000).toISOString();
	return (
		(
			await db(env)
				.prepare(
					`SELECT * FROM billing_subscriptions WHERE provider NOT IN ('manual', 'fake') AND status IN ('active', 'past_due')
					 AND current_period_end IS NOT NULL AND current_period_end < ? AND (reconcile_requested_at IS NULL OR reconcile_requested_at < ?) LIMIT ?`,
				)
				.bind(cutoff, again, limit)
				.all<SubscriptionRow>()
		).results ?? []
	);
}

export async function markReconcileRequested(env: BillingEnv, id: string, now = new Date().toISOString()) {
	await db(env).prepare('UPDATE billing_subscriptions SET reconcile_requested_at = ? WHERE id = ?').bind(now, id).run();
}
