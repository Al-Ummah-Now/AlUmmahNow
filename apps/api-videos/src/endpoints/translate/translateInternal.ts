/**
 * Internal translation endpoints (X-API-Key = INTERNAL_API_KEY; the `/internal/*` guard in index.ts).
 *
 *   POST /internal/translate/admin-fields  { userId, from, to, texts[], field }  admin-api's staff Translate
 *        (lib/translate/admin-fields.ts). admin-api has checked the staff permission; userId is the staff member.
 */
import { Hono } from 'hono';
import { logger } from '../../lib/logger';
import { TranslateHttpError, type InlineTranslateEnv } from '../../lib/translate/inline';
import { translateAdminFields } from '../../lib/translate/admin-fields';

export function createTranslateInternalRouter() {
	const app = new Hono<{ Bindings: InlineTranslateEnv }>();

	app.post('/admin-fields', async (c) => {
		const body = (await c.req.json().catch(() => null)) as Partial<{ userId: string; from: string; to: string; texts: string[]; field: string }> | null;
		if (!body || typeof body.userId !== 'string' || typeof body.from !== 'string' || typeof body.to !== 'string' || !Array.isArray(body.texts)) {
			return c.json({ success: false, error: 'invalid_request' }, 400);
		}
		try {
			const data = await translateAdminFields(c.env, { userId: body.userId, from: body.from, to: body.to, texts: body.texts, field: typeof body.field === 'string' ? body.field : 'field' });
			return c.json({ success: true, data });
		} catch (error) {
			if (error instanceof TranslateHttpError) return c.json({ success: false, error: error.code, ...error.extra }, error.status as 400);
			logger.error('[Translate] Admin field translation failed', { error: error instanceof Error ? error.message : String(error) });
			return c.json({ success: false, error: 'internal_error' }, 500);
		}
	});

	return app;
}
