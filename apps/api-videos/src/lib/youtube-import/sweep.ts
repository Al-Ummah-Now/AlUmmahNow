/**
 * Hourly upkeep of Move from YouTube (wiki AUN-YT-IMPORT), from the hourly cron:
 *
 * - consents never completed (older than 15 minutes) are deleted;
 * - running imports whose picked items have all settled are closed (the page
 *   does it when the creator watches; this is the backstop);
 * - an import nobody touched for IDLE_DAYS is ended, so no Google token is
 *   held for an import the creator walked away from;
 * - finished imports' YouTube snapshot is emptied after SNAPSHOT_DAYS: only
 *   the YouTube id → video mapping of imported items stays (it stops a second
 *   import of the same video and feeds the link-back file), and the staged
 *   captions are deleted.
 *
 * Bounded per run (BATCH imports per pass), indexed queries only.
 */
import { logger } from '../logger';
import { enqueue, endImport, ytDb } from './service';
import type { YtJobsEnv } from './jobs';
import type { ImportRow } from './rows';

export const IDLE_DAYS = 14;
export const SNAPSHOT_DAYS = 30;
const BATCH = 25;
const DAY = 86_400_000;

export interface YtSweepResult {
	statesDeleted: number;
	closeQueued: number;
	ended: number;
	purged: number;
}

export async function sweepYoutubeImports(env: YtJobsEnv, now = new Date()): Promise<YtSweepResult> {
	const result: YtSweepResult = { statesDeleted: 0, closeQueued: 0, ended: 0, purged: 0 };
	if (!env.SEARCH_DB) return result;
	const db = ytDb(env);
	const at = now.toISOString();

	const states = await db.prepare('DELETE FROM yt_oauth_states WHERE expires_at < ?').bind(at).run();
	result.statesDeleted = Number(states.meta?.changes ?? 0);

	// Idle: no change for IDLE_DAYS (listing that never finished, picked but never started, uploads abandoned)
	const idleBefore = new Date(now.getTime() - IDLE_DAYS * DAY).toISOString();
	const { results: idle } = await db
		.prepare(
			`SELECT i.* FROM yt_imports i WHERE i.status IN ('listing', 'ready', 'importing') AND i.updated_at < ?
			   AND NOT EXISTS (SELECT 1 FROM yt_import_items t WHERE t.import_id = i.id AND t.updated_at >= ?)
			 ORDER BY i.updated_at LIMIT ?`,
		)
		.bind(idleBefore, idleBefore, BATCH)
		.all<ImportRow>();
	for (const row of idle ?? []) {
		await endImport(env, row, row.status === 'importing' ? 'finished' : 'cancelled', 'expired');
		result.ended++;
	}

	// Importing: let the close job decide (it refreshes the items and closes when every picked one settled)
	const { results: importing } = await db
		.prepare(`SELECT id FROM yt_imports WHERE status = 'importing' ORDER BY updated_at LIMIT ?`)
		.bind(BATCH)
		.all<{ id: string }>();
	for (const row of importing ?? []) {
		await enqueue(env, { kind: 'yt-close', importId: row.id });
		result.closeQueued++;
	}

	// Snapshots of imports over for SNAPSHOT_DAYS
	const purgeBefore = new Date(now.getTime() - SNAPSHOT_DAYS * DAY).toISOString();
	const { results: old } = await db
		.prepare(
			`SELECT id FROM yt_imports WHERE status IN ('finished', 'cancelled', 'failed') AND snapshot_purged_at IS NULL AND finished_at < ? ORDER BY finished_at LIMIT ?`,
		)
		.bind(purgeBefore, BATCH)
		.all<{ id: string }>();
	for (const row of old ?? []) {
		await db.batch([
			db.prepare(`DELETE FROM yt_import_items WHERE import_id = ? AND video_id IS NULL`).bind(row.id),
			db
				.prepare(
					`UPDATE yt_import_items SET description = '', title_localized = NULL, description_localized = NULL, tags = NULL, thumbnail_url = NULL, match_json = NULL WHERE import_id = ?`,
				)
				.bind(row.id),
			db.prepare(`UPDATE yt_import_playlists SET description = '', video_ids_json = '[]' WHERE import_id = ?`).bind(row.id),
			db.prepare(`UPDATE yt_imports SET snapshot_purged_at = ? WHERE id = ?`).bind(at, row.id),
		]);
		await deleteStagedCaptions(env, row.id);
		result.purged++;
	}
	if (result.ended || result.purged) logger.info('[YouTubeImport] Sweep', result);
	return result;
}

async function deleteStagedCaptions(env: YtJobsEnv, importId: string): Promise<void> {
	const bucket = env.subtitles;
	if (!bucket) return;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: `yt-import/${importId}/`, cursor });
		if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}
