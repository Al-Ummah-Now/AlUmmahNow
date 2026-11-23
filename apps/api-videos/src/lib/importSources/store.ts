/**
 * SEARCH_DB access for social import sources (migration search/0081_import_sources.sql; wiki
 * TOOLS-ADMIN TA-9). Rows in, views out; no network calls here.
 */
import {
	nextImportSyncAt,
	type D1Database,
	type ImportItemKind,
	type ImportItemNote,
	type SourceItemState,
	type ImportSourceAuth,
	type ImportSourceItemView,
	type ImportSourceNetwork,
	type ImportSourceSchedule,
	type ImportSourceView,
} from '@al-ummah/shared-types';

export interface SourceDbEnv {
	SEARCH_DB?: unknown;
}

export class SourceError extends Error {
	constructor(
		readonly status: 400 | 403 | 404 | 409 | 422 | 502 | 503,
		readonly code: string,
		message?: string,
	) {
		super(message ?? code);
	}
}

/** Rows a write changed. */
export const changes = (r: { meta?: unknown }): number => Number((r.meta as { changes?: number } | undefined)?.changes ?? 0);

export function sourceDb(env: SourceDbEnv): D1Database {
	if (!env.SEARCH_DB) throw new SourceError(503, 'unavailable');
	return env.SEARCH_DB as D1Database;
}

export interface SourceRow {
	id: string;
	channel_id: string;
	network: ImportSourceNetwork;
	address: string;
	label: string;
	auth_kind: ImportSourceAuth;
	social_account_id: string | null;
	yt_import_id: string | null;
	permission_by: string | null;
	permission_note: string | null;
	permission_at: number | null;
	schedule: ImportSourceSchedule;
	enabled: number;
	cursor: string | null;
	next_sync_at: number | null;
	last_sync_at: number | null;
	last_job_id: string | null;
	last_error: string | null;
	created_by: string;
	created_at: number;
	updated_at: number;
}

export interface ItemRow {
	source_id: string;
	item_id: string;
	kind: ImportItemKind | null;
	state: SourceItemState;
	payload: string | null;
	post_id: string | null;
	video_id: string | null;
	original_url: string | null;
	original_at: number | null;
	note: ImportItemNote | null;
	created_at: number;
	updated_at: number;
}

const iso = (ms: number | null) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

export function sourceView(row: SourceRow, counts: Partial<Record<SourceItemState, number>> = {}): ImportSourceView {
	return {
		id: row.id,
		channelId: row.channel_id,
		network: row.network,
		address: row.address,
		label: row.label,
		auth: row.auth_kind,
		socialAccountId: row.social_account_id,
		ytImportId: row.yt_import_id,
		permission: row.auth_kind === 'recorded' && row.permission_by ? { by: row.permission_by, note: row.permission_note ?? '', at: iso(row.permission_at)! } : null,
		schedule: row.schedule,
		enabled: !!row.enabled,
		nextSyncAt: iso(row.next_sync_at),
		lastSyncAt: iso(row.last_sync_at),
		lastJobId: row.last_job_id,
		lastError: row.last_error,
		counts,
		createdBy: row.created_by,
		createdAt: iso(row.created_at)!,
		updatedAt: iso(row.updated_at)!,
	};
}

export function itemView(row: ItemRow): ImportSourceItemView {
	return {
		sourceId: row.source_id,
		itemId: row.item_id,
		kind: row.kind,
		state: row.state,
		note: row.note,
		postId: row.post_id,
		videoId: row.video_id,
		originalUrl: row.original_url,
		originalAt: iso(row.original_at),
		createdAt: iso(row.created_at)!,
		updatedAt: iso(row.updated_at)!,
	};
}

export async function readSource(env: SourceDbEnv, id: string): Promise<SourceRow | null> {
	return sourceDb(env).prepare('SELECT * FROM import_sources WHERE id = ?').bind(id).first<SourceRow>();
}

