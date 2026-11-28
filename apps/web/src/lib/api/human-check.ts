'use server';

/**
 * Whether the signed-in account's next comment, post or report needs a Turnstile
 * token (api-videos GET /api/me/human-check, docs/features/bot-protection.md).
 * Any failure answers "not required": the API still checks and refuses, and the
 * caller then shows its usual error.
 */
import { buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';
import { logger } from '@/lib/logger-server';

export type HumanCheckKind = 'comment' | 'post' | 'report' | 'tier_request';

export interface HumanCheckStatus {
  required: boolean;
  siteKey: string | null;
}

const HUMAN_CHECK_KINDS = new Set<HumanCheckKind>(['comment', 'post', 'report', 'tier_request']);

export async function getHumanCheck(kind: HumanCheckKind): Promise<HumanCheckStatus> {
  if (!HUMAN_CHECK_KINDS.has(kind)) return { required: false, siteKey: null };
  const auth = await getServerAuthContext();
  if (!auth?.accessToken) return { required: false, siteKey: null };
  try {
    const response = await fetch(buildApiUrl(`/api/me/human-check?kind=${encodeURIComponent(kind)}`), {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) return { required: false, siteKey: null };
    const json = (await response.json()) as { result?: Partial<HumanCheckStatus> };
    return { required: !!json.result?.required, siteKey: json.result?.siteKey ?? null };
  } catch (error) {
    logger.warn('[getHumanCheck] Failed', { kind, error });
    return { required: false, siteKey: null };
  }
}
