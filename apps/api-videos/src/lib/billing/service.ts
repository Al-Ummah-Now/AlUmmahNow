/**
 * Billing service (wiki AUN-SUBS): what the routes and the queue call.
 *
 *   webhook  → verify signature → store once (billing_events, idempotent)
 *            → job 'billing.webhook' on the admin-jobs queue → 200
 *   job      → normalize (adapter) → apply (store.ts) → entitlement → tier
 *            → transient error: retry with backoff; last attempt, unmatched
 *              event or a refusal from the provider: the event is 'failed' and
 *              the admin's Errors page gets an item with Retry
 *   checkout → price + provider check → checkout row → adapter → URL
 *   admin    → cancel / refund / sync prices run as jobs (retried, flagged);
 *              comps and settings are direct D1 writes (audited in admin-api)
 */
import {
	BILLING_ERRORS,
	PAYMENT_PROVIDERS,
	reportNeedsAction,
	resolveNeedsAction,
	type AdminJob,
	type BillingCheckout,
	type BillingCheckoutInput,
	type BillingOffer,
	type BillingPlans,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type MyBilling,
	type PaymentMode,
	type PaymentProviderId,
	type MyCheckout,
} from '@al-ummah/shared-types';
import { readTiers } from '../creatorTiers';
import { logger } from '../logger';
import { createJob, type JobEnv, type JobOutcome } from '../admin/jobs';
import {
	assertProvider,
	availableProviders,
	BillingError,
	type BillingEnv,
	enabledProviders,
	isProductionEnv,
	linkFor,
	providerContext,
	providerTakesCurrency,
	readCredential,
	readPrice,
	readPrices,
	readProvider,
	readTax,
	sellableLink,
	writeLink,
} from './config';
import { fakeAdapter, fakePaymentEvents, signFake } from './fake';
import { paddleAdapter } from './paddle';
import { paygoodAdapter } from './paygood';
import { type NormalizedEvent, type PaymentProviderAdapter, type ProviderContext, ProviderError } from './provider';
import {
	applyEvents,
	createCheckoutRow,
	customerFor,
	finishEvent,
	markCanceled,
	markReconcileRequested,
	markRefunded,
	readCheckout,
	readEvent,
	readPayment,
	readSubscription,
	recordWebhook,
	saveCustomer,
	setCheckoutRef,
	setEventJob,
	staleSubscriptions,
	toSubscription,
	UnmatchedEventError,
	userPayments,
	userSubscriptions,
	expireCheckout,
} from './store';

export type ServiceEnv = BillingEnv & JobEnv & ErrorReporterEnv;

const ADAPTERS: Record<PaymentProviderId, PaymentProviderAdapter> = { paddle: paddleAdapter, paygood: paygoodAdapter, fake: fakeAdapter };

export function adapterFor(id: PaymentProviderId): PaymentProviderAdapter {
	return ADAPTERS[id];
}