async function countsFor(env: SourceDbEnv, ids: string[]): Promise<Map<string, Partial<Record<SourceItemState, number>>>> {
	const out = new Map<string, Partial<Record<SourceItemState, number>>>();
	if (!ids.length) return out;
	const { results } = await sourceDb(env)
		.prepare(`SELECT source_id, state, COUNT(*) AS n FROM import_source_items WHERE source_id IN (${ids.map(() => '?').join(',')}) GROUP BY source_id, state`)
		.bind(...ids)
		.all<{ source_id: string; state: SourceItemState; n: number }>();
	for (const r of results ?? []) {
		const c = out.get(r.source_id) ?? {};
		c[r.state] = Number(r.n);
		out.set(r.source_id, c);
	}
	return out;
}

export async function listSources(env: SourceDbEnv, channelId?: string): Promise<ImportSourceView[]> {
	const db = sourceDb(env);
	const { results } = channelId
		? await db.prepare('SELECT * FROM import_sources WHERE channel_id = ? ORDER BY created_at DESC LIMIT 200').bind(channelId).all<SourceRow>()
		: await db.prepare('SELECT * FROM import_sources ORDER BY created_at DESC LIMIT 200').all<SourceRow>();
	const rows = results ?? [];
	const counts = await countsFor(env, rows.map((r) => r.id));
	return rows.map((r) => sourceView(r, counts.get(r.id)));
}

export async function viewSource(env: SourceDbEnv, id: string): Promise<ImportSourceView | null> {
	const row = await readSource(env, id);
	if (!row) return null;
	return sourceView(row, (await countsFor(env, [id])).get(id));
}

export interface NewSource {
	channelId: string;
	network: ImportSourceNetwork;
	address: string;
	label: string;
	auth: ImportSourceAuth;
	socialAccountId: string | null;
	ytImportId: string | null;
	permission: { by: string; note: string } | null;
	schedule: ImportSourceSchedule;
	createdBy: string;
}

/** Adds a source; 409 when the channel already imports that address. */
export async function insertSource(env: SourceDbEnv, input: NewSource, now = Date.now()): Promise<SourceRow> {
	const id = `isrc_${crypto.randomUUID().replace(/-/g, '')}`;
	const result = await sourceDb(env)
		.prepare(
			`INSERT INTO import_sources (id, channel_id, network, address, label, auth_kind, social_account_id, yt_import_id, permission_by, permission_note, permission_at, schedule, enabled, next_sync_at, created_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
			 ON CONFLICT (channel_id, network, address) DO NOTHING`,
		)
		.bind(
			id,
			input.channelId,
			input.network,
			input.address,
			input.label,
			input.auth,
			input.socialAccountId,
			input.ytImportId,
			input.permission?.by ?? null,
			input.permission?.note ?? null,
			input.permission ? now : null,
			input.schedule,
			nextImportSyncAt(input.schedule, now),
			input.createdBy,
			now,
			now,
		)
		.run();
	if (!changes(result)) throw new SourceError(409, 'source_exists', 'This channel already imports from that address');
	return (await readSource(env, id))!;
}

export async function updateSource(env: SourceDbEnv, id: string, patch: { label?: string; schedule?: ImportSourceSchedule; enabled?: boolean }, now = Date.now()): Promise<SourceRow> {
	const row = await readSource(env, id);
	if (!row) throw new SourceError(404, 'source_not_found');
	const schedule = patch.schedule ?? row.schedule;
	const enabled = patch.enabled ?? !!row.enabled;
	// A changed schedule (or a source turned back on) counts from now; otherwise the next sync stays
	const next = !enabled ? null : patch.schedule !== undefined || (patch.enabled && !row.enabled) ? nextImportSyncAt(schedule, now) : row.next_sync_at;
	await sourceDb(env)
		.prepare('UPDATE import_sources SET label = ?, schedule = ?, enabled = ?, next_sync_at = ?, updated_at = ? WHERE id = ?')
		.bind(patch.label ?? row.label, schedule, enabled ? 1 : 0, next, now, id)
		.run();
	return (await readSource(env, id))!;
}

