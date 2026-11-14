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
 * A job is charged its estimate when it starts, so the meter and the next start
 * see it at once; it is settled to the minutes it used when it finishes (the
 * difference charged or given back), refunded in full when it fails, and charged
 * only what it transcribed when it is cancelled. A start needs a balance above 0;
 * a started job always runs to the end, so the balance may go below 0 (the
 * overdraft), which the next month's allowance and the admin's grants pay down
 * (owner decisions 2026-11-14).
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

/** One change of a subject's caption-minutes balance (the admin's ledger). */
export interface CaptionLedgerEntry {
  /** The step's idempotency key: `<jobId>:start|settle|cancel|refund` or `paydown:<uuid>` */
  id: string;
  holdId: string | null;
  /** start: the estimate charged; settle: the difference at the end; cancel: given back but what was transcribed; refund: all back on failure; paydown: overdraft paid from the month or a grant */
  kind: 'start' | 'settle' | 'cancel' | 'refund' | 'paydown';
  /** + charged, − given back (paydown: the minutes paid off) */
  minutes: number;
  /** The balance after the step; null when unlimited */
  balanceAfter: number | null;
  period: string;
  createdAt: string;
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
  /** Minutes charged past the allowance and grants, owed to the next month (0 when none) */
  overdraft: number;
  /** Minutes charged to jobs still running (counted in the figures above already) */
  held: number;
  /** The balance: below 0 by the overdraft; a job may start while it is above 0; null when unlimited */
  remaining: number | null;
  /** At least 80% of the month's allowance is spent, or the balance is below 0 */
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
  overdraft?: number;
  held?: number;
}): CaptionMinutesUsage {
  const monthLimit = input.unlimited ? null : input.tierMinutes + input.monthGranted;
  const overdraft = input.unlimited ? 0 : Math.max(0, input.overdraft ?? 0);
  const remaining = monthLimit === null ? null : Math.max(0, monthLimit - input.monthUsed) + input.packsRemaining - overdraft;
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
    overdraft,
    held: Math.max(0, input.held ?? 0),
    remaining,
    warning: monthLimit !== null && ((monthLimit > 0 && input.monthUsed >= monthLimit * CAPTION_MINUTES_WARNING_RATIO) || overdraft > 0),
  };
}

/** A start needs a balance above 0 (unlimited always may). */
export const captionMinutesCanStart = (usage: Pick<CaptionMinutesUsage, 'unlimited' | 'remaining'>): boolean => usage.unlimited || (usage.remaining ?? 0) > 0;
