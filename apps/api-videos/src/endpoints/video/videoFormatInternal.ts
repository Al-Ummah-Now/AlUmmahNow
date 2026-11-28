/**
 * Internal endpoints of the Short/video format backfill (X-API-Key =
 * INTERNAL_API_KEY; the `/internal/*` guard in index.ts). Admins use admin-api
 * (/api/admin/video-format, RBAC + audit); these are for ops.
 *
 *   POST /internal/video-format/backfill   { dryRun?: boolean (default true), limit? }
 *   GET  /internal/video-format/runs/latest
 *   GET  /internal/video-format/runs/:runId
 */
import { z } from 'zod';
import { optionalJson } from '../../validation/legacy-request';
import { Hono } from 'hono';
import { videoFormatRunView as view } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';
import { apiError } from '../../lib/api-error';
import { readVideoFormatRun, startVideoFormatRun, type VideoFormatEnv } from '../../lib/video-format/job';

const Backfill = z.object({ dryRun: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() });

export function createVideoFormatInternalRouter() {
	const app = new Hono<{ Bindings: VideoFormatEnv }>();

	app.post('/backfill', async (c) => {
		const parsed = Backfill.safeParse(await optionalJson(c.req));
		if (!parsed.success) return apiError(c, 400, 'invalid_request', { error: 'Invalid backfill options' });
		const { dryRun = true, limit } = parsed.data;
		try {
			const run = await startVideoFormatRun(c.env, { dryRun, limit, requestedBy: 'ops' });
			return c.json({ success: true, result: view(run) }, 202);
		} catch (error) {
			logger.error('[VideoFormatInternal] Could not start the backfill', { error: error instanceof Error ? error.message : String(error) });
			return c.json({ success: false, error: 'Could not start the backfill' }, 503);
		}
	});

	app.get('/runs/latest', async (c) => c.json({ success: true, result: view(await readVideoFormatRun(c.env)) }));

	app.get('/runs/:runId', async (c) => {
		const runId = c.req.param('runId');
		if (!/^[A-Za-z0-9-]{8,64}$/.test(runId)) return c.json({ success: false, error: 'Invalid run id' }, 400);
		const run = view(await readVideoFormatRun(c.env, runId));
		return run ? c.json({ success: true, result: run }) : c.json({ success: false, error: 'Run not found' }, 404);
	});

	return app;
}
