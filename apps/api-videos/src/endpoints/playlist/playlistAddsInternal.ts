/**
 * Internal playlist-add endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). Not part of the public contract.
 *
 *   POST /internal/playlist-adds/retry  { videoId, playlistId }
 *     The admin Errors page's Retry on a failed upload → playlist add
 *     (admin-api runs it through its service binding, lib/errors-actions.ts):
 *     starts a new queued add. 404 when there is no such add.
 */

import { Hono } from 'hono';
import { retryPlaylistAdd, type PlaylistAddEnv } from '../../lib/playlistUploadAdds';

export function createPlaylistAddsInternalRouter() {
	const app = new Hono<{ Bindings: PlaylistAddEnv }>();

	app.post('/retry', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { videoId?: unknown; playlistId?: unknown } | null;
		const videoId = typeof body?.videoId === 'string' ? body.videoId : '';
		const playlistId = typeof body?.playlistId === 'string' ? body.playlistId : '';
		if (!videoId || !playlistId) return c.json({ success: false, error: 'videoId and playlistId are required' }, 400);
		let ctx: { waitUntil(promise: Promise<unknown>): void } | undefined;
		try {
			ctx = c.executionCtx;
		} catch {
			ctx = undefined;
		}
		const status = await retryPlaylistAdd(c.env, videoId, playlistId, ctx);
		if (!status) return c.json({ success: false, error: 'No such playlist add' }, 404);
		return c.json({ success: true, result: { status } });
	});

	return app;
}
