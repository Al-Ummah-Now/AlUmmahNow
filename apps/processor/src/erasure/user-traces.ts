/**
 * Account erasure (#1059): what the processor's databases keep about an erased user beyond reports,
 * moderation and notifications.
 *
 * - REPORTS_DB creator_invites: the videos admin's invite rows of the account (email, name). Deleted.
 * - REPORTS_DB error_group_users: which users hit which error group. The user's rows are deleted
 *   (the group's own `users` count stays, so trends survive).
 * - REPORTS_DB error_events: kept for grouping and trends (message, stack, counts), with the user id
 *   replaced by the erased marker and identifying keys removed from extra_json (email, name, ip...).
 * - SEARCH_DB category_suggestions: AI category suggestions keyed by the user. Deleted.
 * - SEARCH_DB upload_rate_windows / upload_rate_leases: the user's upload and channel-create rate
 *   counters and in-flight slots (api-videos middleware/rate-limit.ts, lib/creatorTiers.ts), keyed by
 *   the user id. Deleted: the account is gone, so nothing is left to limit.
 * - SEARCH_DB creator_tier_assignments: the user's creator tier (who assigned it, when). Deleted.
 * - SEARCH_DB caption_minute_* (api-videos search 0032/0035, lib/captions/minutes.ts): the user's
 *   caption-minute usage per month, overdraft, holds, ledger and the admin's grants to them. Deleted:
 *   the account is gone, so nothing is left to meter. Who granted what stays in the admin audit log.
 * - SEARCH_DB tier_requests (wiki AUN-TIER-REQUESTS): the user's requests for a tier, with the name
 *   and "about you" they wrote. Deleted. Requests the user decided as staff keep the decision, with
 *   the decider scrubbed to the placeholder.
 * - SEARCH_DB billing_* (wiki AUN-SUBS): payment records are bookkeeping, so subscriptions and
 *   payments are kept with the user id replaced by the erased marker (comp reasons, provider customer ids and receipt links dropped, a comp
 *   the user granted as staff keeps the grant with the granter scrubbed). Webhook payloads (they can
 *   hold the email) are emptied; customer links and checkouts are deleted.
 * - SEARCH_DB support_* (wiki AUN-MEMBERS §9.8): gifts, pledges, refunds and payouts are financial
 *   records, kept with the user id replaced by the erased marker; private messages to creators are
 *   dropped, webhook payloads emptied, open checkouts deleted and finance-list membership removed.
 *   Active pledges are marked canceled ('erasure'); a later renewal from the collector for a canceled
 *   pledge is refused and canceled at the collector by the support webhook job. The creator's payee
 *   row keeps the rail's payee reference (money still owed is paid out first, §9.8) under the marker.
 * - SEARCH_DB admin_deletions / admin_jobs: kept as action records, the user scrubbed to
 *   placeholders (#1253, admin-history.ts).
 *
 * Idempotent: a second run changes nothing. Runs inside the UserDataErased step, so a failure retries
 * and finally dead-letters like the rest of the erasure.
 */
import type { D1Database } from '../types';
import { eraseUserAdminHistory } from './admin-history';

/** extra_json keys that identify a person; removed from an erased user's error events. */
export const IDENTIFYING_EXTRA_KEYS = ['email', 'userEmail', 'name', 'userName', 'displayName', 'ip', 'ipAddress', 'userId', 'user_id'] as const;

export interface UserTracesResult {
  invites: number;
  errorUsers: number;
  errorEvents: number;
  categorySuggestions: number;
  rateLimits: number;
  creatorTier: number;
  captionMinutes: number;
  tierRequests: number;
  billing: number;
  support: number;
  adminDeletions: number;
  adminJobs: number;
}

/** The caption-minute tables keyed by the user (no foreign keys between them). */
export const CAPTION_MINUTE_TABLES = ['caption_minute_usage', 'caption_minute_overdraft', 'caption_minute_holds', 'caption_minute_ledger', 'caption_minute_grants'] as const;

/** RETURNING rows count what changed (D1 and the test stand-in alike), as contact/erase.ts does. */
const count = (r: unknown) => ((r as { results?: unknown[] } | undefined)?.results ?? []).length;

