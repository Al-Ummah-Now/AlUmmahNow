/**
 * Admin-curated Islamic seasons (wiki Epic 21 §4 21.2 and §5.3): Ramadan, the first ten days of
 * Dhul-Hijjah and others. A season is bilingual (title, description, source label), has start and
 * end dates set by an admin (an override of the provider's Hijri calendar, never a claim of a moon
 * sighting) and ordered rails of videos, playlists and live channels. Admin-api audits every change.
 * Deletes are soft and purged after 30 days. Every query reads an index; nothing scans the table.
 */
export const SEASON_KINDS = ['ramadan', 'dhul_hijjah', 'other'] as const;
export type SeasonKind = (typeof SEASON_KINDS)[number];
export const SEASON_ITEM_TYPES = ['video', 'playlist', 'live_channel'] as const;
export type SeasonItemType = (typeof SEASON_ITEM_TYPES)[number];
export const SEASON_ITEMS_MAX = 100;
export const SEASON_DAYS_MAX = 60;
export const PURGE_DAYS = 30;

export interface SeasonItem {
	type: SeasonItemType;
	id: string;
}

export interface Season {
	id: string;
	kind: SeasonKind;
	title: { en: string; ar: string };
	description: { en: string; ar: string };
	source: { en: string; ar: string };
	startsOn: string;
	endsOn: string;
	state: 'draft' | 'published';
	version: number;
	items: SeasonItem[];
	updatedAt: string;
	updatedBy: string;
	deletedAt: string | null;
}

export class SeasonError extends Error {
	constructor(
		readonly status: 400 | 404 | 409,
		readonly code: string,
	) {
		super(code);
	}
}

interface Row {
	id: string;
	kind: SeasonKind;
	title_en: string;
	title_ar: string;
	description_en: string;
	description_ar: string;
	source_en: string;
	source_ar: string;
	starts_on: string;
	ends_on: string;
	state: 'draft' | 'published';
	version: number;
	updated_at: string;
	updated_by: string;
	deleted_at: string | null;
}

const COLUMNS = 'id, kind, title_en, title_ar, description_en, description_ar, source_en, source_ar, starts_on, ends_on, state, version, updated_at, updated_by, deleted_at';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toSeason(row: Row, items: SeasonItem[]): Season {
	return {
		id: row.id,
		kind: row.kind,
		title: { en: row.title_en, ar: row.title_ar },
		description: { en: row.description_en, ar: row.description_ar },
		source: { en: row.source_en, ar: row.source_ar },
		startsOn: row.starts_on,
		endsOn: row.ends_on,
		state: row.state,
		version: Number(row.version),
		items,
		updatedAt: row.updated_at,
		updatedBy: row.updated_by,
		deletedAt: row.deleted_at ?? null,
	};
}

async function itemsOf(db: D1Database, id: string): Promise<SeasonItem[]> {
	const { results } = await db.prepare('SELECT item_type, item_id FROM islamic_season_items WHERE season_id = ? ORDER BY position').bind(id).all<{ item_type: SeasonItemType; item_id: string }>();
	return (results ?? []).map((r) => ({ type: r.item_type, id: r.item_id }));
}

export async function readSeason(db: D1Database, id: string): Promise<Season | null> {
	const row = await db.prepare(`SELECT ${COLUMNS} FROM islamic_seasons WHERE id = ?`).bind(id).first<Row>();
	return row ? toSeason(row, await itemsOf(db, id)) : null;
}

export interface SeasonInput {
	kind: SeasonKind;
	title: { en: string; ar: string };
	description?: { en: string; ar: string };
	source: { en: string; ar: string };
	startsOn: string;
	endsOn: string;
	items: SeasonItem[];
}

/** Both languages for every text (localized-fields rule), sane dates, bounded items. */
export function checkSeason(input: SeasonInput): void {
	const both = (t: { en: string; ar: string } | undefined) => !!t && t.en.trim().length > 0 && t.ar.trim().length > 0;
	if (!both(input.title) || !both(input.source)) throw new SeasonError(400, 'invalid_request');
	if (input.description && (input.description.en.trim() === '') !== (input.description.ar.trim() === '')) throw new SeasonError(400, 'invalid_request');
	if (!DATE.test(input.startsOn) || !DATE.test(input.endsOn) || input.endsOn < input.startsOn) throw new SeasonError(400, 'invalid_request');
	const days = (Date.parse(`${input.endsOn}T00:00:00Z`) - Date.parse(`${input.startsOn}T00:00:00Z`)) / 86_400_000;
	if (!Number.isFinite(days) || days > SEASON_DAYS_MAX) throw new SeasonError(400, 'invalid_request');
	if (input.items.length > SEASON_ITEMS_MAX) throw new SeasonError(400, 'invalid_request');
}

function itemStatements(db: D1Database, id: string, items: SeasonItem[]) {
	return [
		db.prepare('DELETE FROM islamic_season_items WHERE season_id = ?').bind(id),
		...items.map((item, position) => db.prepare('INSERT INTO islamic_season_items (season_id, position, item_type, item_id) VALUES (?, ?, ?, ?)').bind(id, position, item.type, item.id)),
	];
}

