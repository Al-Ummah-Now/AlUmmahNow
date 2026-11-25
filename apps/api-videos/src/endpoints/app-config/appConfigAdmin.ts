/**
 * Internal remote-config admin (Epic 9.5), behind the INTERNAL_API_KEY
 * middleware on /internal/* (not part of the public contract):
 *
 * - GET /internal/app-config/:key   the stored document (null when unset)
 * - PUT /internal/app-config/:key   replace it; validated first, so a bad
 *   document is never written (400 with the zod issues)
 * - POST /internal/app-config/evaluate   dry run: what an app build would get
 *   from draft documents (any left out are read from KV), validated the same way
 *
 * Keys: `flags` and `config` (rule lists, lib/feature-flags.ts) and
 * `versions` (update policies, lib/app-config.ts). The videos admin edits them
 * through admin-api (/api/app-config, settings:manage, audited); the service
 * key never reaches a browser. Answers carry `result` (and `problems` on a 400)
 * like the other internal routes; `value` and `issues` stay for older callers.
 */
import { z } from 'zod';
import { APP_UPDATE_ARCHES, APP_UPDATE_CHANNELS, APP_UPDATE_SOURCES } from '@al-ummah/shared-types';
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
import { APPS, PLATFORMS, SEMVER, VersionsDocumentSchema, buildAppConfig } from '../../lib/app-config';
import type { VersionsDocument } from '../../lib/app-config';
import { APP_CONFIG_KEYS, forgetAppConfigDocument } from '../../lib/app-config-store';
import type { AppConfigKey } from '../../lib/app-config-store';
import { ConfigRulesDocumentSchema, RulesDocumentSchema, evaluateConfig, evaluateFlags, parseStoredRules } from '../../lib/feature-flags';
import type { FlagContext, FlagRule } from '../../lib/feature-flags';
import { logger } from '../../lib/logger';
import { apiError } from '../../lib/api-error';
import { AVAILABILITY_KEY, type AvailabilityDocument } from '../../lib/app-updates/answer';
import { minimumProblems } from '../../lib/app-updates/minimum';
import { noKeyRepos, readReleases } from '../../lib/app-updates/releases';

export const APP_CONFIG_SCHEMAS: Record<AppConfigKey, z.ZodTypeAny> = {
	flags: RulesDocumentSchema,
	config: ConfigRulesDocumentSchema,
	versions: VersionsDocumentSchema,
};

const Params = z.object({ key: z.enum(APP_CONFIG_KEYS) });

function namespace(c: AppContext): KVNamespace | Response {
	return c.env.APP_CONFIG ?? c.json({ success: false, error: 'APP_CONFIG KV namespace is not bound' }, 503);
}

export class AppConfigDocumentGet extends PublicRoute {
	schema = {
		tags: ['Internal'],
		summary: 'Read a remote-config document (internal)',
		request: { params: Params },
		responses: { '200': { description: 'The document, or null' }, '401': { description: 'Missing or wrong X-API-Key' } },
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const kv = namespace(c);
		if (kv instanceof Response) return kv;
		const value = await kv.get(params.key, { type: 'json' });
		return c.json({ success: true, key: params.key, value, result: value });
	}
}

export class AppConfigDocumentPut extends PublicRoute {
	schema = {
		tags: ['Internal'],
		summary: 'Replace a remote-config document (internal)',
		request: {
			params: Params,
			body: { content: { 'application/json': { schema: z.unknown() } } },
		},
		responses: {
			'200': { description: 'Stored' },
			'400': { description: 'Invalid document (nothing written)' },
			'401': { description: 'Missing or wrong X-API-Key' },
		},
	};

