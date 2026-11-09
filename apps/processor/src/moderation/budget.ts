/**
 * Daily AI budget reservations (table ai_budget_daily, SCALABILITY-AUDIT PR-9).
 *
 * A scan reserves its worst-case cost before calling Workers AI, in one
 * conditional UPDATE, and settles to what it really spent afterwards. Every
 * scan in flight is counted in `reserved`, so the cap can only be crossed by
 * the one scan that starts below it, however many consumers run at once.
 */
import type { D1Database } from '@al-ummah/shared-types';
import { MODELS, neuronsFor } from './pricing';
import { estimateTokens } from './text';
import { USAGE_FEATURE, utcDay } from './usage';

/** Prompt tokens the models add around the text (system prompts, templates). */
const GUARD_PROMPT_TOKENS = 450;
const EXTENSIONS_PROMPT_TOKENS = 700;
const EXTENSIONS_MAX_OUTPUT = 300;
const GUARD_MAX_OUTPUT = 20;

/** Most a scan of this text can cost, in neurons (translation, up to two guard runs, extensions). */
export function estimateScanNeurons(text: string, opts: { arabic: boolean; latin: boolean; extensions: boolean }): number {
	const t = estimateTokens(text);
	let neurons = 0;
	let guardRuns = 1;
	if (opts.arabic) {
		neurons += neuronsFor(MODELS.translate, t, t * 2);
		if (opts.latin) guardRuns = 2;
	}
	neurons += guardRuns * neuronsFor(MODELS.guard, t * 2 + GUARD_PROMPT_TOKENS, GUARD_MAX_OUTPUT);
	if (opts.extensions) neurons += neuronsFor(MODELS.extensions, t + EXTENSIONS_PROMPT_TOKENS, EXTENSIONS_MAX_OUTPUT);
	return neurons * 1.25;
}

/**
 * Reserves `estimate` neurons for today when today's reservations are still
 * under `cap` (null = no cap; the reservation is still recorded so a cap set
 * later in the day sees the day's spend). Returns false when the cap is reached.
 */
export async function reserveBudget(db: D1Database, cap: number | null, estimate: number, now: number = Date.now()): Promise<boolean> {
	const day = utcDay(now);
	const [, claim] = await db.batch<{ reserved: number }>([
		db
			.prepare(
				`INSERT OR IGNORE INTO ai_budget_daily (day, feature, reserved)
				 VALUES (?1, ?2, (SELECT COALESCE(SUM(neurons), 0) FROM ai_usage_daily WHERE day = ?1 AND feature = ?2))`,
			)
			.bind(day, USAGE_FEATURE),
		db
			.prepare(
				`UPDATE ai_budget_daily SET reserved = reserved + ?3
				 WHERE day = ?1 AND feature = ?2 AND (?4 IS NULL OR reserved < ?4)
				 RETURNING reserved`,
			)
			.bind(day, USAGE_FEATURE, estimate, cap),
	]);
	return (claim?.results?.length ?? 0) > 0;
}

/** Replaces a reservation with what the scan really spent. */
export async function settleBudget(db: D1Database, estimate: number, spent: number, now: number = Date.now()): Promise<void> {
	await db
		.prepare('UPDATE ai_budget_daily SET reserved = max(0, reserved + ? - ?) WHERE day = ? AND feature = ?')
		.bind(spent, estimate, utcDay(now), USAGE_FEATURE)
		.run();
}