/** Removes the source and its item records; posts and videos it made stay on the channel. */
export async function deleteSource(env: SourceDbEnv, id: string): Promise<boolean> {
	const db = sourceDb(env);
	await db.prepare('DELETE FROM import_source_items WHERE source_id = ?').bind(id).run();
	const r = await db.prepare('DELETE FROM import_sources WHERE id = ?').bind(id).run();
	return changes(r) > 0;
}

export async function markSyncStarted(env: SourceDbEnv, id: string, jobId: string, now = Date.now()): Promise<void> {
	await sourceDb(env).prepare('UPDATE import_sources SET last_job_id = ?, updated_at = ? WHERE id = ?').bind(jobId, now, id).run();
}

/** A finished sync: the cursor moves, the next scheduled sync is set, the last error clears. */
export async function markSyncFinished(env: SourceDbEnv, row: Pick<SourceRow, 'id' | 'schedule' | 'enabled'>, cursor: string | null, now = Date.now()): Promise<void> {
	await sourceDb(env)
		.prepare('UPDATE import_sources SET cursor = COALESCE(?, cursor), last_sync_at = ?, last_error = NULL, next_sync_at = ?, updated_at = ? WHERE id = ?')
		.bind(cursor, now, row.enabled ? nextImportSyncAt(row.schedule, now) : null, now, row.id)
		.run();
}

/** A sync that gave up: shown on the source; the schedule continues (the next run tries again). */
export async function markSyncFailed(env: SourceDbEnv, row: Pick<SourceRow, 'id' | 'schedule' | 'enabled'>, error: string, now = Date.now()): Promise<void> {
	await sourceDb(env)
		.prepare('UPDATE import_sources SET last_error = ?, next_sync_at = ?, updated_at = ? WHERE id = ?')
		.bind(error.slice(0, 500), row.enabled ? nextImportSyncAt(row.schedule, now) : null, now, row.id)
		.run();
}

export async function saveCursor(env: SourceDbEnv, id: string, cursor: string | null, now = Date.now()): Promise<void> {
	if (cursor === null) return;
	await sourceDb(env).prepare('UPDATE import_sources SET cursor = ?, updated_at = ? WHERE id = ?').bind(cursor, now, id).run();
}

/** Enabled sources whose time has come (the hourly cron), oldest due first. */
export async function dueSources(env: SourceDbEnv, now = Date.now(), limit = 100): Promise<SourceRow[]> {
	const { results } = await sourceDb(env)
		.prepare('SELECT * FROM import_sources WHERE enabled = 1 AND next_sync_at IS NOT NULL AND next_sync_at <= ? ORDER BY next_sync_at LIMIT ?')
		.bind(now, limit)
		.all<SourceRow>();
	return results ?? [];
}

/** Enabled sources reading one address of one network (the Telegram webhook's chat). */
export async function sourcesFor(env: SourceDbEnv, network: ImportSourceNetwork, address: string): Promise<SourceRow[]> {
	const { results } = await sourceDb(env)
		.prepare('SELECT * FROM import_sources WHERE network = ? AND address = ? AND enabled = 1')
		.bind(network, address)
		.all<SourceRow>();
	return results ?? [];
}

export interface NewItem {
	itemId: string;
	kind: ImportItemKind | null;
	state: SourceItemState;
	payload: unknown;
	originalUrl: string | null;
	originalAt: number | null;
	note: ImportItemNote | null;
}

/** Records new items; one already recorded (a re-sync, a resent webhook) is left as it is. Returns how many were new. */
export async function insertItems(env: SourceDbEnv, sourceId: string, items: NewItem[], now = Date.now()): Promise<number> {
	const db = sourceDb(env);
	let added = 0;
	for (const it of items) {
		const r = await db
			.prepare(
				`INSERT INTO import_source_items (source_id, item_id, kind, state, payload, original_url, original_at, note, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (source_id, item_id) DO NOTHING`,
			)
			.bind(sourceId, it.itemId, it.kind, it.state, it.state === 'pending' ? JSON.stringify(it.payload) : null, it.originalUrl, it.originalAt, it.note, now, now)
			.run();
		added += changes(r);
	}
	return added;
}