	async handle(c: AppContext) {
		// The validated body: getValidatedData() has already consumed the stream
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const kv = namespace(c);
		if (kv instanceof Response) return kv;
		const parsed = APP_CONFIG_SCHEMAS[params.key].safeParse(body);
		if (!parsed.success) {
			return c.json({ success: false, error: 'invalid_document', issues: parsed.error.issues, problems: parsed.error.issues }, 400);
		}
		if (params.key === 'versions') {
			// A minimum no install source can give users yet would strand them (AUN-APP-UPDATES §3.4)
			const [releases, availability] = await Promise.all([readReleases(kv), kv.get(AVAILABILITY_KEY, { type: 'json' })]);
			const problems = minimumProblems(parsed.data as VersionsDocument, releases, (availability ?? {}) as AvailabilityDocument, noKeyRepos(releases, c.env.UPDATE_ROOT_KEYS)).map((p) => ({ path: [p.key, p.field], message: p.message, code: p.code, params: p.params }));
			if (problems.length) return apiError(c, 400, 'validation_error', { error: 'invalid_document', issues: problems, problems });
		}
		await kv.put(params.key, JSON.stringify(parsed.data));
		forgetAppConfigDocument(kv, params.key);
		logger.debug('[AppConfig] Document replaced', { key: params.key });
		return c.json({ success: true, key: params.key, value: parsed.data, result: parsed.data });
	}
}

const EvaluateBody = z.object({
	context: z.object({
		platform: z.enum(PLATFORMS),
		app: z.enum(APPS),
		version: z.string().regex(SEMVER),
		locale: z.string().max(16).optional(),
		installId: z.string().max(64).optional(),
		channel: z.enum(APP_UPDATE_CHANNELS).optional(),
		source: z.enum(APP_UPDATE_SOURCES).optional(),
		arch: z.enum(APP_UPDATE_ARCHES).optional(),
	}),
	/** Drafts to try; a key left out is read from KV */
	documents: z.object({ flags: z.unknown().optional(), config: z.unknown().optional(), versions: z.unknown().optional() }).partial().default({}),
});

export class AppConfigEvaluate extends PublicRoute {
	schema = {
		tags: ['Internal'],
		summary: 'Dry-run remote config for an app build (internal)',
		request: { body: { content: { 'application/json': { schema: EvaluateBody } } } },
		responses: {
			'200': { description: 'What the build would get from GET /api/v1/app-config' },
			'400': { description: 'Invalid context or draft document' },
			'401': { description: 'Missing or wrong X-API-Key' },
		},
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const kv = namespace(c);
		if (kv instanceof Response) return kv;
		const docs: { flags?: FlagRule[]; config?: FlagRule[]; versions?: VersionsDocument } = {};
		for (const key of APP_CONFIG_KEYS) {
			// A draft is checked exactly as a save would check it; otherwise the stored document (straight from KV)
			const draft = body.documents[key] !== undefined;
			const raw = draft ? body.documents[key] : await kv.get(key, { type: 'json' });
			if (raw == null) continue;
			// A stored document is read as GET /api/app-config reads it (apps we no longer have are ignored)
			const parsed = draft || key === 'versions' ? APP_CONFIG_SCHEMAS[key].safeParse(raw) : parseStoredRules(raw, key);
			if (!parsed.success) {
				return c.json({ success: false, error: 'invalid_document', key, problems: parsed.error.issues }, 400);
			}
			(docs as Record<string, unknown>)[key] = parsed.data;
		}
		// Validated by EvaluateBody (chanfana's inferred type marks every field optional)
		const ctx = body.context as FlagContext;
		const update = body.context as { channel?: 'stable' | 'beta'; source?: (typeof APP_UPDATE_SOURCES)[number]; arch?: string };
		// The dry run answers as if the appUpdates switch were on, so admins can check before turning it on
		const [releases, availability] = await Promise.all([readReleases(kv), kv.get(AVAILABILITY_KEY, { type: 'json' })]);
		return c.json({
			success: true,
			result: buildAppConfig(
				{ ...ctx, channel: update.channel, source: update.source, arch: update.arch },
				docs.versions,
				{ flags: evaluateFlags(docs.flags ?? [], ctx), config: evaluateConfig(docs.config ?? [], ctx) },
				{ enabled: true, releases, availability: (availability ?? {}) as AvailabilityDocument, adminAppsUrl: c.env.ADMIN_APPS_URL, noKeys: noKeyRepos(releases, c.env.UPDATE_ROOT_KEYS) },
			),
		});
	}
}
