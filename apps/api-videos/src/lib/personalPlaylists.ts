/**
 * A user's personal playlists (made without a channel), for "my playlists" (GET /api/playlists?mine=true)
 * and the public profile (GET /api/users/by-handle/:handle/playlists, Story 29.5).
 *
 * The privacy footprints name every playlist's owner: once that index is trusted, only those
 * records are read (a superset: `keep` decides). Before that, a bounded scan of the bucket.
 */

import type { z } from 'zod';
import type { SearchDb } from '@al-ummah/shared-types';
import type { Playlist } from './types';
import R2Repository from './r2Repo';
import { footprintsComplete, footprintTargets } from './privacy/footprints';

type PlaylistType = z.infer<typeof Playlist>;

const SCAN_PAGE_SIZE = 100;
const SCAN_MAX_PAGES = 20;

export async function collectPersonalPlaylists(
	env: { playlists: R2Bucket; SEARCH_DB?: unknown },
	userId: string,
	keep: (playlist: PlaylistType | null) => playlist is PlaylistType,
): Promise<{ playlists: PlaylistType[]; source: 'footprints' | 'scan' }> {
	const repository = new R2Repository<PlaylistType>(env.playlists);
	const db = env.SEARCH_DB as SearchDb | undefined;
	const indexed = db && (await footprintsComplete(db, 'playlists').catch(() => false))
		? await footprintTargets(db, userId, 'playlist').catch(() => null)
		: null;
	const playlists: PlaylistType[] = [];
	if (indexed) {
		for (const p of await Promise.all(indexed.map((key) => repository.getObject(key).catch(() => null)))) {
			if (keep(p)) playlists.push(p);
		}
		return { playlists, source: 'footprints' };
	}
	let cursor: string | undefined;
	for (let page = 0; page < SCAN_MAX_PAGES; page++) {
		const result = await repository.listObjects(SCAN_PAGE_SIZE, cursor);
		for (const playlist of result.items || []) if (keep(playlist)) playlists.push(playlist);
		if (!result.cursor) break;
		cursor = result.cursor;
	}
	return { playlists, source: 'scan' };
}