export async function eraseUserTraces(
  reports: D1Database,
  search: D1Database | undefined,
  userId: string,
  erasedMarker: string
): Promise<UserTracesResult> {
  if (!userId) throw new Error('eraseUserTraces needs a user id');
  const removeKeys = IDENTIFYING_EXTRA_KEYS.map((k) => `'$.${k}'`).join(', ');
  const [invites, errorUsers, errorEvents] = await reports.batch([
    reports.prepare('DELETE FROM creator_invites WHERE user_id = ? RETURNING id').bind(userId),
    reports.prepare('DELETE FROM error_group_users WHERE user_key = ? RETURNING group_id').bind(userId),
    reports
      .prepare(
        `UPDATE error_events SET user_id = ?, extra_json = CASE WHEN json_valid(extra_json) THEN json_remove(extra_json, ${removeKeys}) ELSE NULL END
         WHERE user_id = ? RETURNING id`
      )
      .bind(erasedMarker, userId),
  ]);
  const [suggestions, windows, leases, tier, requests, decided, ...captions] = search
    ? await search.batch([
        search.prepare('DELETE FROM category_suggestions WHERE user_id = ? RETURNING subject_id').bind(userId),
        search.prepare('DELETE FROM upload_rate_windows WHERE user_id = ? RETURNING operation').bind(userId),
        search.prepare('DELETE FROM upload_rate_leases WHERE user_id = ? RETURNING operation').bind(userId),
        search.prepare('DELETE FROM creator_tier_assignments WHERE user_id = ? RETURNING tier_id').bind(userId),
        search.prepare('DELETE FROM tier_requests WHERE user_id = ? RETURNING id').bind(userId),
        search.prepare('UPDATE tier_requests SET decided_by = ? WHERE decided_by = ? RETURNING id').bind(erasedMarker, userId),
        ...CAPTION_MINUTE_TABLES.map((table) => search.prepare(`DELETE FROM ${table} WHERE user_id = ? RETURNING user_id`).bind(userId)),
      ])
    : [];
  const billing = search
    ? await search.batch([
        search.prepare('UPDATE billing_subscriptions SET user_id = ?, comp_reason = NULL, customer_ref = NULL WHERE user_id = ? RETURNING id').bind(erasedMarker, userId),
        search.prepare('UPDATE billing_subscriptions SET comp_by = ? WHERE comp_by = ? RETURNING id').bind(erasedMarker, userId),
        search.prepare('UPDATE billing_payments SET user_id = ?, receipt_url = NULL WHERE user_id = ? RETURNING id').bind(erasedMarker, userId),
        search.prepare(`UPDATE billing_events SET user_id = ?, payload = '{}' WHERE user_id = ? RETURNING id`).bind(erasedMarker, userId),
        search.prepare('DELETE FROM billing_customers WHERE user_id = ? RETURNING provider_ref').bind(userId),
        search.prepare('DELETE FROM billing_checkouts WHERE user_id = ? RETURNING id').bind(userId),
      ])
    : [];
  const support = search
    ? await search.batch([
        search.prepare('UPDATE support_payments SET supporter_user_id = ?, message = NULL WHERE supporter_user_id = ? RETURNING id').bind(erasedMarker, userId),
        search
          .prepare(`UPDATE support_pledges SET supporter_user_id = ?, status = CASE WHEN status IN ('active', 'past_due') THEN 'canceled' ELSE status END, cancel_reason = CASE WHEN status IN ('active', 'past_due') THEN 'erasure' ELSE cancel_reason END WHERE supporter_user_id = ? RETURNING id`)
          .bind(erasedMarker, userId),
        search.prepare("DELETE FROM support_checkouts WHERE supporter_user_id = ? AND status <> 'completed' RETURNING id").bind(userId),
        search.prepare('UPDATE support_checkouts SET supporter_user_id = ?, message = NULL WHERE supporter_user_id = ? RETURNING id').bind(erasedMarker, userId),
        search.prepare(`UPDATE support_events SET user_id = ?, payload = '{}' WHERE user_id = ? RETURNING id`).bind(erasedMarker, userId),
        search.prepare('UPDATE support_refunds SET requested_by_user = ? WHERE requested_by_user = ? RETURNING id').bind(erasedMarker, userId),
        search.prepare('UPDATE support_reports SET reporter_user_id = ? WHERE reporter_user_id = ? RETURNING id').bind(erasedMarker, userId),
        search.prepare('UPDATE support_payees SET owner_user_id = ? WHERE owner_user_id = ? RETURNING id').bind(erasedMarker, userId),
        search.prepare('DELETE FROM support_finance_members WHERE user_id = ? RETURNING user_id').bind(userId),
      ])
    : [];
  const history = search ? await eraseUserAdminHistory(search, userId, erasedMarker) : { deletions: 0, jobs: 0 };
  return {
    invites: count(invites),
    errorUsers: count(errorUsers),
    errorEvents: count(errorEvents),
    categorySuggestions: count(suggestions),
    rateLimits: count(windows) + count(leases),
    creatorTier: count(tier),
    captionMinutes: captions.reduce((n: number, r) => n + count(r), 0),
    tierRequests: count(requests) + count(decided),
    billing: billing.reduce((n, r) => n + count(r), 0),
    support: support.reduce((n, r) => n + count(r), 0),
    adminDeletions: history.deletions,
    adminJobs: history.jobs,
  };
}
