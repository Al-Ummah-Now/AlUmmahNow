/**
 * Conditions a switch must meet before it may be turned on (FEAT-4; wiki AUN-FEATURES §5.3).
 * A switch whose check fails is refused with 409 `feature_precondition` and the check's reason,
 * shown to the admin under the switch. Turning a switch off is never refused.
 *
 * Each check is owned by its feature's epic and must be fast (one or two reads) and fail closed:
 * a check that throws refuses with the generic reason.
 */
import { supportCanTurnOnHook, type FeatureKey, type FeatureText } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { ageRulesChecks } from './age-rules-checks';

/** `reasonKey` is the check's stable reason code, passed to clients so they can branch on it. */
export type PreconditionResult = { ok: true } | { ok: false; reason: FeatureText; reasonKey?: string };
export type FeaturePrecondition = (env: AdminBindings) => Promise<PreconditionResult>;

/**
 * Creator support (wiki AUN-MEMBERS §9.7): on only once the organization is recorded as formed, the
 * finance list has the approvers MEM-D24 needs, every owner decision is recorded, and a collector
 * and the chosen payout rail exist in this environment (shared-types support-readiness.ts).
 */
const creatorSupport: FeaturePrecondition = async (env) => {
  const r = await supportCanTurnOnHook({ SEARCH_DB: env.SEARCH_DB as never, ENVIRONMENT: env.ENVIRONMENT, SUPPORT_TEST_PROVIDERS: env.SUPPORT_TEST_PROVIDERS });
  if (r.ok === true) return { ok: true };
  const refused = r as Extract<typeof r, { ok: false }>;
  return { ok: false, reason: refused.reason, reasonKey: refused.reasonKey };
};

/** Age rules (wiki E20 §5.2): Auth's date of birth, the saved ages and working account events; the first that fails refuses. */
const ageRules: FeaturePrecondition = async (env) => {
  const failed = (await ageRulesChecks(env)).find((check) => !check.ok);
  return failed ? { ok: false, reason: failed.reason, reasonKey: failed.reasonKey } : { ok: true };
};

/** Checks by switch. */
export const FEATURE_PRECONDITIONS: Partial<Record<FeatureKey, FeaturePrecondition>> = { creatorSupport, ageRules };

export const PRECONDITION_UNREADABLE: FeatureText = {
  en: 'We couldn’t check whether this can be turned on. Try again in a moment.',
  ar: 'تعذّر التحقق من إمكانية التشغيل. حاول مرة أخرى بعد قليل.',
};

/** Runs a switch's check (none: allowed). */
export async function checkCanTurnOn(
  env: AdminBindings,
  key: FeatureKey,
  checks: Partial<Record<FeatureKey, FeaturePrecondition>> = FEATURE_PRECONDITIONS,
): Promise<PreconditionResult> {
  const check = checks[key];
  if (!check) return { ok: true };
  try {
    return await check(env);
  } catch {
    return { ok: false, reason: PRECONDITION_UNREADABLE, reasonKey: 'precondition_unreadable' };
  }
}
