/**
 * What a panel that reads Workers Analytics Engine through admin-api (Web vitals, Abuse) shows when
 * its read fails (admin-api lib/analytics-engine.ts):
 *
 * - not_configured: admin-api has no CF_ANALYTICS_TOKEN or CLOUDFLARE_ACCOUNT_ID in this environment
 * - unavailable: Cloudflare refused or failed the read; `reason` says why and `ref` is the Errors page
 *   item admin-api flagged it under
 * - failed: anything else (admin-api unreachable, an unexpected error)
 */
import { AdminApiError } from './errors';

export const ANALYTICS_REASONS = ['auth', 'rate_limited', 'query', 'upstream', 'unreachable', 'bad_response'] as const;
export type AnalyticsReason = (typeof ANALYTICS_REASONS)[number] | 'unknown';

/**
 * Names the panel states quote, shown as isolated left-to-right code so Arabic text around them (a «و»
 * before one) stays in order: the token's Secrets Store name, the permission it needs, the bindings
 */
export const ANALYTICS_CODES = ['media-cdn-api-token', 'Account → Account Analytics → Read', 'CF_ANALYTICS_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'admin-api'];

export type AnalyticsLoadProblem =
  | { kind: 'not_configured' }
  | { kind: 'unavailable'; reason: AnalyticsReason; ref?: string }
  | { kind: 'failed' };

export function analyticsLoadProblem(error: unknown): AnalyticsLoadProblem {
  if (!(error instanceof AdminApiError)) return { kind: 'failed' };
  if (error.code === 'not_configured') return { kind: 'not_configured' };
  if (error.code === 'unavailable') {
    const raw = error.detail?.reason;
    const reason: AnalyticsReason = (ANALYTICS_REASONS as readonly string[]).includes(raw ?? '') ? (raw as AnalyticsReason) : 'unknown';
    return { kind: 'unavailable', reason, ...(error.detail?.ref ? { ref: error.detail.ref } : {}) };
  }
  return { kind: 'failed' };
}
