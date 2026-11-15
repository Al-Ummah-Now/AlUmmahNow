/**
 * Account erasure of Move from YouTube data (wiki AUN-YT-IMPORT): the imports
 * the user connected and the imports into channels they own, their YouTube
 * snapshots, pending consents and staged captions. A Google token still held
 * is revoked first (best effort: the row goes either way). The imported videos
 * themselves are the account's videos and go with the rest of its content.
 */
import { logger } from '../logger';
import { dropToken, type YtEnv } from './service';
import type { ImportRow } from './rows';

export async function eraseYoutubeImports(db: D1Database, env: YtEnv & { subtitles?: R2Bucket }, userId: string): Promise<number> {
	const { results } = await db.prepare('SELECT * FROM yt_imports WHERE user_id = ? OR owner_id = ?').bind(userId, userId).all<ImportRow>();
	const rows = results ?? [];
	for (const row of rows) {
		if (row.refresh_token_enc) {
			try {
				await dropToken({ ...env, SEARCH_DB: db }, row);
			} catch (error) {
				logger.warn('[YouTubeImport] Token revoke during erasure failed', { importId: row.id, error: error instanceof Error ? error.message : String(error) });
			}
		}
		if (env.subtitles) {
			let cursor: string | undefined;
			do {
				const page = await env.subtitles.list({ prefix: `yt-import/${row.id}/`, cursor });
				if (page.objects.length) await env.subtitles.delete(page.objects.map((o) => o.key));
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
		}
		await db.batch([
			db.prepare('DELETE FROM yt_import_items WHERE import_id = ?').bind(row.id),
			db.prepare('DELETE FROM yt_import_playlists WHERE import_id = ?').bind(row.id),
			db.prepare('DELETE FROM yt_imports WHERE id = ?').bind(row.id),
		]);
	}
	await db.prepare('DELETE FROM yt_oauth_states WHERE user_id = ? OR owner_id = ?').bind(userId, userId).run();
	return rows.length;
}