/** The next pending items, oldest original first (posts go up in the order they were first posted). */
export async function pendingItems(env: SourceDbEnv, sourceId: string, limit: number): Promise<ItemRow[]> {
	const { results } = await sourceDb(env)
		.prepare(`SELECT * FROM import_source_items WHERE source_id = ? AND state = 'pending' ORDER BY original_at IS NULL, original_at, created_at LIMIT ?`)
		.bind(sourceId, limit)
		.all<ItemRow>();
	return results ?? [];
}

export async function listItems(env: SourceDbEnv, sourceId: string, query: { state?: SourceItemState; limit?: number } = {}): Promise<ImportSourceItemView[]> {
	const db = sourceDb(env);
	const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
	const { results } = query.state
		? await db.prepare('SELECT * FROM import_source_items WHERE source_id = ? AND state = ? ORDER BY original_at DESC, created_at DESC LIMIT ?').bind(sourceId, query.state, limit).all<ItemRow>()
		: await db.prepare('SELECT * FROM import_source_items WHERE source_id = ? ORDER BY original_at DESC, created_at DESC LIMIT ?').bind(sourceId, limit).all<ItemRow>();
	return (results ?? []).map(itemView);
}

/** Remembers the post (and video) id before anything is written, so a retry reuses them. */
export async function claimItemIds(env: SourceDbEnv, sourceId: string, itemId: string, ids: { postId?: string; videoId?: string }, now = Date.now()): Promise<void> {
	await sourceDb(env)
		.prepare('UPDATE import_source_items SET post_id = COALESCE(post_id, ?), video_id = COALESCE(video_id, ?), updated_at = ? WHERE source_id = ? AND item_id = ?')
		.bind(ids.postId ?? null, ids.videoId ?? null, now, sourceId, itemId)
		.run();
}

export async function finishItem(env: SourceDbEnv, sourceId: string, itemId: string, outcome: { state: 'posted' | 'skipped' | 'awaiting_file'; note?: ImportItemNote | null }, now = Date.now()): Promise<void> {
	await sourceDb(env)
		.prepare('UPDATE import_source_items SET state = ?, note = ?, payload = NULL, updated_at = ? WHERE source_id = ? AND item_id = ?')
		.bind(outcome.state, outcome.note ?? null, now, sourceId, itemId)
		.run();
}

/** Where an imported post or video came from (social announcements skip the account it came from). */
export async function originOf(env: SourceDbEnv, entityId: string): Promise<Pick<SourceRow, 'network' | 'address' | 'social_account_id'> | null> {
	if (!env.SEARCH_DB) return null;
	return sourceDb(env)
		.prepare(
			`SELECT s.network, s.address, s.social_account_id FROM import_source_items i JOIN import_sources s ON s.id = i.source_id
			 WHERE i.post_id = ? OR i.video_id = ? LIMIT 1`,
		)
		.bind(entityId, entityId)
		.first<Pick<SourceRow, 'network' | 'address' | 'social_account_id'>>();
}

/** Remote ids of posts our own auto-post sent to that network (never imported back). */
export async function ourRemoteIds(env: SourceDbEnv, network: ImportSourceNetwork, remoteIds: string[]): Promise<Set<string>> {
	const ids = remoteIds.filter(Boolean);
	if (!ids.length || network === 'rss' || network === 'youtube') return new Set();
	const { results } = await sourceDb(env)
		.prepare(`SELECT remote_id FROM social_deliveries WHERE network = ? AND remote_id IS NOT NULL AND remote_id IN (${ids.map(() => '?').join(',')})`)
		.bind(network, ...ids)
		.all<{ remote_id: string }>();
	return new Set((results ?? []).map((r) => r.remote_id));
}
