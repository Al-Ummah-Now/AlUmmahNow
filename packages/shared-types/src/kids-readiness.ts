/**
 * `ummahKids` turn-on precondition (wiki E20 §6, §11), readable from any Worker with the search
 * D1 (`admin-api` Features page write path and `api-videos`).
 *
 * Reads only keyed / indexed lookups (`kids_policy_settings`, `kids_catalog_items`,
 * `kids_learning_paths`). Fails closed: missing `SEARCH_DB`, missing tables (before E20-2
 * migration), or any unreadable query returns not ready.
 */
import type { SearchDb } from './search/store';
import type { FeatureText } from './feature-registry';

export const KIDS_DECISION_IDS = [
  'KIDS-D1',
  'KIDS-D2',
  'KIDS-D3',
  'KIDS-D4',
  'KIDS-D5',
  'KIDS-D6',
  'KIDS-D7',
  'KIDS-D8',
  'KIDS-D9',
  'KIDS-D10',
  'KIDS-D11',
  'KIDS-D12',
] as const;

export type KidsDecisionId = (typeof KIDS_DECISION_IDS)[number];

export type KidsTurnOnBlocker = 'decisions_open' | 'legal_not_approved' | 'no_catalog_content';

export interface KidsReadiness {
  ready: boolean;
  blockers: KidsTurnOnBlocker[];
  openDecisions: KidsDecisionId[];
}

export const KIDS_TURN_ON_REASONS: Readonly<Record<KidsTurnOnBlocker, FeatureText>> = Object.freeze({
  decisions_open: {
    en: 'Resolve all Epic 20 owner decisions before turning on Ummah Kids.',
    ar: 'يجب حسم جميع قرارات المالك للملحمة العشرين قبل تشغيل أطفال الأمة.',
  },
  legal_not_approved: {
    en: 'Record legal counsel sign-off before turning on Ummah Kids.',
    ar: 'يجب تسجيل الموافقة القانونية قبل تشغيل أطفال الأمة.',
  },
  no_catalog_content: {
    en: 'Approve at least one item or publish a learning path in the Kids catalog first.',
    ar: 'اعتمد عنصرًا واحدًا أو انشر مسار تعلّم في دليل الأطفال أولًا.',
  },
});

const ALL_BLOCKERS: readonly KidsTurnOnBlocker[] = ['decisions_open', 'legal_not_approved', 'no_catalog_content'];

export interface KidsReadinessEnv {
  SEARCH_DB?: SearchDb;
}

export function kidsReadiness(input: {
  decisions?: Record<string, unknown> | null;
  legalApproved: boolean;
  hasCatalogContent: boolean;
}): KidsReadiness {
  const openDecisions = KIDS_DECISION_IDS.filter((id) => {
    const value = input.decisions?.[id];
    return typeof value !== 'string' || !value.trim();
  });
  const blockers: KidsTurnOnBlocker[] = [];
  if (openDecisions.length > 0) blockers.push('decisions_open');
  if (!input.legalApproved) blockers.push('legal_not_approved');
  if (!input.hasCatalogContent) blockers.push('no_catalog_content');
  return { ready: blockers.length === 0, blockers, openDecisions };
}

export async function kidsCanTurnOn(env: KidsReadinessEnv): Promise<KidsReadiness> {
  const db = env.SEARCH_DB;
  if (!db) return { ready: false, blockers: [...ALL_BLOCKERS], openDecisions: [...KIDS_DECISION_IDS] };
  try {
    const [policyRow, catalogItem, learningPath] = await Promise.all([
      db.prepare("SELECT decisions_json, legal_approved FROM kids_policy_settings WHERE key = 'default'").first<{
        decisions_json: string | null;
        legal_approved: number | null;
      }>(),
      db.prepare("SELECT 1 AS ok FROM kids_catalog_items WHERE status = 'approved' LIMIT 1").first<{ ok: number }>(),
      db.prepare("SELECT 1 AS ok FROM kids_learning_paths WHERE status = 'published' LIMIT 1").first<{ ok: number }>(),
    ]);
    let decisions: Record<string, unknown> | null = null;
    try {
      const parsed = policyRow?.decisions_json ? JSON.parse(policyRow.decisions_json) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) decisions = parsed as Record<string, unknown>;
    } catch {
      decisions = null;
    }
    return kidsReadiness({
      decisions,
      legalApproved: Number(policyRow?.legal_approved ?? 0) === 1,
      hasCatalogContent: !!catalogItem || !!learningPath,
    });
  } catch {
    return { ready: false, blockers: [...ALL_BLOCKERS], openDecisions: [...KIDS_DECISION_IDS] };
  }
}

/** FEAT-4 precondition shape. */
export async function kidsCanTurnOnHook(
  env: KidsReadinessEnv,
): Promise<{ ok: true } | { ok: false; reasonKey: KidsTurnOnBlocker; reason: FeatureText }> {
  const readiness = await kidsCanTurnOn(env);
  if (readiness.ready) return { ok: true };
  const reasonKey = readiness.blockers[0];
  return { ok: false, reasonKey, reason: KIDS_TURN_ON_REASONS[reasonKey] };
}
