/**
 * GET /api/v1/app-config (Epic 9.3): API versions and the update policy for
 * the calling app build. Public and cacheable; no user data.
 */
import { z } from 'zod';
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
import { APPS, PLATFORMS, SEMVER, buildAppConfig, loadVersionsDocument } from '../../lib/app-config';
import { evaluateConfig, evaluateFlags, loadRules } from '../../lib/feature-flags';
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
				installId: z
					.string()
					.min(8)
					.max(64)
					.regex(/^[A-Za-z0-9_-]+$/)
					.optional()
					.describe('Random per-install id (not tied to the user); keeps percentage rollouts stable'),
			}),
		},
		responses: {
			'200': { description: 'App configuration', content: { 'application/json': { schema: AppConfigResponse } } },
			'400': { description: 'Invalid platform, app or version' },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const [versions, flagRules, configRules] = await Promise.all([
			loadVersionsDocument(c.env.APP_CONFIG),
			loadRules(c.env.APP_CONFIG, 'flags'),
			loadRules(c.env.APP_CONFIG, 'config'),
		]);
		for (const [name, error] of [['versions', versions.error], ['flags', flagRules.error], ['config', configRules.error]]) {
			if (error) logger.warn(`[AppConfig] Invalid ${name} document, using defaults`, { error });
		}
		const ctx = { app: query.app, platform: query.platform, version: query.version, locale: query.locale, installId: query.installId };
		c.header('Cache-Control', 'public, max-age=300');
		return c.json(
			buildAppConfig(ctx, versions.doc, {
				flags: evaluateFlags(flagRules.rules, ctx),
				config: evaluateConfig(configRules.rules, ctx),
			}),
		);
	}
}
