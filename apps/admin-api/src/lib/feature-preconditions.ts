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

/** Age rules (wiki E20 §5.2): refused until E20-B2 brings the real checks (Auth's date of birth, the numbers, account events). */
const ageRules: FeaturePrecondition = async () => ({
  ok: false,
  reason: { en: 'The date of birth page and account events aren’t ready in this environment yet.', ar: 'صفحة تاريخ الميلاد وأحداث الحساب ليست جاهزة في هذه البيئة بعد.' },
  reasonKey: 'age_rules_not_ready',
});

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
