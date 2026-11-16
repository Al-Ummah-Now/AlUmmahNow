import { logger } from '@/lib/logger-client';
import { recoverFromVersionSkew } from '@/lib/version-skew';

/**
 * Server Actions called from the browser, settled (owner review 2026-11-16: "no endless spinners").
 *
 * Our actions never throw on a failed API answer: they return `{ ok: false, status, error }`
 * (404 feature_off, other 4xx, 5xx, and a fetch that failed on the server all come back that
 * way). The call itself can still reject in the browser: the connection drops, the page is left
 * mid-call, or a deploy replaced the build the page came from. A bare `await` on such a call
 * leaves its spinner or busy button on forever. Settled, it resolves to the same network failure
 * the action returns for a fetch error, so every loading state ends in content, an empty state,
 * a hidden section or an error. A version-skew rejection still reaches the recovery, which
 * reloads the page.
 */
export const ACTION_UNREACHABLE = Object.freeze({ ok: false as const, status: 0, error: 'network' });

export function settleAction<A extends unknown[], R extends { ok: boolean }>(
  name: string,
  action: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await action(...args);
    } catch (error) {
      if (!recoverFromVersionSkew(error, `action:${name}`)) {
        logger.warn('[Actions] A Server Action call did not complete', { action: name, error: error instanceof Error ? error.message : String(error) });
      }
      return { ...ACTION_UNREACHABLE } as unknown as R;
    }
  };
}
