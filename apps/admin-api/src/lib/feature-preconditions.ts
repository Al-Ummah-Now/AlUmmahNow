/**
 * Conditions a switch must meet before it may be turned on (FEAT-4; wiki AUN-FEATURES §5.3).
 * A switch whose check fails is refused with 409 `feature_precondition` and the check's reason,
 * shown to the admin under the switch. Turning a switch off is never refused.
 *
 * Each check is owned by its feature's epic and must be fast (one or two reads) and fail closed:
 * a check that throws refuses with the generic reason.
 */
import type { FeatureKey, FeatureText } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';

/** `reasonKey` is the check's stable reason code, passed to clients so they can branch on it. */
export type PreconditionResult = { ok: true } | { ok: false; reason: FeatureText; reasonKey?: string };
export type FeaturePrecondition = (env: AdminBindings) => Promise<PreconditionResult>;

/** Checks by switch. MEMBERS adds creatorSupport (organisation formed + a finance approver, spec §9.7). */
export const FEATURE_PRECONDITIONS: Partial<Record<FeatureKey, FeaturePrecondition>> = {};

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