export async function createSeason(db: D1Database, input: SeasonInput, actor: string, now = new Date().toISOString()): Promise<Season> {
	checkSeason(input);
	const id = crypto.randomUUID();
	const d = input.description ?? { en: '', ar: '' };
	await db.batch([
		db
			.prepare(
				`INSERT INTO islamic_seasons (id, kind, title_en, title_ar, description_en, description_ar, source_en, source_ar, starts_on, ends_on, state, version, created_at, updated_at, updated_by)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?)`,
			)
			.bind(id, input.kind, input.title.en.trim(), input.title.ar.trim(), d.en.trim(), d.ar.trim(), input.source.en.trim(), input.source.ar.trim(), input.startsOn, input.endsOn, now, now, actor),
		...itemStatements(db, id, input.items),
	]);
	return (await readSeason(db, id))!;
}

/** Optimistic: `version` must match the stored one. Returns the previous and the new season (for the audit). */
export async function updateSeason(db: D1Database, id: string, version: number, input: SeasonInput & { state?: 'draft' | 'published' }, actor: string, now = new Date().toISOString()) {
	checkSeason(input);
	const previous = await readSeason(db, id);
	if (!previous || previous.deletedAt) throw new SeasonError(404, 'not_found');
	if (previous.version !== version) throw new SeasonError(409, 'conflict');
	const d = input.description ?? { en: '', ar: '' };
	const results = await db.batch([
		db
			.prepare(
				`UPDATE islamic_seasons SET kind = ?, title_en = ?, title_ar = ?, description_en = ?, description_ar = ?, source_en = ?, source_ar = ?, starts_on = ?, ends_on = ?,
				   state = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ? AND deleted_at IS NULL`,
			)
			.bind(input.kind, input.title.en.trim(), input.title.ar.trim(), d.en.trim(), d.ar.trim(), input.source.en.trim(), input.source.ar.trim(), input.startsOn, input.endsOn, input.state ?? previous.state, now, actor, id, version),
		...itemStatements(db, id, input.items),
	]);
	if (Number(results[0]?.meta?.changes ?? 0) === 0) throw new SeasonError(409, 'conflict');
	return { previous, season: (await readSeason(db, id))! };
}

export async function deleteSeason(db: D1Database, id: string, actor: string, now = new Date()) {
	const purge = new Date(now.getTime() + PURGE_DAYS * 86_400_000).toISOString();
	const r = await db
		.prepare('UPDATE islamic_seasons SET deleted_at = ?, purge_after = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL')
		.bind(now.toISOString(), purge, now.toISOString(), actor, id)
		.run();
	if (Number(r.meta?.changes ?? 0) === 0) throw new SeasonError(404, 'not_found');
	return readSeason(db, id);
}

export async function restoreSeason(db: D1Database, id: string, actor: string, now = new Date().toISOString()) {
	const r = await db
		.prepare('UPDATE islamic_seasons SET deleted_at = NULL, purge_after = NULL, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND deleted_at IS NOT NULL')
		.bind(now, actor, id)
		.run();
	if (Number(r.meta?.changes ?? 0) === 0) throw new SeasonError(404, 'not_found');
	return readSeason(db, id);
}

/** Purges seasons deleted more than 30 days ago (idx_islamic_seasons_purge), at most `limit` a call. */
export async function purgeSeasons(db: D1Database, now = new Date().toISOString(), limit = 50): Promise<string[]> {
	const { results } = await db.prepare('SELECT id FROM islamic_seasons WHERE purge_after IS NOT NULL AND purge_after <= ? LIMIT ?').bind(now, limit).all<{ id: string }>();
	const ids = (results ?? []).map((r) => r.id);
	if (ids.length) {
		await db.batch(ids.flatMap((id) => [db.prepare('DELETE FROM islamic_season_items WHERE season_id = ?').bind(id), db.prepare('DELETE FROM islamic_seasons WHERE id = ?').bind(id)]));
	}
	return ids;
}

/** Admin list, newest start first, keyset by (starts_on, id); deleted ones only when asked. */
export async function listSeasons(db: D1Database, opts: { deleted?: boolean; cursor?: string; limit?: number } = {}): Promise<{ items: Season[]; nextCursor: string | null }> {
	const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
	const [startsOn, id] = opts.cursor ? opts.cursor.split('|') : ['9999-12-31', '￿'];
	const { results } = await db
		.prepare(
			`SELECT ${COLUMNS} FROM islamic_seasons WHERE state IN ('draft', 'published') AND (starts_on < ? OR (starts_on = ? AND id < ?))
			 AND deleted_at IS ${opts.deleted ? 'NOT NULL' : 'NULL'} ORDER BY starts_on DESC, id DESC LIMIT ?`,
		)
		.bind(startsOn, startsOn, id, limit + 1)
		.all<Row>();
	const rows = results ?? [];
	const page = rows.slice(0, limit);
	const items = await Promise.all(page.map(async (row) => toSeason(row, await itemsOf(db, row.id))));
	const last = page[page.length - 1];
	return { items, nextCursor: rows.length > limit && last ? `${last.starts_on}|${last.id}` : null };
}

/** The published season covering `date` (the latest-starting one when several do). */
export async function activeSeason(db: D1Database, date: string): Promise<Season | null> {
	if (!DATE.test(date)) return null;
	const earliest = new Date(Date.parse(`${date}T00:00:00Z`) - SEASON_DAYS_MAX * 86_400_000).toISOString().slice(0, 10);
	const row = await db
		.prepare(
			`SELECT ${COLUMNS} FROM islamic_seasons WHERE state = 'published' AND starts_on <= ? AND starts_on >= ? AND ends_on >= ? AND deleted_at IS NULL
			 ORDER BY starts_on DESC, id DESC LIMIT 1`,
		)
		.bind(date, earliest, date)
		.first<Row>();
	return row ? toSeason(row, await itemsOf(db, row.id)) : null;
}
