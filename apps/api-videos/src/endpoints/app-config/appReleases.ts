/**
 * Internal release index routes (wiki AUN-APP-UPDATES §4.2), behind the INTERNAL_API_KEY middleware
 * on /internal/*; admin-api calls them for the App config page's Releases tab.
 *
 * - GET  /internal/app-config/releases          the `releases` document (empty when none yet)
 * - POST /internal/app-config/releases/refresh  run the index now; 429 while a run is going
 * - PUT  /internal/app-config/releases/available  mark a TestFlight or Amazon upload available (null clears)
 */
import { z } from 'zod';
import { APP_CONFIG_SEMVER } from '@al-ummah/shared-types';
import { PublicRoute } from '../../base';
import { APPS, PLATFORMS } from '../../lib/app-config';
import { AVAILABILITY_KEY, type AvailabilityDocument } from '../../lib/app-updates/answer';
import type { AppContext } from '../../base';
import { apiError } from '../../lib/api-error';
import { readReleases } from '../../lib/app-updates/releases';
import { runReleaseIndex } from '../../lib/app-updates/run';

export class AppReleasesGet extends PublicRoute {
	schema = {
		tags: ['Internal'],
		summary: 'Read the app release index (internal)',
		responses: { '200': { description: 'The release index' }, '401': { description: 'Missing or wrong X-API-Key' } },
	};

	async handle(c: AppContext) {
		const doc = await readReleases(c.env.APP_CONFIG);
		// The admin's TestFlight and Amazon Available marks, for the Releases tab
		const availability = ((await c.env.APP_CONFIG?.get(AVAILABILITY_KEY, { type: 'json' })) ?? {}) as AvailabilityDocument;
		return c.json({ success: true, result: { ...doc, availability } });
	}
}

export class AppReleasesRefresh extends PublicRoute {
	schema = {
		tags: ['Internal'],
		summary: 'Run the app release index now (internal)',
		responses: {
			'200': { description: 'What the run found, and the index after it' },
			'429': { description: 'A run is already going' },
			'503': { description: 'APP_CONFIG is not bound' },
			'401': { description: 'Missing or wrong X-API-Key' },
		},
	};

	async handle(c: AppContext) {
		if (!c.env.APP_CONFIG) return apiError(c, 503, 'service_unavailable', { error: 'app_config_unbound' });
		const run = await runReleaseIndex(c.env as never, c.executionCtx as ExecutionContext);
		if (run.skipped === 'running') return apiError(c, 429, 'rate_limited', { error: 'release_index_running' });
		const doc = await readReleases(c.env.APP_CONFIG);
		return c.json({ success: true, result: { run, releases: doc } });
	}
}

export class AppReleasesAvailablePut extends PublicRoute {
	schema = {
		tags: ['Internal'],
		summary: 'Mark a TestFlight or Amazon upload available (internal)',
		request: {
			body: {
				content: {
					'application/json': {
						schema: z.object({
							app: z.enum(APPS),
							platform: z.enum(PLATFORMS),
							source: z.enum(['testflight', 'amazon']),
							version: z.string().regex(APP_CONFIG_SEMVER).nullable(),
						}),
					},
				},
			},
		},
		responses: { '200': { description: 'The availability document' }, '401': { description: 'Missing or wrong X-API-Key' }, '503': { description: 'APP_CONFIG is not bound' } },
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const kv = c.env.APP_CONFIG;
		if (!kv) return apiError(c, 503, 'service_unavailable', { error: 'app_config_unbound' });
		const doc = ((await kv.get(AVAILABILITY_KEY, { type: 'json' })) ?? {}) as AvailabilityDocument;
		const key = `${body.app}/${body.platform}/${body.source}`;
		if (body.version) doc[key] = body.version;
		else delete doc[key];
		await kv.put(AVAILABILITY_KEY, JSON.stringify(doc));
		return c.json({ success: true, result: doc });
	}
}
