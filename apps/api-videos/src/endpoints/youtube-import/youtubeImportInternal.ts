/**
 * Move from YouTube, internal side (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). admin-api calls these with the
 * `media:manage` permission and its audit (routers/youtubeImport.router.ts).
 *
 *   GET  /internal/youtube-import/settings   { result: YoutubeImportSettingsView }
 *   PUT  /internal/youtube-import/settings   { enabled?, clientId?, actorId } → { result: view, previous }
 *   PUT  /internal/youtube-import/client-secret  { value, actorId } → { result: view, hadAdminSecret }
 *                                            seals and stores the Google client secret; never returned
 *   POST /internal/youtube-import/retry      { job } the Errors page's Retry of a step that gave up;
 *                                            404 when the import is gone or over
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../lib/logger';
import { forgetFeatureSettings } from '../../lib/features';
import { retryYtJob, type YtJobsEnv } from '../../lib/youtube-import/jobs';
import { YtHttpError } from '../../lib/youtube-import/service';
import { saveYtClientSecret, saveYtSettings, ytSettingsView, YtSettingsError } from '../../lib/youtube-import/settings';

const Actor = z.string().regex(/^[A-Za-z0-9_@.+-]{1,128}$/).default('admin');
const SettingsBody = z.object({ actorId: Actor, enabled: z.boolean().optional(), clientId: z.string().max(512).optional() });
const SecretBody = z.object({ actorId: Actor, value: z.string().min(16).max(256) });

type Ctx = { waitUntil(promise: Promise<unknown>): void } | undefined;

const ctxOf = (c: { executionCtx: Ctx }): Ctx => {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
};

export function createYoutubeImportInternalRouter() {
	const app = new Hono<{ Bindings: YtJobsEnv }>();

	app.onError((error, c) => {
		if (error instanceof YtSettingsError) return c.json({ success: false, code: error.code, error: error.message }, error.code === 'unavailable' ? 503 : 400);
		if (error instanceof YtHttpError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
		logger.error('[YouTubeImport] Internal call failed', { path: c.req.path, error: error.message });
		return c.json({ success: false, error: 'internal_error' }, 500);
	});

	app.get('/settings', async (c) => c.json({ success: true, result: await ytSettingsView(c.env) }));

	app.put('/settings', async (c) => {
		const parsed = SettingsBody.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, code: 'invalid_settings', error: 'Invalid settings' }, 400);
		const { actorId, ...patch } = parsed.data;
		const { previous } = await saveYtSettings(c.env, patch, actorId);
		forgetFeatureSettings();
		return c.json({ success: true, result: await ytSettingsView(c.env), previous });
	});

	app.put('/client-secret', async (c) => {
		const parsed = SecretBody.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, code: 'invalid_secret', error: 'Invalid client secret' }, 400);
		const { hadAdminSecret } = await saveYtClientSecret(c.env, parsed.data.value, parsed.data.actorId);
		forgetFeatureSettings();
		return c.json({ success: true, result: await ytSettingsView(c.env), hadAdminSecret });
	});

	app.post('/retry', async (c) => {
		const body = await c.req.json().catch(() => null);
		const retried = await retryYtJob(c.env, body, ctxOf(c as never));
		// Nothing left to retry: the Errors page dismisses the item on 404
		if (!retried) return c.json({ success: false, error: 'import_gone' }, 404);
		return c.json({ success: true });
	});

	return app;
}
