/**
 * Caption minutes (AUN-CAPTIONS §6; owner decision 2026-11-14): what on-demand
 * transcription and translation spend. One minute per started video-minute per
 * language produced.
 *
 * A creator's monthly allowance is their creator tier's `captionMinutesMonth`
 * plus the admin's grants for that month; grants "until used" are spent after
 * the month's allowance. Unlimited tiers (and the super admin) have no limit.
 * Everything is videos-side (the videos admin), never Auth RBAC. Months are
 * calendar months in UTC.
 *
 * A job reserves its minutes when it is requested; the reservation is
 * committed (with any difference released) when the job finishes and released
 * in full when it fails or is cancelled.
 */

export const CAPTION_GRANT_SCOPES = ['month', 'until_used'] as const;
export type CaptionGrantScope = (typeof CAPTION_GRANT_SCOPES)[number];

/** An admin's grant of extra caption minutes to a user. */
export interface CaptionMinuteGrant {
  id: string;
  userId: string;
  minutes: number;
  /** `month`: added to that month's allowance; `until_used`: spent after the allowance, any month */
  scope: CaptionGrantScope;
  /** The month a `month` grant applies to (`YYYY-MM`); null for `until_used` */
  period: string | null;
  /** Minutes of an `until_used` grant already spent (reserved or charged) */
  used: number;
  reason: string;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

/** Where a subject's caption minutes stand this month. */
export interface CaptionMinutesUsage {
  /** `YYYY-MM` (UTC) */
  period: string;
  /** When the month's allowance starts again (ISO, the 1st of next month 00:00 UTC) */
  resetsAt: string;
  /** No limit: an Unlimited tier or the super admin */
  unlimited: boolean;
  via: 'tier' | 'super_admin' | 'none';
  /** The tier's monthly minutes (0 without a tier) */
  tierMinutes: number;
  /** Minutes granted for this month */
  monthGranted: number;
  /** tierMinutes + monthGranted; null when unlimited */
  monthLimit: number | null;
  /** Minutes of this month's allowance spent or reserved */
  monthUsed: number;
  /** Minutes left on "until used" grants */
  packsRemaining: number;
  /** What a new job may spend now; null when unlimited */
  remaining: number | null;
  /** At least 80% of the month's allowance is spent */
  warning: boolean;
}

export const CAPTION_MINUTES_WARNING_RATIO = 0.8;

export const CAPTION_GRANT_BOUNDS = {
  minutes: { min: 1, max: 100_000 },
  reason: { max: 500 },
} as const;

/** The entitlement a refused job names in its 402 (`upgrade_required`). */
export const CAPTION_MINUTES_ENTITLEMENT = 'captions.monthlyMinutes';

/** Minutes a job costs: started video-minutes × languages (at least 1). */
export function captionMinutesFor(durationSeconds: number, languages = 1): number {
  const minutes = Math.max(1, Math.ceil(Math.max(0, durationSeconds) / 60));
  return minutes * Math.max(1, Math.floor(languages));
}

/** The caption-minutes month of a date: `YYYY-MM` in UTC. */
export function captionPeriod(at: Date = new Date()): string {
  return at.toISOString().slice(0, 7);
}

/** The start of the month after `period` (ISO), when its allowance resets. */
export function captionPeriodResetsAt(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 1)).toISOString();
}

/** Puts the usage figures together (shared by api-videos, the admin and Studio tests). */
export function captionUsageFrom(input: {
  period: string;
  unlimited: boolean;
  via: CaptionMinutesUsage['via'];
  tierMinutes: number;
  monthGranted: number;
  monthUsed: number;
  packsRemaining: number;
}): CaptionMinutesUsage {
  const monthLimit = input.unlimited ? null : input.tierMinutes + input.monthGranted;
  const remaining = monthLimit === null ? null : Math.max(0, monthLimit - input.monthUsed) + input.packsRemaining;
  return {
    period: input.period,
    resetsAt: captionPeriodResetsAt(input.period),
    unlimited: input.unlimited,
    via: input.via,
    tierMinutes: input.tierMinutes,
    monthGranted: input.monthGranted,
    monthLimit,
    monthUsed: input.monthUsed,
    packsRemaining: input.packsRemaining,
    remaining,
    warning: monthLimit !== null && monthLimit > 0 && input.monthUsed >= monthLimit * CAPTION_MINUTES_WARNING_RATIO,
  };
}
