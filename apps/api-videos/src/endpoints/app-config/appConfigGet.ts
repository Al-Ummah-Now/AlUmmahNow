/**
 * GET /api/v1/app-config (Epic 9.3): API versions and the update policy for
 * the calling app build. Public and cacheable; no user data.
 */
import { z } from 'zod';
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
import { APPS, PLATFORMS, SEMVER, buildAppConfig, loadVersionsDocument } from '../../lib/app-config';
import { logger } from '../../lib/logger';

const AppConfigResponse = z.object({
	api: z.object({
		current: z.string().describe('API version new apps should call'),
		supported: z.array(z.string()).describe('API versions still served'),
	}),
	update: z.object({
		status: z.enum(['ok', 'recommended', 'required']).describe('required: block with an update screen; recommended: suggest updating'),
		minimumVersion: z.string(),
		latestVersion: z.string().nullable(),
		storeUrl: z.string().nullable(),
	}),
	flags: z.record(z.unknown()).describe('Feature flags for this app build (Epic 9.5)'),
	config: z.record(z.unknown()).describe('Remote configuration values (Epic 9.5)'),
});

export class AppConfigGet extends PublicRoute {
	schema = {
		tags: ['App config'],
		summary: 'App configuration and minimum supported version',
		description:
			'🌐 Public. Called by native apps at start-up. Returns the supported API versions and whether this build must (`required`) or should (`recommended`) be updated.',
		request: {
			query: z.object({
				platform: z.enum(PLATFORMS),
				app: z.enum(APPS),
				version: z.string().regex(SEMVER).describe('Version of the running build (semver, e.g. 1.4.2)'),
				locale: z.string().max(16).optional(),
			}),
		},
		responses: {
			'200': { description: 'App configuration', content: { 'application/json': { schema: AppConfigResponse } } },
			'400': { description: 'Invalid platform, app or version' },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const { doc, error } = await loadVersionsDocument(c.env.APP_CONFIG);
		if (error) logger.warn('[AppConfig] Invalid versions document, using defaults', { error });
		c.header('Cache-Control', 'public, max-age=300');
		return c.json(buildAppConfig({ app: query.app, platform: query.platform, version: query.version }, doc));
	}
}
