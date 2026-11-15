/**
 * The Backfill page's view of this environment before any run (docs/media-delivery/BACKFILL.md): live counts of
 * the videos with no ready R2 rendition, the bytes Bunny stores, and the likely and ceiling cost of moving all of
 * them. Read-only; a run's own estimate (each video's real size) replaces these figures before Start.
 */
import { backfillCostAt, ceilingBasis, type BackfillOverview } from '@al-ummah/shared-types';
import { bunnyStoredBytes, type CostEnv } from '../costs';
import { measuredBasis } from './estimate';
import { BACKFILL_PRICES } from './store';
import type { BackfillEnv } from './types';

/** Bunny's listing pages through every video of each library: kept for a few minutes per isolate. */
const BUNNY_TTL_MS = 10 * 60_000;
let bunnyCache: { at: number; bytes: number | null } | null = null;

export async function backfillOverview(env: BackfillEnv, now = Date.now(), readBunny: (env: CostEnv) => Promise<number | undefined> = bunnyStoredBytes): Promise<BackfillOverview> {
	const db = env.SEARCH_DB!;
	// Two aggregates over the ownership index (videos only), the same rows an "all, only missing" run picks
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n, COALESCE(SUM(c.duration), 0) AS secs,
			   (SELECT COALESCE(SUM(duration), 0) FROM content_ownership WHERE kind = 'video' AND is_deleted = 0 AND COALESCE(is_live, 0) = 0) AS allSecs
			 FROM content_ownership c
			 WHERE c.kind = 'video' AND c.is_deleted = 0 AND COALESCE(c.is_live, 0) = 0
			   AND NOT EXISTS (SELECT 1 FROM media_jobs j WHERE j.video_id = c.id AND j.status = 'ready')`,
		)
		.first<{ n: number; secs: number; allSecs: number }>();
	const videos = Number(row?.n) || 0;
	const secs = Number(row?.secs) || 0;
	const allSecs = Number(row?.allSecs) || 0;
	if (!bunnyCache || now - bunnyCache.at > BUNNY_TTL_MS) {
		const bytes = await readBunny(env as unknown as CostEnv).catch(() => undefined);
		bunnyCache = { at: now, bytes: bytes ?? null };
	}
	const stored = bunnyCache.bytes;
	const basis = await measuredBasis(db);
	// Copies: the missing videos' share (by duration) of what Bunny stores, likely; all of it at the ceiling.
	// Bunny's bytes include its own encodes, so both are at most what is copied.
	const share = allSecs > 0 ? Math.min(1, secs / allSecs) : 0;
	const likelyCopy = stored === null ? 0 : Math.round(stored * share);
	const ceilingCopy = stored === null ? 0 : stored;
	const copyOps = (bytes: number) => (bytes ? Math.ceil(bytes / (64 * 1024 * 1024)) : 0) + videos * 2;
	return {
		videos,
		videoSeconds: Math.round(secs),
		bunnyStoredBytes: stored,
		basis,
		likely: backfillCostAt(BACKFILL_PRICES, basis, { copyBytes: likelyCopy, copyOps: copyOps(likelyCopy), transcodeVideoSeconds: secs, assumedRenditionBytes: likelyCopy }),
		ceiling: backfillCostAt(BACKFILL_PRICES, ceilingBasis(basis), { copyBytes: ceilingCopy, copyOps: copyOps(ceilingCopy), transcodeVideoSeconds: secs }),
		at: new Date(now).toISOString(),
	};
}

/** Tests: forget the cached Bunny bytes. */
export function resetOverviewCache(): void {
	bunnyCache = null;
}
