/**
 * Decision engine (plan §3). Pure: scores + policies → decision.
 *
 * Invariants (unit tested):
 *  - AI never deletes. The strongest outcome is `hide`, which is reversible.
 *  - `hide` only for AI_HIDEABLE_CATEGORIES (spam, charity_scam); charity_scam also needs a low-trust author.
 *  - shadow mode records `would_*` and takes no action.
 *  - while automatic hide is not available (Phase A), an enforced hide becomes `flag` (human review).
 */
import type { ModerationCategory, ModerationCategoryPolicy, ModerationDecision } from '@al-ummah/shared-types';
import { AI_HIDEABLE_CATEGORIES } from '@al-ummah/shared-types';

const SEVERITY: Partial<Record<string, number>> = {
  S4: 100,
  violent_extremism: 90,
  S1: 80,
  S9: 80,
  S3: 80,
  charity_scam: 70,
  sectarian_hate: 70,
  S10: 60,
  S11: 60,
  harassment: 50,
  sexual: 50,
  S12: 50,
  impersonation: 50,
  misinfo_health: 40,
  spam: 20,
};
const DEFAULT_SEVERITY = 30;
/** Categories escalated to the top of the queue whatever their score. */
const ESCALATE = new Set(['S4', 'violent_extremism']);

export interface DecisionContext {
  lowTrust: boolean;
  autoHideAvailable: boolean;
}

export interface Decision {
  decision: ModerationDecision;
  topCategory: string | null;
  topScore: number | null;
  priority: number;
  escalate: boolean;
  /** Why an enforced hide was downgraded, if it was. */
  note?: string | undefined;
}

const RANK: Record<string, number> = { none: 0, flag: 1, hide: 2 };

export function decide(
  scores: Record<string, number>,
  policies: Partial<Record<ModerationCategory, ModerationCategoryPolicy>>,
  ctx: DecisionContext
): Decision {
  let best: { action: 'none' | 'flag' | 'hide'; mode: 'shadow' | 'enforce'; category: string; score: number; weight: number; note?: string | undefined } | null = null;
  let topCategory: string | null = null;
  let topScore: number | null = null;
  let escalate = false;

  for (const [category, score] of Object.entries(scores)) {
    if (topScore === null || score > topScore) {
      topScore = score;
      topCategory = category;
    }
    const policy = policies[category as ModerationCategory];
    if (!policy || !policy.enabled || score < policy.threshold || policy.action === 'none') continue;

    let action: 'flag' | 'hide' = policy.action;
    let note: string | undefined;
    if (action === 'hide' && !AI_HIDEABLE_CATEGORIES.includes(category as ModerationCategory)) action = 'flag';
    if (action === 'hide' && category === 'charity_scam' && !ctx.lowTrust) {
      action = 'flag';
      note = 'charity_scam hides only for low-trust authors';
    }
    if (action === 'hide' && policy.mode === 'enforce' && !ctx.autoHideAvailable) {
      action = 'flag';
      note = 'automatic hide not enabled yet; sent to human review';
    }
    if (ESCALATE.has(category)) escalate = true;

    const weight = (SEVERITY[category] ?? DEFAULT_SEVERITY) * score;
    const bestRank = best ? (RANK[best.action] ?? 0) : -1;
    const rank = RANK[action] ?? 0;
    if (!best || rank > bestRank || (rank === bestRank && weight > best.weight)) {
      best = { action, mode: policy.mode, category, score, weight, note };
    }
  }

  if (!best) return { decision: 'none', topCategory, topScore, priority: 0, escalate: false };

  const decision: ModerationDecision =
    best.mode === 'shadow' ? (best.action === 'hide' ? 'would_hide' : 'would_flag') : best.action;
  return {
    decision,
    topCategory: best.category,
    topScore: best.score,
    priority: escalate ? 100 : Math.round(best.weight),
    escalate,
    note: best.note,
  };
}
