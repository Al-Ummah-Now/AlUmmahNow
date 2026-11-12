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
 *
 * Idempotent: a second run changes nothing. Runs inside the UserDataErased step, so a failure retries
 * and finally dead-letters like the rest of the erasure.
 */
import type { D1Database } from '../types';

/** extra_json keys that identify a person; removed from an erased user's error events. */
export const IDENTIFYING_EXTRA_KEYS = ['email', 'userEmail', 'name', 'userName', 'displayName', 'ip', 'ipAddress', 'userId', 'user_id'] as const;

export interface UserTracesResult {
  invites: number;
  errorUsers: number;
  errorEvents: number;
  categorySuggestions: number;
}

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
  const categorySuggestions = search ? count((await search.batch([search.prepare('DELETE FROM category_suggestions WHERE user_id = ? RETURNING subject_id').bind(userId)]))[0]) : 0;
  return { invites: count(invites), errorUsers: count(errorUsers), errorEvents: count(errorEvents), categorySuggestions };
}
