/**
 * /internal/support/* (wiki AUN-MEMBERS §9.6). Behind the INTERNAL_API_KEY check of every /internal/*
 * path: only admin-api calls these, after its own permission checks.
 *
 *   POST /jobs/retry { jobId, kind }  the Errors page's Retry of a support job that gave up
 *                                     (admin-api requires support:manage)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { getJob, retryJob } from '../lib/admin/jobs';
import type { SupportJobEnv } from '../lib/support/jobs';

const app = new Hono<{ Bindings: SupportJobEnv }>();

const RetryBody = z.object({ jobId: z.guid(), kind: z.string().max(40) }).strict();

app.post('/jobs/retry', async (c) => {
	const parsed = RetryBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ success: false, code: 'invalid_request' }, 400);
	const { jobId, kind } = parsed.data;
	const job = await getJob(c.env, jobId);
	if (!job || !job.kind.startsWith('support.') || job.kind !== kind) return c.json({ success: false, code: 'support_job_not_found' }, 404);
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

export default app;
