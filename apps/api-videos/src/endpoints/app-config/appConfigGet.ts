/**
 * GET /api/v1/app-config (Epic 9.3; wiki AUN-APP-UPDATES §4.1): API versions, the update answer for
 * the calling app build, and its remote config. Public and cacheable; no user data.
 */
import { z } from 'zod';
import { APP_RELEASE_REPOS, APP_UPDATE_ARCHES, APP_UPDATE_CHANNELS, APP_UPDATE_SOURCES, reportNeedsAction } from '@al-ummah/shared-types';
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
import { APPS, PLATFORMS, SEMVER, buildAppConfig, loadVersionsDocument } from '../../lib/app-config';
import { AVAILABILITY_KEY, type AvailabilityDocument } from '../../lib/app-updates/answer';
import { emptyReleases, readReleases } from '../../lib/app-updates/releases';
import { appUpdatesOn } from '../../lib/app-updates/switch';
import { evaluateConfig, evaluateFlags, loadRules } from '../../lib/feature-flags';
import { logger } from '../../lib/logger';

const Localized = z.object({ en: z.string(), ar: z.string() });

const AppConfigResponse = z.object({
	api: z.object({
		current: z.string().describe('API version new apps should call'),
		supported: z.array(z.string()).describe('API versions still served'),
	}),
	update: z.object({
		enabled: z.boolean().describe('The appUpdates switch; false: show nothing and require nothing'),
		status: z.enum(['ok', 'recommended', 'required']).describe('required: below the minimum version; recommended: a newer version this build can get'),
		minimumVersion: z.string(),
		latestVersion: z.string().nullable().describe('The newest version this build’s install source can get'),
		storeUrl: z.string().nullable(),
		channel: z.enum(APP_UPDATE_CHANNELS).nullable(),
		publishedAt: z.string().nullable(),
		notes: Localized.nullable().describe('Release notes in English and Arabic; the app shows its own UI language'),
		message: Localized.nullable().describe('Admin text for the forced screen (only when required)'),
		action: z.enum(['store', 'install', 'download', 'none']).describe('store: open the store; install: self-update from manifestUrl; download: open url'),
		url: z.string().nullable(),
		manifestUrl: z.string().nullable().describe('Signed app-release.json; verify it with the key list before installing'),
		tag: z.string().nullable().describe('The release tag the signed manifest must name'),
		signed: z.boolean().nullable(),
		available: z.boolean().nullable().describe('null: ask the device store (Play, Microsoft Store)'),
		checkHours: z.number().nullable(),
		keys: z.object({ list: z.string(), sig: z.string() }).nullable().describe('The repo’s root-signed key list (update-keys.json and its .sig), verbatim'),
	}),
	flags: z.record(z.string(), z.unknown()).describe('Feature flags for this app build (Epic 9.5)'),
	config: z.record(z.string(), z.unknown()).describe('Remote configuration values (Epic 9.5)'),
});

