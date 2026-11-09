/**
 * Moderation queue consumer (plan §1): kill switch → budget → normalise/detect →
 * (ar) translate → Llama Guard → (opt) extension classifier → decide → signal + audit.
 *
 * Fail safe: an AI failure never touches the content. Transient errors are retried by
 * the queue; on the last attempt a `skipped:error` signal is written and the message acked.
 */
import type { Logger } from '@al-ummah/logger';
import type { D1Database, ModerationScanPayload } from '@al-ummah/shared-types';
import { MODERATION_MAX_TEXT } from '@al-ummah/shared-types';
import { AiBinding, AiContext, runExtensions, runGuard, translateToEnglish } from './ai';
import { loadConfig, PROMPT_VERSION } from './config';
import { decide } from './decide';
import { MODELS } from './pricing';
import { writeSignal } from './store';
import { arabicLetterCount, detectLanguage, latinLetterCount, normalizeText } from './text';
import { neuronsUsedToday } from './usage';

export interface ModerationConsumerEnv {
  REPORTS_DB: D1Database;
  AI?: AiBinding | undefined;
  AI_MODERATION_ENABLED?: string | undefined;
  AI_MODERATION_DAILY_NEURON_CAP?: string | undefined;
  AI_GATEWAY_ID?: string | undefined;
}

export type ScanOutcome =
  | { status: 'done'; signalId?: string; decision: string }
  | { status: 'retry'; error: string };

const SURFACES = new Set(['video_comment', 'community_post', 'post_comment', 'video_metadata']);

export function isScanPayload(value: unknown): value is ModerationScanPayload {
  const p = value as ModerationScanPayload | null;
  return !!p && typeof p === 'object' && SURFACES.has(p.surface) && typeof p.subjectId === 'string' && p.subjectId.length > 0 && typeof p.text === 'string';
}

export async function handleModerationScan(
  payload: ModerationScanPayload,
  env: ModerationConsumerEnv,
  logger: Logger,
  opts: { lastAttempt: boolean; now?: number } = { lastAttempt: true }
): Promise<ScanOutcome> {
  const now = opts.now ?? Date.now();
  const db = env.REPORTS_DB;
  const config = await loadConfig(env);

  if (!config.enabled || !env.AI) {
    // Off: no AI call and no row (keeps D1 quiet in environments where it is switched off).
    logger.debug('[Moderation] Disabled, scan skipped', { surface: payload.surface, subjectId: payload.subjectId, hasAi: !!env.AI });
    return { status: 'done', decision: 'skipped:disabled' };
  }

  // The sender already capped the raw text at MODERATION_MAX_TEXT. NFKC can expand it (ligatures),
  // so the cap here is generous: cutting at the same length would drop the end of the text unscanned.
  const text = normalizeText(payload.text.slice(0, MODERATION_MAX_TEXT)).slice(0, MODERATION_MAX_TEXT * 2);
  const language = detectLanguage(text);
  const base = { payload, language, scores: {}, topCategory: null, topScore: null, models: [], promptVersion: PROMPT_VERSION, priority: 0 };

  if (!text) {
    return { status: 'done', decision: 'skipped:empty' };
  }

  const used = await neuronsUsedToday(db, now);
  if (config.dailyNeuronCap !== null && used >= config.dailyNeuronCap) {
    logger.warn('[Moderation] Daily neuron cap reached, scan skipped', { used, cap: config.dailyNeuronCap, subjectId: payload.subjectId });
    const signalId = await writeSignal(db, { ...base, decision: 'skipped', skipReason: 'budget' }, now);
    return { status: 'done', signalId, decision: 'skipped:budget' };
  }

  const ctx: AiContext = { ai: env.AI, db, logger, gatewayId: env.AI_GATEWAY_ID || undefined, surface: payload.surface, spent: 0, now };
  const models: string[] = [];
  let translation: string | undefined;
  let rationale: string | undefined;
  const scores: Record<string, number> = {};

  try {
    // Llama Guard does not list Arabic, so any Arabic is translated (not only Arabic-majority
    // text: otherwise a few English words could carry Arabic abuse past it). Mixed text is also
    // checked as-is; the stricter verdict wins.
    const arabic = arabicLetterCount(text);
    const latin = latinLetterCount(text);
    const guardInputs: string[] = [];
    if (arabic > 0) {
      translation = await translateToEnglish(ctx, text);
      models.push(MODELS.translate);
      guardInputs.push(translation);
      if (latin > 0) guardInputs.push(text);
    } else {
      guardInputs.push(text);
    }
    for (const input of guardInputs) {
      for (const [category, score] of Object.entries(await runGuard(ctx, input))) {
        scores[category] = Math.max(scores[category] ?? 0, score);
      }
    }
    models.push(MODELS.guard);

    if (config.extensionsEnabled) {
      const ext = await runExtensions(ctx, text);
      Object.assign(scores, ext.scores);
      rationale = ext.rationale;
      models.push(MODELS.extensions);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!opts.lastAttempt) {
      logger.warn('[Moderation] AI call failed, will retry', { subjectId: payload.subjectId, error: message });
      return { status: 'retry', error: message };
    }
    logger.error('[Moderation] AI call failed on last attempt, scan skipped', { subjectId: payload.subjectId, error: message });
    const signalId = await writeSignal(db, { ...base, models, decision: 'skipped', skipReason: 'error' }, now);
    return { status: 'done', signalId, decision: 'skipped:error' };
  }

  // Trust score arrives with story 28.2; until then nobody is "low trust", so charity_scam can only flag.
  const result = decide(scores, config.policies, { lowTrust: false, autoHideAvailable: false });
  const signalId = await writeSignal(
    db,
    {
      ...base,
      scores,
      topCategory: result.topCategory,
      topScore: result.topScore,
      models,
      decision: result.decision,
      priority: result.priority,
      translation,
      rationale,
      note: result.note,
    },
    now
  );
  logger.info('[Moderation] Scan complete', {
    surface: payload.surface,
    subjectId: payload.subjectId,
    language,
    decision: result.decision,
    topCategory: result.topCategory,
    topScore: result.topScore,
    neurons: Math.round(ctx.spent * 1000) / 1000,
    signalId,
  });
  return { status: 'done', signalId, decision: result.decision };
}
