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
 * admin-api allows the batch routes only to people on the organization's finance list, with a
 * step-up, and audits them; approve checks the finance list again here.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createJob, getJob, retryJob } from '../lib/admin/jobs';
import { apiError } from '../lib/api-error';
import type { SupportJobEnv } from '../lib/support/jobs';
import { approveBatch, PayoutError, stopBatch } from '../lib/support/payouts';

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

export default app;