/** Test seam: the adapters can be swapped in unit tests. */
export function setAdapterForTests(id: PaymentProviderId, adapter: PaymentProviderAdapter): void {
	ADAPTERS[id] = adapter;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

// ---------------------------------------------------------------------------
// Needs-action items (admin Errors page)
// ---------------------------------------------------------------------------

export const jobNeedsActionKey = (jobId: string) => `billing-job:${jobId}`;

const JOB_TITLES: Record<string, string> = {
	'billing.webhook': 'Payment webhook not applied',
	'billing.sync-prices': 'Prices not synced to the payment provider',
	'billing.cancel': 'Subscription not canceled at the payment provider',
	'billing.refund': 'Refund not issued',
	'billing.reconcile': 'Subscription could not be checked with the payment provider',
};

/** A billing job gave up: flag the admin with a Retry that queues the job again. */
export function flagBillingJob(env: ServiceEnv, ctx: ExecutionContextLike | undefined, job: Pick<AdminJob, 'id' | 'kind' | 'targetId'>, error: string): void {
	reportNeedsAction('api-videos', env, ctx, {
		key: jobNeedsActionKey(job.id),
		source: 'admin-job',
		title: JOB_TITLES[job.kind] ?? 'Payment job failed',
		message: error.slice(0, 500),
		itemType: 'billing-job',
		itemId: job.id,
		itemUrl: '/payments',
		// The kind lets admin-api require the action's own permission on Retry (refunds: billing:refund)
		retry: { kind: 'service', service: 'api-videos', path: '/internal/billing/jobs/retry', body: { jobId: job.id, kind: job.kind } },
		retryLabel: 'Retry',
		extra: { kind: job.kind, target: job.targetId },
	});
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookOutcome = { status: 200; duplicate: boolean; eventId: string } | { status: 401 | 404 | 503; error: string };

/**
 * Verifies and stores a webhook, then queues its processing. Webhooks are
 * accepted while the provider has a webhook secret in either mode, even when
 * it is disabled: renewals and cancellations of existing subscribers still
 * have to land.
 */
export async function receiveWebhook(env: ServiceEnv, providerId: string, rawBody: string, headers: Headers, now = new Date()): Promise<WebhookOutcome> {
	let provider: PaymentProviderId;
	try {
		provider = assertProvider(env, providerId);
	} catch {
		return { status: 404, error: 'Unknown provider' };
	}
	const cfg = await readProvider(env, provider);
	const modes: PaymentMode[] = cfg.mode === 'live' ? ['live', 'test'] : ['test', 'live'];
	const adapter = adapterFor(provider);
	let any = false;
	for (const mode of provider === 'fake' ? (['test'] as PaymentMode[]) : modes) {
		const secret = await readCredential(env, provider, 'webhookSecret', mode);
		if (!secret) continue;
		any = true;
		const parsed = await adapter.verifyWebhook(rawBody, headers, secret, now);
		if (!parsed) continue;
		const { id, duplicate } = await recordWebhook(env, provider, mode, parsed, now.toISOString());
		if (!duplicate) {
			const job = await createJob(env, { kind: 'billing.webhook', targetKind: 'billing', targetId: id, params: { eventId: id }, actorId: `webhook:${provider}` });
			await setEventJob(env, id, job.id);
		}
		return { status: 200, duplicate, eventId: id };
	}
	// No secret at all: not configured here (404 so the provider's dashboard shows it); a wrong signature: 401
	if (!any) return { status: 404, error: 'Provider not configured' };
	logger.warn('[Billing] Webhook signature refused', { provider });
	return { status: 401, error: 'Invalid signature' };
}

/** A context for normalizing: credentials when there are some (PayGood needs them, Paddle and the test provider do not). */
async function normalizeContext(env: ServiceEnv, provider: PaymentProviderId, mode: PaymentMode): Promise<ProviderContext> {
	try {
		return await providerContext(env, provider, { mode });
	} catch {
		return { mode, apiKey: '', settings: {}, tax: { pricesIncludeTax: true }, fetch };
	}
}

/** Job 'billing.webhook': apply one stored event. */
export async function runWebhookJob(env: ServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const eventId = String(job.params.eventId ?? job.targetId);
	const row = await readEvent(env, eventId);
	if (!row) return { done: true, result: { skipped: 'event gone' } };
	if (row.status === 'processed' || row.status === 'ignored') return { done: true, result: { skipped: row.status } };
	const provider = row.provider as PaymentProviderId;
	const mode = row.mode as PaymentMode;
	let events: NormalizedEvent[];
	try {
		const parsed = { eventId: row.event_id, type: row.type, occurredAt: row.received_at, payload: JSON.parse(row.payload) };
		const occurred = (parsed.payload as { occurred_at?: string; createdAt?: string; data?: { occurredAt?: string } })?.occurred_at ?? (parsed.payload as { data?: { occurredAt?: string } })?.data?.occurredAt ?? (parsed.payload as { createdAt?: string })?.createdAt;
		if (occurred && Number.isFinite(Date.parse(occurred))) parsed.occurredAt = new Date(occurred).toISOString();
		events = await adapterFor(provider).normalize(parsed, await normalizeContext(env, provider, mode));
		const result = await applyEvents(env, provider, mode, events);
		await finishEvent(env, eventId, { status: result.ignored ? 'ignored' : 'processed', userId: result.userIds[0] ?? null, subscriptionId: result.subscriptionId });
		resolveNeedsAction(env, undefined, jobNeedsActionKey(job.id));
		return { done: true, result: { applied: events.filter((e) => e.type !== 'ignored').length, users: result.userIds.length } };
	} catch (error) {
		// Retrying will not help: mark it failed and flag the admin now (Retry runs it again once fixed)
		if (error instanceof UnmatchedEventError || (error instanceof ProviderError && error.permanent)) {
			await finishEvent(env, eventId, { status: 'failed', error: errorText(error) });
			flagBillingJob(env, undefined, job, errorText(error));
			logger.error('[Billing] Webhook event cannot be applied', { eventId, provider, error: errorText(error) });
			return { done: true, result: { failed: errorText(error) } };
		}
		throw error;
	}
}

/** Called when any billing job fails for good (last queue attempt). */
export async function onBillingJobFailed(env: ServiceEnv, job: AdminJob, error: string): Promise<void> {
	if (job.kind === 'billing.webhook') {
		await finishEvent(env, String(job.params.eventId ?? job.targetId), { status: 'failed', error }).catch(() => undefined);
	}
	flagBillingJob(env, undefined, job, error);
}

// ---------------------------------------------------------------------------
// Public: plans for /upgrade
// ---------------------------------------------------------------------------

export async function billingPlans(env: ServiceEnv): Promise<BillingPlans> {
	// No per-tier switch: with a provider enabled every priced tier sells (owner rule 2026-11-15, UPGRADE_MODES)
	const [providers, prices, tax, tiers] = await Promise.all([enabledProviders(env), readPrices(env), readTax(env), readTiers(env.SEARCH_DB as D1Database)]);
	const offers: BillingOffer[] = [];
	if (providers.length) {
		for (const tier of tiers) {
			const sellable = prices
				.filter((p) => p.tierId === tier.id && p.active)
				.map((p) => ({ period: p.period, currency: p.currency, amount: p.amount, providers: providers.filter((cfg) => providerTakesCurrency(cfg.id, p.currency) && sellableLink(p, cfg.id, cfg.mode)).map((cfg) => cfg.id) }))
				.filter((p) => p.providers.length > 0);
			if (sellable.length) offers.push({ tierId: tier.id, prices: sellable });
		}
	}
	const paddle = providers.find((p) => p.id === 'paddle');
	const clientToken = paddle?.settings[`clientToken.${paddle.mode}`];
	return {
		providers: providers.map((p) => ({ id: p.id, name: PAYMENT_PROVIDERS[p.id].name, mode: p.mode })),
		offers,
		pricesIncludeTax: tax.pricesIncludeTax,
		taxRatePercent: tax.taxRatePercent,
		paddle: paddle && clientToken ? { clientToken, environment: paddle.mode === 'live' ? 'production' : 'sandbox' } : null,
	};
}

/** Tiers with a price someone can pay now; empty (one read) while no provider is enabled. */
export async function soldTierIds(env: ServiceEnv): Promise<Set<string>> {
	if (!(await enabledProviders(env)).length) return new Set();
	return new Set((await billingPlans(env)).offers.map((o) => o.tierId));
}

// ---------------------------------------------------------------------------
// User: checkout, billing history, cancel, portal
// ---------------------------------------------------------------------------

/** Return paths stay on the videos site (no open redirect). */
export function safeReturnPath(path: unknown): string {
	if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/.test(path) || path.length > 300) return '/upgrade';
	return path;
}

export async function startCheckout(env: ServiceEnv, user: { userId: string; email: string | null; name: string | null }, input: Partial<BillingCheckoutInput>, now = new Date()): Promise<BillingCheckout> {
	if (typeof input.tierId !== 'string' || typeof input.period !== 'string' || typeof input.currency !== 'string' || typeof input.provider !== 'string') {
		throw new BillingError(400, BILLING_ERRORS.invalid, 'tierId, period, currency and provider are required');
	}
	const provider = assertProvider(env, input.provider);
	const cfg = (await enabledProviders(env)).find((p) => p.id === provider);
	if (!cfg) throw new BillingError(409, BILLING_ERRORS.providerDisabled, 'Payments with this provider are off');
	const price = (await readPrices(env)).find((p) => p.tierId === input.tierId && p.period === input.period && p.currency === input.currency.toUpperCase() && p.active);
	const link = price ? sellableLink(price, provider, cfg.mode) : null;
	if (!price || !link || !providerTakesCurrency(provider, price.currency)) throw new BillingError(404, BILLING_ERRORS.notForSale, 'No price for that period and currency');
	const at = now.toISOString();
	const subs = await userSubscriptions(env, user.userId);
	if (subs.some((s) => s.tier_id === price.tierId && (s.status === 'active' || s.status === 'past_due') && s.provider !== 'manual')) {
		throw new BillingError(409, BILLING_ERRORS.alreadySubscribed, 'You already subscribe to this tier');
	}
	const ctx = await providerContext(env, provider);
	const row = await linkFor(env, price.id, provider, cfg.mode);
	const checkoutId = `bco_${crypto.randomUUID().replace(/-/g, '')}`;
	await createCheckoutRow(env, { id: checkoutId, user_id: user.userId, tier_id: price.tierId, price_id: price.id, provider, mode: cfg.mode, created_at: at });
	const web = (env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	const returnPath = safeReturnPath(input.returnPath);
	const returnUrl = `${web}${returnPath}${returnPath.includes('?') ? '&' : '?'}checkout=${checkoutId}`;
	let result;
	try {
		result = await adapterFor(provider).createCheckout(ctx, {
			checkoutId,
			userId: user.userId,
			email: user.email,
			name: user.name,
			tierId: price.tierId,
			priceRef: link.providerRef!,
			priceCheckoutUrl: row?.checkout_url ?? null,
			customerRef: await customerFor(env, user.userId, provider, cfg.mode),
			returnUrl,
		});
	} catch (error) {
		logger.error('[Billing] Checkout failed at the provider', { provider, userId: user.userId, error: errorText(error) });
		throw new BillingError(502, BILLING_ERRORS.providerError, 'The payment provider did not answer; try again shortly');
	}
	if (result.customerRef) await saveCustomer(env, provider, cfg.mode, result.customerRef, user.userId, at);
	await setCheckoutRef(env, checkoutId, result.providerRef);
	logger.info('[Billing] Checkout started', { provider, userId: user.userId, tierId: price.tierId, checkoutId });
	return { checkoutId, url: result.url, paddleTransactionId: result.paddleTransactionId ?? null };
}

export async function myBilling(env: ServiceEnv, userId: string): Promise<MyBilling> {
	const [subs, payments] = await Promise.all([userSubscriptions(env, userId), userPayments(env, userId)]);
	const portal = subs.some((s) => (s.status === 'active' || s.status === 'past_due') && s.provider !== 'manual' && PAYMENT_PROVIDERS[s.provider as PaymentProviderId]?.customerPortal && s.customer_ref);
	return { subscriptions: subs.map(toSubscription), payments, portal };
}

/** The return page's poll: the user's own checkout and whether its subscription is active yet. */
export async function myCheckout(env: ServiceEnv, userId: string, checkoutId: string): Promise<MyCheckout> {
	const row = /^bco_[0-9a-f]{32}$/.test(checkoutId) ? await readCheckout(env, checkoutId) : null;
	if (!row || row.user_id !== userId) throw new BillingError(404, BILLING_ERRORS.notFound);
	const status = row.status === 'completed' || row.status === 'expired' ? row.status : 'open';
	const active =
		status === 'completed' &&
		(await userSubscriptions(env, userId)).some((s) => s.tier_id === row.tier_id && s.provider === row.provider && (s.status === 'active' || s.status === 'past_due'));
	return { checkoutId: row.id, tierId: row.tier_id, status, active };
}

/** A receipt link for the user's own payment: the stored one, or one the provider makes now. */
export async function paymentReceipt(env: ServiceEnv, userId: string, paymentId: string): Promise<string> {
	const payment = await readPayment(env, paymentId);
	if (!payment || payment.userId !== userId) throw new BillingError(404, BILLING_ERRORS.notFound);
	if (payment.receiptUrl) return payment.receiptUrl;
	const provider = payment.provider as PaymentProviderId;
	const adapter = payment.receiptOnRequest ? adapterFor(provider) : null;
	if (!adapter?.receiptUrl) throw new BillingError(404, BILLING_ERRORS.notFound, 'This payment has no receipt');
	const ctx = await providerContext(env, provider, { mode: payment.mode });
	let url: string | null;
	try {
		url = await adapter.receiptUrl(ctx, payment.providerRef);
	} catch (error) {
		logger.warn('[Billing] Receipt link failed at the provider', { provider, paymentId, error: errorText(error) });
		throw new BillingError(502, BILLING_ERRORS.providerError, 'The payment provider did not answer; try again shortly');
	}
	if (!url) throw new BillingError(404, BILLING_ERRORS.notFound, 'The provider has no receipt for this payment yet');
	return url;
}

/** The user closed the checkout without paying (Paddle overlay closed, test page Cancel). */
export async function abandonCheckout(env: ServiceEnv, userId: string | null, checkoutId: string): Promise<void> {
	const row = /^bco_[0-9a-f]{32}$/.test(checkoutId) ? await readCheckout(env, checkoutId) : null;
	if (!row || (userId !== null && row.user_id !== userId)) throw new BillingError(404, BILLING_ERRORS.notFound);
	await expireCheckout(env, row.id);
}

/** The user cancels their own subscription: at period end where the provider can, otherwise billing stops and the paid period is kept. */
export async function cancelOwnSubscription(env: ServiceEnv, userId: string, subscriptionId: string) {
	const row = await readSubscription(env, subscriptionId);
	if (!row || row.user_id !== userId) throw new BillingError(404, BILLING_ERRORS.notFound);
	if (row.provider === 'manual') throw new BillingError(409, BILLING_ERRORS.wrongState, 'A complimentary tier is ended by an admin');
	if (!(row.status === 'active' || row.status === 'past_due') || Number(row.cancel_at_period_end) === 1) throw new BillingError(409, BILLING_ERRORS.wrongState, 'This subscription is not active');
	return createJob(env, { kind: 'billing.cancel', targetKind: 'billing', targetId: subscriptionId, params: { subscriptionId, atPeriodEnd: true, by: 'user' }, actorId: userId });
}

export async function portalUrl(env: ServiceEnv, userId: string): Promise<string> {
	const row = (await userSubscriptions(env, userId)).find((s) => (s.status === 'active' || s.status === 'past_due') && s.customer_ref && PAYMENT_PROVIDERS[s.provider as PaymentProviderId]?.customerPortal);
	if (!row) throw new BillingError(404, BILLING_ERRORS.notFound, 'No subscription with a provider portal');
	const provider = row.provider as PaymentProviderId;
	const ctx = await providerContext(env, provider, { mode: row.mode as PaymentMode });
	try {
		const url = await adapterFor(provider).customerPortal(ctx, row.customer_ref!, row.provider_ref);
		if (!url) throw new BillingError(404, BILLING_ERRORS.notFound);
		return url;
	} catch (error) {
		if (error instanceof BillingError) throw error;
		logger.error('[Billing] Portal session failed', { provider, userId, error: errorText(error) });
		throw new BillingError(502, BILLING_ERRORS.providerError, 'The payment provider did not answer; try again shortly');
	}
}

// ---------------------------------------------------------------------------
// Admin actions (jobs)
// ---------------------------------------------------------------------------

export async function queuePriceSync(env: ServiceEnv, provider: PaymentProviderId, actorId: string) {
	const cfg = await readProvider(env, provider);
	if (provider !== 'fake' && !(await readCredential(env, provider, 'apiKey', cfg.mode))) throw new BillingError(409, BILLING_ERRORS.providerIncomplete, 'Enter the API key for this mode first');
	return createJob(env, { kind: 'billing.sync-prices', targetKind: 'billing', targetId: provider, params: { provider, mode: cfg.mode }, actorId });
}

export async function queueCancel(env: ServiceEnv, subscriptionId: string, atPeriodEnd: boolean, actorId: string) {
	const row = await readSubscription(env, subscriptionId);
	if (!row) throw new BillingError(404, BILLING_ERRORS.notFound);
	if (row.status === 'ended') throw new BillingError(409, BILLING_ERRORS.wrongState, 'This subscription has ended');
	if (row.provider === 'manual') return { subscription: await markCanceled(env, subscriptionId, { atPeriodEnd: false }), job: null };
	const job = await createJob(env, { kind: 'billing.cancel', targetKind: 'billing', targetId: subscriptionId, params: { subscriptionId, atPeriodEnd, by: 'admin' }, actorId });
	return { subscription: toSubscription(row), job };
}

export async function queueRefund(env: ServiceEnv, paymentId: string, amount: number | null, reason: string, actorId: string) {
	const payment = await readPayment(env, paymentId);
	if (!payment) throw new BillingError(404, BILLING_ERRORS.notFound);
	if (payment.provider === 'manual') throw new BillingError(409, BILLING_ERRORS.wrongState, 'Nothing was paid');
	if (payment.status === 'failed' || payment.status === 'refunded') throw new BillingError(409, BILLING_ERRORS.wrongState, 'This payment cannot be refunded');
	const left = payment.amount - payment.refundedAmount;
	if (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0 || amount > left)) throw new BillingError(400, BILLING_ERRORS.invalid, `amount must be 1 to ${left}`);
	if (amount !== null && !PAYMENT_PROVIDERS[payment.provider as PaymentProviderId]?.partialRefunds) throw new BillingError(400, BILLING_ERRORS.invalid, 'This provider refunds whole payments only');
	return createJob(env, { kind: 'billing.refund', targetKind: 'billing', targetId: paymentId, params: { paymentId, amount: amount === left ? null : amount, reason }, actorId });
}

export async function runSyncPricesJob(env: ServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const provider = assertProvider(env, String(job.params.provider));
	const mode = (job.params.mode === 'live' ? 'live' : 'test') as PaymentMode;
	const ctx = await providerContext(env, provider, { mode });
	const tiers = await readTiers(env.SEARCH_DB as D1Database);
	const prices = (await readPrices(env)).filter((p) => p.active && providerTakesCurrency(provider, p.currency));
	let synced = 0;
	const failures: string[] = [];
	for (const price of prices) {
		const existing = await linkFor(env, price.id, provider, mode);
		if (existing?.provider_ref && existing.synced_amount === price.amount && !existing.error && (provider !== 'paygood' || existing.checkout_url)) continue;
		try {
			const tierName = tiers.find((t) => t.id === price.tierId)?.name ?? price.tierId;
			const r = await adapterFor(provider).syncPrice(ctx, { ...price, tierName }, { providerRef: existing?.provider_ref ?? null, productRef: existing?.provider_product_ref ?? null, syncedAmount: existing?.synced_amount ?? null, checkoutUrl: existing?.checkout_url ?? null });
			await writeLink(env, { priceId: price.id, provider, mode, providerRef: r.providerRef, productRef: r.productRef, checkoutUrl: r.checkoutUrl ?? null, syncedAmount: price.amount, error: null });
			synced++;
		} catch (error) {
			await writeLink(env, { priceId: price.id, provider, mode, providerRef: null, productRef: null, checkoutUrl: null, syncedAmount: null, error: errorText(error) });
			// A refusal (bad currency, bad key) is the admin's to fix; a network error retries the whole job
			if (!(error instanceof ProviderError && error.permanent)) throw error;
			failures.push(`${price.tierId} ${price.period} ${price.currency}: ${errorText(error)}`);
		}
	}
	if (failures.length) flagBillingJob(env, undefined, job, failures.join('; '));
	else resolveNeedsAction(env, undefined, jobNeedsActionKey(job.id));
	return { done: true, result: { synced, failed: failures.length } };
}

export async function runCancelJob(env: ServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const id = String(job.params.subscriptionId ?? job.targetId);
	const row = await readSubscription(env, id);
	if (!row || row.status === 'ended') return { done: true, result: { skipped: 'ended' } };
	const provider = row.provider as PaymentProviderId;
	const atPeriodEnd = job.params.atPeriodEnd !== false && PAYMENT_PROVIDERS[provider]?.cancelAtPeriodEnd;
	if (row.provider_ref) {
		const ctx = await providerContext(env, provider, { mode: row.mode as PaymentMode });
		await adapterFor(provider).cancelSubscription(ctx, row.provider_ref, !!atPeriodEnd);
	}
	// PayGood stops billing at once: the user keeps the tier until the paid period ends (unless an admin ends it now)
	const keepPeriod = job.params.atPeriodEnd !== false;
	await markCanceled(env, id, { atPeriodEnd: keepPeriod });
	return { done: true, result: { canceled: id, atPeriodEnd: keepPeriod } };
}

export async function runRefundJob(env: ServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const id = String(job.params.paymentId ?? job.targetId);
	const payment = await readPayment(env, id);
	if (!payment || payment.status === 'refunded') return { done: true, result: { skipped: 'refunded' } };
	const provider = payment.provider as PaymentProviderId;
	const amount = typeof job.params.amount === 'number' ? job.params.amount : null;
	const ctx = await providerContext(env, provider, { mode: payment.mode });
	const r = await adapterFor(provider).refund(ctx, payment.providerRef, amount, String(job.params.reason ?? ''));
	await markRefunded(env, id, amount);
	return { done: true, result: { refunded: id, refundRef: r.refundRef } };
}

export async function runReconcileJob(env: ServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const row = await readSubscription(env, String(job.params.subscriptionId ?? job.targetId));
	if (!row?.provider_ref || row.provider === 'manual') return { done: true, result: { skipped: true } };
	const provider = row.provider as PaymentProviderId;
	const ctx = await providerContext(env, provider, { mode: row.mode as PaymentMode });
	const sub = await adapterFor(provider).getSubscription(ctx, row.provider_ref);
	await applyEvents(env, provider, row.mode as PaymentMode, [{ type: 'subscription.updated', occurredAt: new Date().toISOString(), subscription: sub, customerRef: sub.customerRef }]);
	return { done: true, result: { status: sub.status } };
}

/** Hourly: subscriptions whose renewal never arrived are checked with the provider. */
export async function queueReconciles(env: ServiceEnv, now = new Date()): Promise<number> {
	const stale = await staleSubscriptions(env, now);
	for (const row of stale) {
		await markReconcileRequested(env, row.id, now.toISOString());
		await createJob(env, { kind: 'billing.reconcile', targetKind: 'billing', targetId: row.id, params: { subscriptionId: row.id }, actorId: 'system:billing' });
	}
	return stale.length;
}

// ---------------------------------------------------------------------------
// The test provider's checkout page (never production)
// ---------------------------------------------------------------------------

export function fakeAvailable(env: ServiceEnv): boolean {
	return availableProviders(env).includes('fake') && !isProductionEnv(env);
}

/** "Pay (test)": sends the signed events through the real receive path. */
export async function completeFakeCheckout(env: ServiceEnv, checkoutId: string, now = new Date()): Promise<{ returnUrl: string | null }> {
	if (!fakeAvailable(env)) throw new BillingError(404, BILLING_ERRORS.notFound);
	const checkout = await readCheckout(env, checkoutId);
	if (!checkout || checkout.provider !== 'fake' || checkout.status !== 'open') throw new BillingError(404, BILLING_ERRORS.notFound, 'No open test checkout');
	const price = await readPrice(env, checkout.price_id);
	const link = price?.links.find((l) => l.provider === 'fake');
	if (!price || !link?.providerRef) throw new BillingError(404, BILLING_ERRORS.notForSale);
	for (const event of fakePaymentEvents({ checkoutId, userId: checkout.user_id, priceRef: link.providerRef, period: price.period, amount: price.amount, currency: price.currency }, now)) {
		const body = JSON.stringify(event);
		const outcome = await receiveWebhook(env, 'fake', body, await signFake(body, now), now);
		if (outcome.status !== 200) throw new BillingError(500, 'billing_fake_failed', 'The test webhook was refused');
	}
	return { returnUrl: null };
}

export { BillingError };
