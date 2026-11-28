/**
 * Internal playlist-add endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). Not part of the public contract.
 *
 *   POST /internal/playlist-adds/retry  { videoId, playlistId }
 *     The admin Errors page's Retry on a failed upload → playlist add
 *     (admin-api runs it through its service binding, lib/errors-actions.ts):
 *     starts a new queued add. 404 when there is no such add.
 */

import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import { Hono } from 'hono';
import { retryPlaylistAdd, type PlaylistAddEnv } from '../../lib/playlistUploadAdds';

const Retry = z.object({ videoId: RecordId, playlistId: RecordId });

export function createPlaylistAddsInternalRouter() {
	const app = new Hono<{ Bindings: PlaylistAddEnv }>();

	app.post('/retry', async (c) => {
		const parsed = Retry.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'videoId and playlistId are required' }, 400);
		const { videoId, playlistId } = parsed.data;
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
