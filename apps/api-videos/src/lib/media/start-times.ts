/**
 * How long R2 transcodes take to start (TranscodeStartup, recorded in media_jobs by recordJob): the
 * Delivery panel's "start time" and its cold/warm split. Start = the Transcoder began the attempt
 * (a slot was free) → FFmpeg running in the container (the accept time when FFmpeg's is missing).
 */

export const START_TIMES_DAYS = 7;
const MAX_ROWS = 500;

export interface StartTimeStats {
	/** Window in days */
	days: number;
	samples: number;
	p50Ms: number | null;
	p95Ms: number | null;
	cold: { samples: number; p50Ms: number | null; p95Ms: number | null };
	warm: { samples: number; p50Ms: number | null; p95Ms: number | null };
	/** Container booted and listening (cold starts) */
	coldReadyP50Ms: number | null;
	/** Queued → the attempt began (queue delivery and any wait for a slot) */
	dispatchP50Ms: number | null;
}

export interface StartTimeRow {
	start_cold: number | null;
	ms: number | null;
	start_ready_ms: number | null;
	start_dispatch_ms: number | null;
}

/** The p-th percentile (0..100), nearest rank, of unsorted numbers; null when empty. */
export function percentileMs(values: number[], p: number): number | null {
	const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
	if (!v.length) return null;
	return v[Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length))) - 1]!;
}

/** One column's values, leaving out NULLs (Number(null) would read as 0). */
const present = (rows: StartTimeRow[], key: 'start_ready_ms' | 'start_dispatch_ms') => rows.filter((r) => r[key] !== null && r[key] !== undefined).map((r) => Number(r[key]));

export function startTimeStats(rows: StartTimeRow[], days = START_TIMES_DAYS): StartTimeStats {
	const ms = (r: StartTimeRow[]) => r.map((x) => Number(x.ms));
	const timed = rows.filter((r) => r.ms !== null && r.ms !== undefined && Number.isFinite(Number(r.ms)));
	const cold = timed.filter((r) => r.start_cold === 1);
	const warm = timed.filter((r) => r.start_cold === 0);
	const part = (r: StartTimeRow[]) => ({ samples: r.length, p50Ms: percentileMs(ms(r), 50), p95Ms: percentileMs(ms(r), 95) });
	return {
		days,
		samples: timed.length,
		p50Ms: percentileMs(ms(timed), 50),
		p95Ms: percentileMs(ms(timed), 95),
		cold: part(cold),
		warm: part(warm),
		coldReadyP50Ms: percentileMs(present(cold, 'start_ready_ms'), 50),
		dispatchP50Ms: percentileMs(present(timed, 'start_dispatch_ms'), 50),
	};
}

/** The latest starts over the window (newest first, bounded); null without the database. */
export async function readStartTimes(db: D1Database | undefined, now = Date.now(), days = START_TIMES_DAYS): Promise<StartTimeStats | null> {
	if (!db) return null;
	const { results } = await db
		.prepare(
			`SELECT start_cold, COALESCE(start_ffmpeg_ms, start_accept_ms) AS ms, start_ready_ms, start_dispatch_ms
			 FROM media_jobs WHERE queued_at >= ?1 AND start_accept_ms IS NOT NULL ORDER BY queued_at DESC LIMIT ${MAX_ROWS}`,
		)
		.bind(new Date(now - days * 86_400_000).toISOString())
		.all<StartTimeRow>();
	return startTimeStats(results ?? [], days);
}
