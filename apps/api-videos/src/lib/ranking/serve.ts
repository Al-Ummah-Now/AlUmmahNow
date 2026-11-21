/**
 * Reading a ranked rail (wiki E07 "Discovery ranking"): one keyset seek on
 * discovery_rail_items (rail, scope, position) for the page's ids, then the
 * video objects from R2 (the source of truth: a video made private since the
 * last run is dropped here) with their channel names per language.
 *
 * Pages are full: a few extra positions are read so videos dropped since the
 * run don't leave a page short. The cursor is the last position served
 * ('p:<n>'); the old offset cursors ({ offset } in base64) still work.
 *
 * Returns null when the rails can't be read (SEARCH_DB unbound, the tables not
 * migrated yet, or no run has written the rail): callers fall back to their
 * previous index query.
 */
import type { VideoObject } from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { isVideoPubliclyVisible } from '../visibility';
import { withChannelNames } from '../channelNames';
import { logger } from '../logger';
import type { RailId } from './job';
import type { ItemReason, RailLabel, RailMode } from './rank';

export const MAX_RAIL_PAGE = 50;
/** Extra positions read per page to cover videos dropped since the run */
const OVERFETCH = 8;

interface Db {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }>; first<T>(): Promise<T | null> } };
}

export interface RailMeta {
	rail: RailId;
	scope: string;
	mode: RailMode;
	label: RailLabel;
	items: number;
	signalItems: number;
	computedAt: string;
}

export interface RailEntry {
	video: VideoObject;
	position: number;
	reason: ItemReason;
	score: number;
}

export interface RailPage {
	meta: RailMeta;
	entries: RailEntry[];
	/** Cursor of the next page, when there is one */
	nextCursor?: string;
}

/** Pure: the position a cursor stands after (0 = first page). */
export function decodeRailCursor(cursor: string | null | undefined): number {
	if (!cursor) return 0;
	const keyset = /^p:(\d{1,7})$/.exec(cursor);
	if (keyset) return Number(keyset[1]);
	try {
		// Old offset cursors (lib/sections/sectionIndex.ts): position = offset
		const offset = Number(JSON.parse(atob(cursor))?.offset);
		return Number.isInteger(offset) && offset > 0 ? offset : 0;
	} catch {
		return 0;
	}
}

export const encodeRailCursor = (position: number) => `p:${position}`;

/**
 * Pure: the scope to read for a request: a category wins; `onlyLanguage` is a content-language
 * filter (only that language's videos); `language` is the viewer's language (ranks its videos higher).
 */
export function railScope(options: { category?: string | null; language?: string | null; onlyLanguage?: string | null }): string {
	if (options.category) return `cat:${options.category}`;
	if (options.onlyLanguage === 'ar' || options.onlyLanguage === 'en') return `only:${options.onlyLanguage}`;
	if (options.language === 'ar' || options.language === 'en') return `lang:${options.language}`;
	return '';
}

async function readMeta(db: Db, rail: RailId, scope: string): Promise<RailMeta | null> {
	const row = await db
		.prepare('SELECT rail, scope, mode, label, items, signal_items, computed_at FROM discovery_rails WHERE rail = ? AND scope = ?')
		.bind(rail, scope)
		.first<{ rail: RailId; scope: string; mode: RailMode; label: RailLabel; items: number; signal_items: number; computed_at: number }>();
	if (!row) return null;
	return {
		rail: row.rail,
		scope: row.scope,
		mode: row.mode,
		label: row.label,
		items: Number(row.items) || 0,
		signalItems: Number(row.signal_items) || 0,
		computedAt: new Date(Number(row.computed_at)).toISOString(),
	};
}

/**
 * One page of a rail. A language scope without rails falls back to the
 * unscoped rail; a category without rails is an empty page.
 */
export async function railPage(
	env: { SEARCH_DB?: unknown; videos: R2Bucket; channels?: R2Bucket },
	options: { rail: RailId; scope: string; limit: number; cursor?: string | null },
): Promise<RailPage | null> {
	const db = env.SEARCH_DB as Db | undefined;
	if (!db) return null;
	const limit = Math.min(MAX_RAIL_PAGE, Math.max(1, Math.trunc(options.limit) || 12));
	const after = decodeRailCursor(options.cursor);
	let scope = options.scope;
	let meta: RailMeta | null;
	let rows: Array<{ position: number; video_id: string; reason: ItemReason; score: number }>;
	try {
		meta = await readMeta(db, options.rail, scope);
		if (!meta && scope.startsWith('lang:')) {
			scope = '';
			meta = await readMeta(db, options.rail, scope);
		}
		if (!meta) return null;
		const { results = [] } = await db
			.prepare('SELECT position, video_id, reason, score FROM discovery_rail_items WHERE rail = ? AND scope = ? AND position > ? ORDER BY position LIMIT ?')
			.bind(options.rail, scope, after, limit + OVERFETCH)
			.all<{ position: number; video_id: string; reason: ItemReason; score: number }>();
		rows = results;
	} catch (error) {
		// Not migrated yet, or D1 unavailable: the caller serves its previous query
		logger.warn('[Discovery] Rail read failed', { rail: options.rail, scope, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
	const repo = new R2Repository<VideoObject>(env.videos);
	const objects = await Promise.all(rows.map((row) => repo.getObject(row.video_id).catch(() => null)));
	const kept: RailEntry[] = [];
	let lastPosition = after;
	let consumed = 0;
	for (let i = 0; i < rows.length && kept.length < limit; i++) {
		consumed = i + 1;
		lastPosition = Number(rows[i].position);
		const video = objects[i];
		if (!isVideoPubliclyVisible(video)) continue;
		kept.push({ video: video as VideoObject, position: lastPosition, reason: rows[i].reason, score: Number(rows[i].score) || 0 });
	}
	const named = (await withChannelNames(env.channels, kept.map((e) => e.video))) as VideoObject[];
	const entries = kept.map((e, i) => ({ ...e, video: named[i] }));
	const more = consumed < rows.length || lastPosition < meta.items;
	return { meta: { ...meta, scope }, entries, nextCursor: more && entries.length > 0 ? encodeRailCursor(lastPosition) : undefined };
}

/** Pure: the label a client shows for a section, with the mode it reflects. */
export function railLabelFields(meta: RailMeta): { mode: RailMode; label: RailLabel; signalItems: number; computedAt: string } {
	return { mode: meta.mode, label: meta.label, signalItems: meta.signalItems, computedAt: meta.computedAt };
}

/** The ids of a rail in order (the first `limit`), or null when it can't be read. */
export async function railIds(env: { SEARCH_DB?: unknown }, rail: RailId, scope: string, limit: number): Promise<string[] | null> {
	const db = env.SEARCH_DB as Db | undefined;
	if (!db) return null;
	try {
		const read = (s: string) =>
			db
				.prepare('SELECT video_id FROM discovery_rail_items WHERE rail = ? AND scope = ? ORDER BY position LIMIT ?')
				.bind(rail, s, limit)
				.all<{ video_id: string }>();
		let { results = [] } = await read(scope);
		if (results.length === 0 && scope.startsWith('lang:')) ({ results = [] } = await read(''));
		return results.map((r) => r.video_id);
	} catch (error) {
		logger.warn('[Discovery] Rail ids read failed', { rail, scope, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}
