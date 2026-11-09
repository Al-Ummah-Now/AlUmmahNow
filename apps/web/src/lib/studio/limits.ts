/** Explains a plan limit the API refused an action for (HTTP 402 upgrade_required). */

import type { StudioTranslations } from '@al-ummah/shared-types';

export interface LimitRefusal {
  entitlement: string;
  limit: number | string | null;
  current: number | null;
}

export function parseLimitRefusal(status: number, body: string): LimitRefusal | null {
  if (status !== 402) return null;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; entitlement?: unknown; limit?: unknown; current?: unknown };
    if (parsed.error !== 'upgrade_required' || typeof parsed.entitlement !== 'string') return null;
    return {
      entitlement: parsed.entitlement,
      limit: typeof parsed.limit === 'number' || typeof parsed.limit === 'string' ? parsed.limit : null,
      current: typeof parsed.current === 'number' ? parsed.current : null,
    };
  } catch {
    return null;
  }
}

export function isLimitRefusal(value: unknown): value is LimitRefusal {
  return typeof value === 'object' && value !== null && 'entitlement' in value;
}

export function limitRefusalMessage(text: StudioTranslations['limits'], refusal: LimitRefusal): string {
  switch (refusal.entitlement) {
    case 'studio.drafts.max':
      return text.draftsMax.replace('{limit}', String(refusal.limit));
    case 'studio.bulkSchedule':
      return text.bulkSchedule;
    default:
      return text.other;
  }
}
