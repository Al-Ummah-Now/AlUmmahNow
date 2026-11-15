/**
 * The Tier requests queue's pure rules (wiki AUN-TIER-REQUESTS), shared by the
 * page, its actions and test/tier-requests.test.ts.
 */
import { ADMIN_TIER_REQUEST_FILTERS, TIER_REQUEST_ERRORS, type AdminTierRequestFilter, type AdminTierRequestRow } from '@al-ummah/shared-types';

/** ?filter= from the URL; anything else is the pending queue. */
export function parseTierRequestFilter(raw: string | undefined): AdminTierRequestFilter {
  return (ADMIN_TIER_REQUEST_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as AdminTierRequestFilter) : 'pending';
}

/** The queue's link for a tab and, for "Show more", the next page. */
export function tierRequestsHref(filter: AdminTierRequestFilter, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (filter !== 'pending') q.set('filter', filter);
  if (cursor) q.set('cursor', cursor);
  return `/tier-requests${q.size ? `?${q}` : ''}`;
}

/** What the decision email did, as a tone: still going, done, nothing to send, or needs an admin. */
export type EmailTone = 'progress' | 'done' | 'none' | 'failed';
export function emailTone(status: string | null): EmailTone | null {
  switch (status) {
    case null:
      return null;
    case 'queued':
      return 'progress';
    case 'sent':
    case 'sunk':
      return 'done';
    case 'failed':
      return 'failed';
    default:
      return 'none';
  }
}

/** The person's name to show: their profile name, else the name they typed on the form. */
export const requesterName = (row: Pick<AdminTierRequestRow, 'displayName' | 'name'>) => row.displayName || row.name;

/** A refused decision, in the queue's words: someone else got there first, or it failed. */
export type DecisionFailure = 'alreadyDecided' | 'readOnly' | 'failed';
export function decisionFailure(result: { status: number; code?: string }): DecisionFailure {
  if (result.status === 409 || result.code === TIER_REQUEST_ERRORS.notPending) return 'alreadyDecided';
  if (result.status === 403) return 'readOnly';
  return 'failed';
}
