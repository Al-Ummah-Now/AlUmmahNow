/**
 * Workers AI usage accounting: the daily budget cap and the cost dashboard both read
 * `ai_usage_daily` (plan §4). Every call also logs one `[AI_USAGE]` line.
 */
import type { D1Database } from '@al-ummah/shared-types';
import type { Logger } from '@al-ummah/logger';
import { neuronsFor, usdFor } from './pricing';

export const USAGE_FEATURE = 'moderation';
/** AI category suggestions (src/categorize): same tables, their own budget row and cap. */
export const CATEGORIZE_FEATURE = 'categorize';

export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function neuronsUsedToday(db: D1Database, now: number = Date.now()): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(neurons), 0) AS used FROM ai_usage_daily WHERE day = ? AND feature = ?')
    .bind(utcDay(now), USAGE_FEATURE)
    .first<{ used: number }>();
  return Number(row?.used ?? 0);
}

export interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  surface?: string | undefined;
  /** Budget/usage feature (default 'moderation'). */
  feature?: string | undefined;
}

export async function recordUsage(db: D1Database, logger: Logger, usage: UsageRecord, now: number = Date.now()): Promise<number> {
  const neurons = neuronsFor(usage.model, usage.inputTokens, usage.outputTokens);
  const usd = usdFor(neurons);
  const feature = usage.feature ?? USAGE_FEATURE;
  logger.info('[AI_USAGE]', {
    feature,
    model: usage.model,
    surface: usage.surface,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    neurons: Math.round(neurons * 1000) / 1000,
    usd: Math.round(usd * 1e6) / 1e6,
  });
  await db
    .prepare(
      `INSERT INTO ai_usage_daily (day, model, feature, calls, input_tokens, output_tokens, neurons, usd)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(day, model, feature) DO UPDATE SET
         calls = calls + 1,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         neurons = neurons + excluded.neurons,
         usd = usd + excluded.usd`
    )
    .bind(utcDay(now), usage.model, feature, usage.inputTokens, usage.outputTokens, neurons, usd)
    .run();
  return neurons;
}