export class AppConfigGet extends PublicRoute {
	schema = {
		tags: ['App config'],
		summary: 'App configuration, update notice and minimum supported version',
		description:
			'🌐 Public. Called by native and desktop apps at start-up and every `checkHours`. Returns the supported API versions, whether this build must (`required`) or should (`recommended`) be updated and how (wiki AUN-APP-UPDATES), and its remote config.',
		request: {
			query: z.object({
				platform: z.enum(PLATFORMS),
				app: z.enum(APPS),
				version: z.string().regex(SEMVER).describe('Version of the running build (1.4.2, 2026.11.22.2; Apple: X.Y.Z.N with the rebuild number)'),
				channel: z.enum(APP_UPDATE_CHANNELS).optional().describe('beta for TestFlight, Play testing and preview builds'),
				source: z.enum(APP_UPDATE_SOURCES).optional().describe('Where this build was installed from'),
				arch: z.enum(APP_UPDATE_ARCHES).optional(),
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
		const kv = c.env.APP_CONFIG;
		const [versions, flagRules, configRules, enabled] = await Promise.all([
			loadVersionsDocument(kv),
			loadRules(kv, 'flags'),
			loadRules(kv, 'config'),
			appUpdatesOn(c.env),
		]);
		for (const [name, error] of [['versions', versions.error], ['flags', flagRules.error], ['config', configRules.error]]) {
			if (error) logger.warn(`[AppConfig] Invalid ${name} document, using defaults`, { error });
		}
		// The release index is read only while updates are on
		const [releases, availability] = enabled ? await Promise.all([readReleases(kv), kv ? kv.get(AVAILABILITY_KEY, { type: 'json', cacheTtl: 60 }) : Promise.resolve(null)]) : [emptyReleases(), null];
		const ctx = { app: query.app, platform: query.platform, version: query.version, locale: query.locale, installId: query.installId };
		c.header('Cache-Control', 'public, max-age=300');
		return c.json(
			buildAppConfig(
				{ ...ctx, channel: query.channel, source: query.source, arch: query.arch },
				versions.doc,
				{ flags: evaluateFlags(flagRules.rules, ctx), config: evaluateConfig(configRules.rules, ctx) },
				{ enabled, releases, availability: (availability ?? {}) as AvailabilityDocument, adminAppsUrl: c.env.ADMIN_APPS_URL },
			),
		);
	}
}

const FAILURE_REASONS = [
	'bad_signature_file',
	'unknown_key',
	'bad_signature',
	'bad_json',
	'bad_manifest',
	'wrong_repo',
	'wrong_tag',
	'wrong_channel',
	'not_newer',
	'below_floor',
	'yanked',
	'key_list',
	'host',
	'hash',
	'code_signature',
] as const;

/**
 * POST /api/v1/app-config/update-failure (wiki AUN-APP-UPDATES §5.3 step 6): an app reports that an
 * update failed verification. Only tags the index has seen count, so the admin Errors page gets at
 * most one item per repo, tag and reason, whoever calls.
 */
export class AppUpdateFailurePost extends PublicRoute {
	schema = {
		tags: ['App config'],
		summary: 'Report an update that failed verification',
		description: '🌐 Public, rate-limited, no user data. The app installed nothing; this tells the admins why.',
		request: {
			body: {
				content: {
					'application/json': {
						schema: z.object({
							app: z.enum(APPS),
							platform: z.enum(PLATFORMS),
							version: z.string().regex(SEMVER),
							repo: z.enum(APP_RELEASE_REPOS),
							tag: z.string().regex(/^v[0-9A-Za-z.+-]{1,64}$/),
							reason: z.enum(FAILURE_REASONS),
						}),
					},
				},
			},
		},
		responses: { '202': { description: 'Noted' }, '400': { description: 'Invalid body' }, '429': { description: 'Too many reports' } },
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const limiter = c.env.SUGGEST_LIMITER;
		if (limiter) {
			const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
			if (!(await limiter.limit({ key: `update-failure:${ip}` })).success) return c.json({ success: false, error: 'rate_limited' }, 429);
		}
		const kv = c.env.APP_CONFIG;
		const releases = await readReleases(kv);
		const known = Object.entries(releases.seen).some(([source, tags]) => source.endsWith(`:${body.repo}`) && tags.includes(body.tag));
		if (known && kv) {
			const dedupe = `update-failure:${body.repo}:${body.tag}:${body.reason}`;
			if (!(await kv.get(dedupe))) {
				await kv.put(dedupe, '1', { expirationTtl: 3600 });
				reportNeedsAction('api-videos', c.env as never, c.executionCtx as never, {
					key: `app-update-failure:${body.repo}:${body.tag}:${body.reason}`,
					source: 'ops',
					title: 'An app refused an update',
					message: `${body.app} ${body.platform} ${body.version} refused ${body.repo} ${body.tag}: ${body.reason}. Nothing was installed. Check the release, its signature and the key list.`,
					itemType: 'app-release',
					itemId: `${body.repo}:${body.tag}`,
					extra: { ...body },
				});
			}
		}
		return c.json({ success: true }, 202);
	}
}
