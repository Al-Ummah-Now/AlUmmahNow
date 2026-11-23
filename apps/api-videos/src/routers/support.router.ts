/**
 * /internal/support/* (wiki AUN-MEMBERS §9.6). Behind the INTERNAL_API_KEY check of every /internal/*
 * path: only admin-api calls these, after its own permission checks.
 *
 *   POST /jobs/retry { jobId, kind }  the Errors page's Retry of a support job that gave up
 *                                     (admin-api requires support:manage)
 *   POST /batches/plan { period, actorId }          a manual payout run (queues support.payout-plan)
 *   POST /batches/:id/approve { actorId }           one approval (MEM-D24); the last one queues the funding check
 *   POST /batches/:id/stop { actorId, reason }      stops a batch; payouts not sent yet are canceled
 *
 *   GET  /overview                                   counts for the Support overview page
 *   GET  /settings                                   the settings, open decisions and readiness
 *   PUT  /settings/policy { patch, expectedVersion, actorId }       records owner decisions
 *   PUT  /settings/fields { fields, expectedVersion, actorId }      organization formed, emergency stop, hold all payouts
 *   GET  /batches                                    the newest payout batches
 *   GET  /countries                                  the Countries page
 *   PUT  /countries/:country { supporters, creators, reason, actorId }
 *
 * admin-api allows the money routes (settings, batches) only to people on the organization's
 * finance list, with a step-up, and audits them; approve checks the finance list again here.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createJob, getJob, retryJob } from '../lib/admin/jobs';
import { apiError } from '../lib/api-error';
import type { SupportJobEnv } from '../lib/support/jobs';
import { approveBatch, PayoutError, stopBatch } from '../lib/support/payouts';
import { readSupportConfig, SupportConfigError, writeSupportConfigFields, writeSupportPolicy } from '../lib/support/config';
import { undecidedSupportDecisions } from '@al-ummah/shared-types';
import { supportCanTurnOn } from '../lib/support/readiness';
import { accountTotal } from '../lib/support/ledger';

const app = new Hono<{ Bindings: SupportJobEnv }>();

const RetryBody = z.object({ jobId: z.guid(), kind: z.string().max(40) }).strict();

app.post('/jobs/retry', async (c) => {
	const parsed = RetryBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return apiError(c, 400, 'invalid_request');
	const { jobId, kind } = parsed.data;
	const job = await getJob(c.env, jobId);
	if (!job || !job.kind.startsWith('support.') || job.kind !== kind) return apiError(c, 404, 'support_job_not_found');
	const store = c.env.SEARCH_DB!;
	if (job.status !== 'failed') {
		// A webhook job that gave up early (event marked failed) finished "succeeded": queue it again from its event
		const eventId = job.kind === 'support.webhook' ? String(job.params.eventId ?? job.targetId) : null;
		const event = eventId ? await store.prepare('SELECT id, status FROM support_events WHERE id = ?').bind(eventId).first<{ id: string; status: string }>() : null;
		// Reconcile "Check again" runs a fresh pass even when the last one succeeded
		if (event?.status !== 'failed' && job.kind !== 'support.reconcile') return c.json({ success: true, result: { ok: true, status: job.status, result: 'Nothing to retry' } });
		if (event) await store.prepare(`UPDATE support_events SET status = 'queued', error = NULL WHERE id = ?`).bind(event.id).run();
		await store.prepare(`UPDATE admin_jobs SET status = 'failed' WHERE id = ?`).bind(job.id).run();
	}
	const retried = await retryJob(c.env, jobId);
	return c.json({ success: true, result: { ok: retried?.status !== 'failed', status: retried?.status ?? null, result: retried?.status === 'failed' ? retried.lastError : 'Queued again' } });
});

const Actor = z.string().min(1).max(100);
const PlanBody = z.object({ period: z.string().regex(/^(\d{4}-\d{2}|manual-\d{8}T\d{6})$/), actorId: Actor }).strict();
const ApproveBody = z.object({ actorId: Actor }).strict();
const StopBody = z.object({ actorId: Actor, reason: z.string().min(1).max(300) }).strict();

const PAYOUT_ERROR_STATUS: Record<PayoutError['code'], 400 | 403 | 404 | 409> = {
	decision_open: 409,
	not_clean: 409,
	held: 409,
	not_found: 404,
	not_finance: 403,
	already_approved: 409,
	wrong_status: 409,
	exists: 409,
	not_built: 409,
};

function payoutFailure(c: Context<any, any, any>, error: unknown) {
	if (error instanceof PayoutError) return apiError(c, PAYOUT_ERROR_STATUS[error.code], `support_${error.code}`, { detail: error.detail });
	throw error;
}

app.post('/batches/plan', async (c) => {
	const parsed = PlanBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return apiError(c, 400, 'invalid_request');
	const job = await createJob(c.env, { kind: 'support.payout-plan', targetKind: 'support', targetId: `plan:${parsed.data.period}`, params: { period: parsed.data.period, preparedBy: parsed.data.actorId }, actorId: parsed.data.actorId });
	return c.json({ success: true, result: { jobId: job.id } }, 202);
});

app.post('/batches/:id/approve', async (c) => {
	const parsed = ApproveBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return apiError(c, 400, 'invalid_request');
	const batchId = c.req.param('id');
	try {
		const r = await approveBatch(c.env.SEARCH_DB!, batchId, parsed.data.actorId, new Date());
		if (r.approved) await createJob(c.env, { kind: 'support.payout-fund', targetKind: 'support', targetId: batchId, params: { batchId }, actorId: parsed.data.actorId });
		return c.json({ success: true, result: r });
	} catch (error) {
		return payoutFailure(c, error);
	}
});

app.post('/batches/:id/stop', async (c) => {
	const parsed = StopBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return apiError(c, 400, 'invalid_request');
	return c.json({ success: true, result: await stopBatch(c.env.SEARCH_DB!, c.req.param('id'), parsed.data.reason, new Date()) });
});

// ---------------------------------------------------------------------------
// Settings, overview, batches and countries (wiki AUN-MEMBERS §9.6)
// ---------------------------------------------------------------------------

const db = (c: { env: SupportJobEnv }) => c.env.SEARCH_DB!;
const stale = (c: Context, error: unknown) => {
	if (error instanceof SupportConfigError) return apiError(c, error.code === 'stale' ? 409 : 400, error.code === 'stale' ? 'feature_changed' : 'invalid_request', { problems: error.problems } as never);
	throw error;
};

app.get('/overview', async (c) => {
	const d = db(c);
	const config = await readSupportConfig(d);
	const since = new Date(Date.now() - 86_400_000).toISOString();
	const [today, failures, disputes, recon, batch, held] = await Promise.all([
		d.prepare("SELECT COUNT(*) AS n FROM support_payments WHERE created_at >= ? AND channel_id IS NOT NULL").bind(since).first<{ n: number }>(),
		d.prepare("SELECT COUNT(*) AS n FROM support_events WHERE status = 'failed'").first<{ n: number }>(),
		d.prepare("SELECT COUNT(*) AS n FROM support_disputes WHERE status = 'open'").first<{ n: number }>(),
		d.prepare('SELECT date, currency, status, gap FROM support_reconciliations ORDER BY date DESC LIMIT 5').all<{ date: string; currency: string; status: string; gap: number }>(),
		d.prepare("SELECT id, period, status, totals, count FROM support_payout_batches WHERE status NOT IN ('done', 'stopped') ORDER BY created_at DESC LIMIT 1").first<Record<string, unknown>>(),
		Promise.all([accountTotal(d, 'bank:creator_funds', 'USD'), accountTotal(d, 'rail:funding', 'USD'), accountTotal(d, 'clearing:collector', 'USD')]),
	]);
	return c.json({
		success: true,
		result: {
			paymentsLastDay: Number(today?.n ?? 0),
			failedEvents: Number(failures?.n ?? 0),
			openDisputes: Number(disputes?.n ?? 0),
			reconciliations: recon.results ?? [],
			openBatch: batch ?? null,
			heldUsdMinor: { bank: held[0], rail: held[1], clearing: held[2] },
			emergencyStop: config.emergencyStop,
			holdAllPayouts: config.holdAllPayouts,
		},
	});
});

app.get('/settings', async (c) => {
	const config = await readSupportConfig(db(c));
	const readiness = await supportCanTurnOn(c.env);
	return c.json({ success: true, result: { ...config, openDecisions: undecidedSupportDecisions(config.policy), readiness } });
});

const PolicyBody = z.object({ patch: z.record(z.string(), z.unknown()), expectedVersion: z.number().int().min(0), actorId: Actor }).strict();
app.put('/settings/policy', async (c) => {
	const parsed = PolicyBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return apiError(c, 400, 'invalid_request');
	try {
		return c.json({ success: true, result: await writeSupportPolicy(db(c), parsed.data.patch as never, parsed.data.actorId, parsed.data.expectedVersion) });
	} catch (error) {
		return stale(c as never, error);
	}
});

const FieldsBody = z
	.object({
		fields: z.object({ organizationFormed: z.boolean().optional(), organizationName: z.string().max(200).nullable().optional(), emergencyStop: z.boolean().optional(), holdAllPayouts: z.boolean().optional() }).strict(),
		expectedVersion: z.number().int().min(0),
		actorId: Actor,
	})
	.strict();
app.put('/settings/fields', async (c) => {
	const parsed = FieldsBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return apiError(c, 400, 'invalid_request');
	try {
		return c.json({ success: true, result: await writeSupportConfigFields(db(c), parsed.data.fields, parsed.data.actorId, parsed.data.expectedVersion) });
	} catch (error) {
		return stale(c as never, error);
	}
});

app.get('/batches', async (c) => {
	const rows = await db(c).prepare('SELECT id, period, status, totals, count, prepared_by, approvals, approved_at, stopped_reason, created_at, updated_at FROM support_payout_batches ORDER BY created_at DESC LIMIT 50').all<Record<string, unknown>>();
	return c.json({ success: true, result: { batches: rows.results ?? [] } });
});

app.get('/countries', async (c) => {
	const rows = await db(c).prepare('SELECT country, supporters, creators, reason, changed_by, changed_at FROM support_country_rules ORDER BY country LIMIT 300').all<Record<string, unknown>>();
	return c.json({ success: true, result: { countries: rows.results ?? [] } });
});

const CountryBody = z
	.object({ supporters: z.enum(['allowed', 'blocked']), creators: z.enum(['allowed', 'blocked', 'waitlist', 'external_link_only']), reason: z.enum(['sanctions', 'rail_unsupported', 'legal_review', 'admin']), actorId: Actor })
	.strict();
app.put('/countries/:country', async (c) => {
	const country = (c.req.param('country') ?? '').toUpperCase();
	const parsed = CountryBody.safeParse(await c.req.json().catch(() => null));
	if (!/^[A-Z]{2}$/.test(country) || !parsed.success) return apiError(c, 400, 'invalid_request');
	const before = await db(c).prepare('SELECT supporters, creators, reason FROM support_country_rules WHERE country = ?').bind(country).first<Record<string, unknown>>();
	const { supporters, creators, reason, actorId } = parsed.data;
	await db(c)
		.prepare(
			`INSERT INTO support_country_rules (country, supporters, creators, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(country) DO UPDATE SET supporters = excluded.supporters, creators = excluded.creators, reason = excluded.reason, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
		)
		.bind(country, supporters, creators, reason, actorId, new Date().toISOString())
		.run();
	return c.json({ success: true, result: { country, before: before ?? null, after: { supporters, creators, reason } } });
});

export default app;
