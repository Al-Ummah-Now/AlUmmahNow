'use server';

/** Plan limits for a user or channel (Epic 27). Any failure returns null: limits are enforced by the API. */

import { buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';
import { logger } from '@/lib/logger-server';
import type { EntitlementsView } from '@/lib/entitlements/limits';

export async function getSubjectEntitlements(subject: string): Promise<EntitlementsView | null> {
  try {
    const auth = await getServerAuthContext();
    if (!auth?.accessToken) return null;
    const response = await fetch(buildApiUrl(`/api/entitlements?subject=${encodeURIComponent(subject)}`), {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      logger.warn('[getSubjectEntitlements] Rejected', { status: response.status });
      return null;
    }
    const body = (await response.json()) as { result?: EntitlementsView };
    return body.result ?? null;
  } catch (error) {
    logger.error('[getSubjectEntitlements] Failed', { error });
    return null;
  }
}
