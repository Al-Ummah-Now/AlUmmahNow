/**
 * POST /api/v1/telemetry/events (Epic 9.8): batched client telemetry.
 * Rules (consent, privacy, sampling, row shape) live in lib/telemetry.ts.
 */
import { z } from 'zod';
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
import { loadRules, evaluateConfig } from '../../lib/feature-flags';
import { logger } from '../../lib/logger';
import { MAX_BATCH_BYTES, TelemetryBatch, hashInstallId, inSample, sampleRate, toDataPoint } from '../../lib/telemetry';

const Accepted = z.object({
	accepted: z.number().describe('Events written'),
	dropped: z.number().describe('Events not written (no consent, sampled out, or ingest unavailable)'),
});

export class TelemetryEventsPost extends PublicRoute {
	schema = {
		tags: ['Telemetry'],
		summary: 'Send a batch of client telemetry events',
		description:
			'🌐 Public, no user id. Up to 50 events and 64 KB per batch. Accepted only with `consent.analytics: true`; otherwise the batch is dropped (still 202, do not retry). Event types: `qoe`, `crash_breadcrumb`, `app_event` (allow-listed names). Rate limited per install id.',
		request: { body: { content: { 'application/json': { schema: TelemetryBatch } } } },
		responses: {
			'202': { description: 'Received', content: { 'application/json': { schema: Accepted } } },
			'400': { description: 'Invalid batch' },
			'413': { description: 'Batch larger than 64 KB' },
			'429': { description: 'Too many batches from this install' },
		},
	};

	async handle(c: AppContext) {
		// Read the raw body ourselves to enforce the size limit before parsing
		const declared = Number(c.req.header('content-length') ?? 0);
		if (declared > MAX_BATCH_BYTES) return c.json({ error: 'payload_too_large' }, 413);
		const raw = await c.req.text();
		if (new TextEncoder().encode(raw).length > MAX_BATCH_BYTES) return c.json({ error: 'payload_too_large' }, 413);

		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return c.json({ error: 'invalid_json' }, 400);
		}
		const parsed = TelemetryBatch.safeParse(json);
		if (!parsed.success) return c.json({ error: 'invalid_batch', issues: parsed.error.issues.slice(0, 10) }, 400);
		const batch = parsed.data;

		if (!batch.consent.analytics) return c.json({ accepted: 0, dropped: batch.events.length }, 202);

		if (c.env.TELEMETRY_LIMITER) {
			const { success } = await c.env.TELEMETRY_LIMITER.limit({ key: batch.installId });
			if (!success) return c.json({ error: 'rate_limited' }, 429);
		}

		const dataset = c.env.CLIENT_TELEMETRY;
		if (!dataset) return c.json({ accepted: 0, dropped: batch.events.length }, 202);

		const { rules, error } = await loadRules(c.env.APP_CONFIG, 'config');
		if (error) logger.warn('[Telemetry] Invalid config document, sampling everything', { error });
		const config = evaluateConfig(rules, { app: batch.app, platform: batch.platform, version: batch.appVersion, installId: batch.installId });

		const installHash = await hashInstallId(batch.installId);
		let accepted = 0;
		for (const event of batch.events) {
			if (!inSample(batch.installId, event.type, sampleRate(config, event.type))) continue;
			dataset.writeDataPoint(toDataPoint(batch, event, installHash));
			accepted++;
		}
		return c.json({ accepted, dropped: batch.events.length - accepted }, 202);
	}
}
