/**
 * /internal/billing/* — the videos admin's Payments page (wiki AUN-SUBS).
 *
 * Behind the INTERNAL_API_KEY check of every /internal/* path (src/index.ts):
 * only admin-api calls these, after checking billing permissions; it writes
 * the audit rows (with `previous` from these answers) and does the Secrets
 * Store writes itself, then calls /providers/:id/credentials to record that a
 * credential is set. No credential value ever reaches this router.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
	ADMIN_BILLING_FILTERS,
	BILLING_COMP_REASON_MAX,
	BILLING_PERIODS,
	BILLING_REFUND_REASON_MAX,
	PAYMENT_CREDENTIAL_FIELDS,
	PAYMENT_MODES,
	type AdminBillingOverview,
	type AdminBillingSubscriptionRow,
	type BillingSubscription,
} from '@al-ummah/shared-types';
import { logger } from '../lib/logger';
import { getJob, retryJob } from '../lib/admin/jobs';
import { readMany } from '../lib/admin/directory';
import { readTiers } from '../lib/creatorTiers';
import {
	assertProvider,
	BillingError,
	deletePrice,
	markCredential,
	readPrices,
	readProvider,
	readProviders,
	readTax,
	savePrice,
	saveTax,
	updateProvider,
	type PriceInput,
} from '../lib/billing/config';
import { queueCancel, queuePriceSync, queueRefund, type ServiceEnv } from '../lib/billing/service';
import { counts, createComp, listSubscriptions, readSubscription, subscriptionEvents, subscriptionPayments, toSubscription, userPayments, userSubscriptions, readEvent } from '../lib/billing/store';

type Env = { Bindings: ServiceEnv & { profiles: R2Bucket } };
const app = new Hono<Env>();

const actor = (c: Context<Env>) => c.req.header('X-Admin-Actor') || 'admin';
const body = async (c: Context<Env>) => c.req.json().catch(() => ({}));
const ok = (c: Context<Env>, result: unknown) => c.json({ success: true, result });
const searchDb = (c: Context<Env>) => c.env.SEARCH_DB as D1Database;

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
	const result = schema.safeParse(value);
	if (!result.success) throw new BillingError(400, 'invalid_billing_request', result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
	return result.data;
}

app.onError((error, c) => {
	if (error instanceof BillingError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
	logger.error('[BillingInternal] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

async function withUsers(c: Context<Env>, items: BillingSubscription[]): Promise<AdminBillingSubscriptionRow[]> {
	const ids = [...new Set(items.map((s) => s.userId))];
	const profiles = c.env.profiles ? await readMany<Record<string, unknown>>(c.env.profiles, ids) : new Map();
	return items.map((s) => {
		const p = profiles.get(s.userId) ?? null;
		return {
			...s,
			displayName: (p?.displayName as string) || [p?.firstName, p?.lastName].filter(Boolean).join(' ') || null,
			userName: (p?.userName as string) || null,
			avatarUrl: (p?.avatarUrl as string) || null,
		};
	});
}

// Overview: providers, tax, prices, whether credentials can be stored (admin-api adds that), counts
app.get('/overview', async (c) => {
	const [providers, tax, prices, n] = await Promise.all([readProviders(c.env), readTax(c.env), readPrices(c.env), counts(c.env)]);
	const result: Omit<AdminBillingOverview, 'credentialStorage'> = {
		providers,
		tax,
		prices,
		counts: n,
	};
	return ok(c, result);
});

const ProviderBody = z
	.object({
		enabled: z.boolean().optional(),
		mode: z.enum(PAYMENT_MODES).optional(),
		settings: z.record(z.string().max(60), z.string().max(200).nullable()).optional(),
	})
	.strict();
app.put('/providers/:id', async (c) => ok(c, await updateProvider(c.env, assertProvider(c.env, c.req.param('id')), parse(ProviderBody, await body(c)), actor(c))));

// admin-api wrote (or deleted) the value in Secrets Store; this records only that, never the value
const CredentialBody = z.object({ field: z.enum(PAYMENT_CREDENTIAL_FIELDS), mode: z.enum(PAYMENT_MODES), cleared: z.boolean().optional(), last4: z.string().regex(/^[\x21-\x7e]{4}$/).nullable().optional() }).strict();
app.post('/providers/:id/credentials', async (c) => {
	const input = parse(CredentialBody, await body(c));
	return ok(c, await markCredential(c.env, assertProvider(c.env, c.req.param('id')), input.field, input.mode, actor(c), input.cleared === true, undefined, input.last4 ?? null));
});
app.get('/providers/:id', async (c) => ok(c, await readProvider(c.env, assertProvider(c.env, c.req.param('id')))));
app.post('/providers/:id/sync-prices', async (c) => ok(c, { job: await queuePriceSync(c.env, assertProvider(c.env, c.req.param('id')), actor(c)) }));

const TaxBody = z
	.object({
		sellerName: z.string().max(200).nullable().optional(),
		sellerAddress: z.string().max(500).nullable().optional(),
		sellerCountry: z.string().max(2).nullable().optional(),
		taxId: z.string().max(50).nullable().optional(),
		pricesIncludeTax: z.boolean().optional(),
		taxRatePercent: z.number().min(0).max(100).nullable().optional(),
	})
	.strict();
app.put('/tax', async (c) => ok(c, await saveTax(c.env, parse(TaxBody, await body(c)), actor(c))));

const PriceBody = z
	.object({
		tierId: z.string().min(1).max(40),
		period: z.enum(BILLING_PERIODS),
		currency: z.string().length(3),
		amount: z.number().int(),
		active: z.boolean().optional(),
	})
	.strict();
app.put('/prices', async (c) => {
	const input = parse(PriceBody, await body(c)) as PriceInput;
	return ok(c, await savePrice(c.env, input, actor(c), async (id) => (await readTiers(searchDb(c))).some((t) => t.id === id)));
});
app.delete('/prices/:id', async (c) => ok(c, await deletePrice(c.env, c.req.param('id'))));


// Subscriptions
const ListQuery = z.object({ filter: z.enum(ADMIN_BILLING_FILTERS).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
app.get('/subscriptions', async (c) => {
	const q = parse(ListQuery, c.req.query());
	const page = await listSubscriptions(c.env, { filter: q.filter ?? 'active', cursor: q.cursor ?? null, limit: q.limit });
	return ok(c, { items: await withUsers(c, page.items), next: page.next });
});
app.get('/subscriptions/:id', async (c) => {
	const row = await readSubscription(c.env, c.req.param('id'));
	if (!row) throw new BillingError(404, 'billing_not_found');
	const [subscription] = await withUsers(c, [toSubscription(row)]);
	const [payments, events] = await Promise.all([subscriptionPayments(c.env, row.id), subscriptionEvents(c.env, row.id)]);
	return ok(c, { subscription, payments, events });
});
const CancelBody = z.object({ atPeriodEnd: z.boolean() }).strict();
app.post('/subscriptions/:id/cancel', async (c) => {
	const id = c.req.param('id');
	const previous = await readSubscription(c.env, id);
	const result = await queueCancel(c.env, id, parse(CancelBody, await body(c)).atPeriodEnd, actor(c));
	return ok(c, { ...result, previous: previous ? toSubscription(previous) : null });
});
const RefundBody = z.object({ amount: z.number().int().positive().nullable(), reason: z.string().trim().min(1).max(BILLING_REFUND_REASON_MAX) }).strict();
app.post('/payments/:id/refund', async (c) => {
	const input = parse(RefundBody, await body(c));
	return ok(c, { job: await queueRefund(c.env, c.req.param('id'), input.amount, input.reason, actor(c)) });
});
const CompBody = z
	.object({
		userId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
		tierId: z.string().min(1).max(40),
		until: z.string().datetime().nullable(),
		reason: z.string().trim().min(1).max(BILLING_COMP_REASON_MAX),
	})
	.strict();
app.post('/comps', async (c) => {
	const input = parse(CompBody, await body(c)) as { userId: string; tierId: string; until: string | null; reason: string };
	return ok(c, { subscription: await createComp(c.env, { ...input, until: input.until ? new Date(input.until).toISOString() : null }, actor(c)) });
});

// A user's billing (the admin user page)
app.get('/users/:id', async (c) => {
	const userId = c.req.param('id');
	const [subs, payments] = await Promise.all([userSubscriptions(c.env, userId), userPayments(c.env, userId)]);
	return ok(c, { subscriptions: subs.map(toSubscription), payments });
});

// Retry a failed billing job (the Errors page's Retry, via admin-api SERVICE_RETRIES)
const RetryBody = z.object({ jobId: z.guid(), kind: z.string().max(40) }).strict();
app.post('/jobs/retry', async (c) => {
	const { jobId, kind } = parse(RetryBody, await body(c));
	const job = await getJob(c.env, jobId);
	// The kind admin-api checked permissions for must be the job's own
	if (!job || !job.kind.startsWith('billing.') || kind !== job.kind) throw new BillingError(404, 'billing_not_found', 'No such billing job');
	if (job.status !== 'failed') {
		// Already running or done: nothing to retry. A webhook job that gave up early (unmatched event) finished
		// "succeeded" with its event marked failed, so it is queued again from its event
		const event = job.kind === 'billing.webhook' ? await readEvent(c.env, String(job.params.eventId ?? job.targetId)) : null;
		if (event?.status !== 'failed') return ok(c, { ok: true, status: job.status, result: 'Nothing to retry' });
		await searchDb(c).prepare(`UPDATE billing_events SET status = 'queued', error = NULL WHERE id = ?`).bind(event.id).run();
		await searchDb(c).prepare(`UPDATE admin_jobs SET status = 'failed' WHERE id = ?`).bind(job.id).run();
	}
	const retried = await retryJob(c.env, jobId);
	return ok(c, { ok: retried?.status !== 'failed', status: retried?.status ?? null, result: retried?.status === 'failed' ? retried.lastError : 'Queued again' });
});

export default app;
