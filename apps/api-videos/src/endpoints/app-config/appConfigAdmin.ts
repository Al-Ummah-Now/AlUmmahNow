/**
 * Internal remote-config admin (Epic 9.5), behind the INTERNAL_API_KEY
 * middleware on /internal/* (not part of the public contract):
 *
 * - GET /internal/app-config/:key   the stored document (null when unset)
 * - PUT /internal/app-config/:key   replace it; validated first, so a bad
 *   document is never written (400 with the zod issues)
 *
 * Keys: `flags` and `config` (rule lists, lib/feature-flags.ts) and
 * `versions` (update policies, lib/app-config.ts). The admin-web UI is a
 * later story; until then these are called with the service key.
 */
import { z } from 'zod';
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
import { VersionsDocumentSchema } from '../../lib/app-config';
import { APP_CONFIG_KEYS, forgetAppConfigDocument } from '../../lib/app-config-store';
import type { AppConfigKey } from '../../lib/app-config-store';
import { ConfigRulesDocumentSchema, RulesDocumentSchema } from '../../lib/feature-flags';
import { logger } from '../../lib/logger';

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
		return c.json({ success: true, key: params.key, value });
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
			return c.json({ success: false, error: 'invalid_document', issues: parsed.error.issues }, 400);
		}
		await kv.put(params.key, JSON.stringify(parsed.data));
		forgetAppConfigDocument(kv, params.key);
		logger.debug('[AppConfig] Document replaced', { key: params.key });
		return c.json({ success: true, key: params.key, value: parsed.data });
	}
}
