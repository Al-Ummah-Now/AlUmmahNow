/**
 * Admin-configurable per-user download rate limit (Epic 14, E14-D2).
 *
 * Stored in `global_settings/ops/download-rate-limit.json`, cached for 30 s per
 * isolate in `api-videos`, and editable on Admin → Platform settings (`settings:manage`).
 *
 * This is a server-side request rate limit (using `rate-limit.ts`), never a stored
 * download quota or tier cap: every signed-in viewer gets the same download rights.
 */

export const DOWNLOAD_RATE_LIMIT_KEY = 'ops/download-rate-limit.json';
export const DOWNLOAD_RATE_LIMIT_AUDIT_KEY = 'downloads:rate-limit';
export const DOWNLOAD_RATE_LIMIT_CACHE_MS = 30_000;

export const DOWNLOAD_RATE_LIMIT_BOUNDS = {
  perDay: { min: 1, max: 10_000 },
  burstPerMinute: { min: 1, max: 100 },
} as const;

export interface DownloadRateLimitSettings {
  /** Maximum download requests per signed-in user per UTC day window. */
  perDay: number;
  /** Maximum download requests per signed-in user per minute (burst limit). */
  burstPerMinute: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_DOWNLOAD_RATE_LIMIT: Readonly<DownloadRateLimitSettings> = Object.freeze({
  perDay: 100,
  burstPerMinute: 10,
  updatedAt: null,
  updatedBy: null,
});

export interface DownloadRateLimitInput {
  perDay: unknown;
  burstPerMinute: unknown;
}

export type DownloadRateLimitValidationError =
  | { field: 'perDay'; reason: 'range'; min: number; max: number }
  | { field: 'burstPerMinute'; reason: 'range'; min: number; max: number }
  | { field: 'burstPerMinute'; reason: 'exceeds_per_day' };

function wholeInt(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

export function validateDownloadRateLimit(
  input: DownloadRateLimitInput,
): { ok: true; value: { perDay: number; burstPerMinute: number } } | { ok: false; error: DownloadRateLimitValidationError } {
  const perDay = wholeInt(input.perDay);
  if (perDay === null || perDay < DOWNLOAD_RATE_LIMIT_BOUNDS.perDay.min || perDay > DOWNLOAD_RATE_LIMIT_BOUNDS.perDay.max) {
    return { ok: false, error: { field: 'perDay', reason: 'range', ...DOWNLOAD_RATE_LIMIT_BOUNDS.perDay } };
  }
  const burstPerMinute = wholeInt(input.burstPerMinute);
  if (
    burstPerMinute === null ||
    burstPerMinute < DOWNLOAD_RATE_LIMIT_BOUNDS.burstPerMinute.min ||
    burstPerMinute > DOWNLOAD_RATE_LIMIT_BOUNDS.burstPerMinute.max
  ) {
    return { ok: false, error: { field: 'burstPerMinute', reason: 'range', ...DOWNLOAD_RATE_LIMIT_BOUNDS.burstPerMinute } };
  }
  if (burstPerMinute > perDay) {
    return { ok: false, error: { field: 'burstPerMinute', reason: 'exceeds_per_day' } };
  }
  return { ok: true, value: { perDay, burstPerMinute } };
}

/** Normalise a stored R2 document, falling back to safe defaults on missing/corrupt fields. */
export function normaliseDownloadRateLimit(raw: unknown): DownloadRateLimitSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DOWNLOAD_RATE_LIMIT };
  const obj = raw as Record<string, unknown>;
  const parsed = validateDownloadRateLimit({
    perDay: obj.perDay ?? DEFAULT_DOWNLOAD_RATE_LIMIT.perDay,
    burstPerMinute: obj.burstPerMinute ?? DEFAULT_DOWNLOAD_RATE_LIMIT.burstPerMinute,
  });
  const updatedAt = typeof obj.updatedAt === 'string' && obj.updatedAt.trim() ? obj.updatedAt : null;
  const updatedBy = typeof obj.updatedBy === 'string' && obj.updatedBy.trim() ? obj.updatedBy : null;
  if (!parsed.ok) {
    return {
      perDay: DEFAULT_DOWNLOAD_RATE_LIMIT.perDay,
      burstPerMinute: DEFAULT_DOWNLOAD_RATE_LIMIT.burstPerMinute,
      updatedAt,
      updatedBy,
    };
  }
  return { ...parsed.value, updatedAt, updatedBy };
}
