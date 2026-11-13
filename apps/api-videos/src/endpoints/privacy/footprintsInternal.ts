/**
 * Privacy footprint backfill (#1073; lib/privacy/footprints.ts), for ops
 * (X-API-Key = INTERNAL_API_KEY; the `/internal/*` guard in index.ts).
 *
 *   GET  /internal/privacy/footprints
 *        Per bucket: whether the erase trusts its footprints, the apply pass and the last dry run.
 *   POST /internal/privacy/footprints/backfill   { dryRun?: boolean (default true), buckets?: string[] }
 *        Starts a pass per bucket (default: all five), one page per PROCESSING_CHECK_QUEUE message.
 *        A dry run reads every object and counts the rows it would write; it writes only its own state.
 */
import { Hono } from 'hono';
import { logger } from '../../lib/logger';
import {
	FOOTPRINT_BUCKETS,
	footprintsComplete,
	isFootprintBucket,
	readFootprintPass,
	startFootprintPass,
	type FootprintBucket,
	type FootprintEnv,
} from '../../lib/privacy/footprints';

export function createFootprintsInternalRouter() {
	const app = new Hono<{ Bindings: FootprintEnv }>();

	app.get('/', async (c) => {
		const db = c.env.SEARCH_DB;
		if (!db) return c.json({ success: false, error: 'SEARCH_DB is not bound' }, 503);
		const buckets: Record<string, unknown> = {};
		for (const bucket of FOOTPRINT_BUCKETS) {
			buckets[bucket] = {
				complete: await footprintsComplete(db, bucket),
				pass: await readFootprintPass(db, bucket, false),
				dryRun: await readFootprintPass(db, bucket, true),
			};
		}
		return c.json({ success: true, result: buckets });
	});

	app.post('/backfill', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { dryRun?: unknown; buckets?: unknown };
		const dryRun = body.dryRun !== false;
		const requested = Array.isArray(body.buckets) ? body.buckets : [...FOOTPRINT_BUCKETS];
		const unknown = requested.filter((b) => typeof b !== 'string' || !isFootprintBucket(b));
		if (unknown.length) return c.json({ success: false, error: `Unknown bucket(s): ${unknown.join(', ')}`, buckets: FOOTPRINT_BUCKETS }, 400);
		try {
			const started: Record<string, unknown> = {};
			for (const bucket of new Set(requested as FootprintBucket[])) started[bucket] = await startFootprintPass(c.env, bucket, { dryRun });
			return c.json({ success: true, result: started }, 202);
		} catch (error) {
			logger.error('[PrivacyFootprints] Could not start the backfill', { error: error instanceof Error ? error.message : String(error) });
			return c.json({ success: false, error: 'Could not start the backfill' }, 503);
		}
	});

	return app;
}
