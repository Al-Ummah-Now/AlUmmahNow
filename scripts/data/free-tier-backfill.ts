/**
 * Free tier backfill (owner, 2026-11-15; wiki AUN-TIER-REQUESTS "Default
 * tier"): every account without a stored tier gets Free written to it, so
 * nobody is ever tierless. The search D1 only (never the Auth D1).
 *
 * Accounts are videos profiles (content_ownership kind 'profile') plus owners
 * of channels or videos with no profile row. Each batch walks one kind's
 * index in id order (keyset: `kind = ? AND id > ?` on the primary key, or
 * `kind = ? AND owner_id > ?` on idx_content_ownership_owner) and checks the
 * assignment by its primary key: no full scans. Writing is
 * `ON CONFLICT DO NOTHING`, so a tier set meanwhile is kept and a second run
 * changes nothing.
 */

/** The Free tier («مجاني»), id `member` (renamed from Member, migration 0065) */
export const BACKFILL_TIER_ID = 'member';
export const BACKFILL_ASSIGNER = 'system:backfill';
export const BACKFILL_BATCH = 200;

export type Query = <Row>(sql: string, params?: unknown[]) => Promise<Row[]>;

export interface BackfillPage {
  /** Accounts in this page without a stored tier */
  missing: string[];
  /** Rows written (0 on a dry run) */
  written: number;
  /** Keyset cursor for the next page; null when the walk is done */
  next: string | null;
}

/** Profiles by primary key (kind, id), in id order. */
const PROFILES = `SELECT p.id AS user_id FROM content_ownership p
  WHERE p.kind = 'profile' AND p.is_deleted = 0 AND p.id > ?1
  ORDER BY p.id LIMIT ?2`;

/** Channel and video owners by idx_content_ownership_owner (kind, owner_id), in owner order. */
const OWNERS = (kind: 'channel' | 'video') => `SELECT DISTINCT o.owner_id AS user_id FROM content_ownership o
  WHERE o.kind = '${kind}' AND o.is_deleted = 0 AND o.owner_id IS NOT NULL AND o.owner_id > ?1
  ORDER BY o.owner_id LIMIT ?2`;

export const BACKFILL_SOURCES = { profile: PROFILES, channel: OWNERS('channel'), video: OWNERS('video') } as const;
export type BackfillSource = keyof typeof BACKFILL_SOURCES;

/** One page of one source: the ids, which of them have no tier, and (unless dry) Free written to those. */
export async function backfillPage(
  query: Query,
  source: BackfillSource,
  after: string,
  opts: { dryRun: boolean; limit?: number; now?: string },
): Promise<BackfillPage> {
  const limit = opts.limit ?? BACKFILL_BATCH;
  const ids = (await query<{ user_id: string }>(BACKFILL_SOURCES[source], [after, limit])).map((r) => r.user_id).filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id));
  if (!ids.length) return { missing: [], written: 0, next: null };
  const json = JSON.stringify(ids);
  // Primary-key lookups only (creator_tier_assignments.user_id)
  const held = new Set(
    (await query<{ user_id: string }>('SELECT user_id FROM creator_tier_assignments WHERE user_id IN (SELECT value FROM json_each(?1))', [json])).map((r) => r.user_id),
  );
  const missing = ids.filter((id) => !held.has(id));
  let written = 0;
  if (!opts.dryRun && missing.length) {
    const rows = await query<{ user_id: string }>(
      `INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at)
       SELECT value, ?2, 'admin', ?3, ?4 FROM json_each(?1) WHERE true
       ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
      [JSON.stringify(missing), BACKFILL_TIER_ID, BACKFILL_ASSIGNER, opts.now ?? new Date().toISOString()],
    );
    written = rows.length;
  }
  return { missing, written, next: ids.length < limit ? null : ids[ids.length - 1] };
}

/** Walks every source; returns the counts (and on apply, writes in batches). */
export async function backfillAll(
  query: Query,
  opts: { dryRun: boolean; limit?: number; now?: string; onPage?: (source: BackfillSource, page: BackfillPage) => void },
): Promise<{ missing: number; written: number; bySource: Record<BackfillSource, { missing: number; written: number }> }> {
  const bySource = { profile: { missing: 0, written: 0 }, channel: { missing: 0, written: 0 }, video: { missing: 0, written: 0 } };
  const seen = new Set<string>();
  for (const source of Object.keys(BACKFILL_SOURCES) as BackfillSource[]) {
    let after = '';
    for (;;) {
      const page = await backfillPage(query, source, after, opts);
      // An owner already counted under profiles (dry run) is not counted twice
      const fresh = page.missing.filter((id) => !seen.has(id));
      fresh.forEach((id) => seen.add(id));
      bySource[source].missing += fresh.length;
      bySource[source].written += page.written;
      opts.onPage?.(source, page);
      if (!page.next) break;
      after = page.next;
    }
  }
  const missing = Object.values(bySource).reduce((n, s) => n + s.missing, 0);
  const written = Object.values(bySource).reduce((n, s) => n + s.written, 0);
  return { missing, written, bySource };
}
