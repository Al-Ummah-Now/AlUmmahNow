/**
 * Internal release index routes (wiki AUN-APP-UPDATES §4.2), behind the INTERNAL_API_KEY middleware
 * on /internal/*; admin-api calls them for the App config page's Releases tab.
 *
 * - GET  /internal/app-config/releases          the `releases` document (empty when none yet)
 * - POST /internal/app-config/releases/refresh  run the index now; 429 while a run is going
 */
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
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
		return c.json({ success: true, result: doc });
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
		if (!c.env.APP_CONFIG) return c.json({ success: false, error: 'APP_CONFIG KV namespace is not bound' }, 503);
		const run = await runReleaseIndex(c.env as never, c.executionCtx as ExecutionContext);
		if (run.skipped === 'running') return c.json({ success: false, error: 'release_index_running' }, 429);
		const doc = await readReleases(c.env.APP_CONFIG);
		return c.json({ success: true, result: { run, releases: doc } });
	}
}
