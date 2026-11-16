/**
 * The videos admin's own staff list (admin_staff, migration 0031).
 *
 * Every Super Admin, Admin or Moderator token that reaches admin-api records
 * (or refreshes) its user here, with the role from that token's own claims.
 * Nothing is read from the auth server's role tables. Writes are throttled: a
 * per-isolate memory of the last write, and an upsert that only touches a row
 * when it was seen over THROTTLE_MS ago or its role, email or name changed.
 * A token without any staff role, and an account suspended or deleted through
 * an Auth request, make the row inactive. Pickers read active rows only.
 */
import type { D1Database } from './types';
import { normalizeRoles } from './roles';
import { likePattern } from './contact-store';

export const STAFF_ROLES = ['super_admin', 'admin', 'moderator'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** At most one write per user per this long (unless the role, email or name changes). */
export const STAFF_THROTTLE_MS = 10 * 60_000;

export interface StaffRow {
  user_id: string;
  role: StaffRole;
  name: string | null;
  email: string | null;
  active: number;
  inactive_reason: string | null;
  last_seen_at: string;
}

/** The highest staff role among a token's roles, or null. */
export function staffRoleOf(roles: readonly string[] | undefined): StaffRole | null {
  const normalized = normalizeRoles(roles ?? []);
  return STAFF_ROLES.find((r) => normalized.includes(r)) ?? null;
}

/** Last write per user in this isolate: skips even the conditional upsert on most requests. */
const recent = new Map<string, { at: number; key: string }>();
const RECENT_MAX = 5_000;

/** Forget the in-memory throttle (tests). */
export function resetStaffThrottle(): void {
  recent.clear();
}

function throttled(userId: string, key: string, now: number): boolean {
  const last = recent.get(userId);
  if (last && last.key === key && now - last.at < STAFF_THROTTLE_MS) return true;
  if (recent.size >= RECENT_MAX) recent.clear();
  recent.set(userId, { at: now, key });
  return false;
}

/**
 * Records what a token says about its user: an upsert with the token's staff
 * role, or (no staff role) the row made inactive. `lookupName` is called only
 * when a write is due. Returns what was done.
 */
export async function recordStaffToken(
  db: D1Database,
  token: { userId: string; roles: readonly string[] | undefined; email: string | null | undefined },
  now: Date,
  lookupName: (userId: string) => Promise<string | null> = async () => null,
): Promise<'skipped' | 'recorded' | 'deactivated'> {
  const role = staffRoleOf(token.roles);
  const email = token.email?.trim().toLowerCase() || null;
  if (throttled(token.userId, `${role ?? '-'}|${email ?? ''}`, now.getTime())) return 'skipped';
  const at = now.toISOString();
  if (!role) {
    await deactivateStaff(db, token.userId, 'role_removed', now);
    return 'deactivated';
  }
  const name = await lookupName(token.userId).catch(() => null);
  const before = new Date(now.getTime() - STAFF_THROTTLE_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO admin_staff (user_id, role, name, email, active, inactive_reason, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, name = COALESCE(excluded.name, admin_staff.name), email = excluded.email,
         active = 1, inactive_reason = NULL, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
       WHERE admin_staff.last_seen_at < ? OR admin_staff.active = 0 OR admin_staff.role <> excluded.role
         OR COALESCE(admin_staff.email, '') <> COALESCE(excluded.email, '')
         OR (excluded.name IS NOT NULL AND COALESCE(admin_staff.name, '') <> excluded.name)`,
    )
    .bind(token.userId, role, name, email, at, at, at, before)
    .run();
  return 'recorded';
}

/** Makes a staff row inactive (role removed, account suspended or deleted). No row: nothing to do. */
export async function deactivateStaff(db: D1Database, userId: string, reason: 'role_removed' | 'suspended' | 'deleted', now: Date): Promise<boolean> {
  const at = now.toISOString();
  const result = await db
    .prepare('UPDATE admin_staff SET active = 0, inactive_reason = ?, updated_at = ? WHERE user_id = ? AND active = 1')
    .bind(reason, at, userId)
    .run();
  return Number((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

/**
 * Active staff with one of `roles`, matched by name or email (or exact id),
 * by name then email. idx_admin_staff_active_role_name / _active_email.
 */
export async function listActiveStaff(db: D1Database, roles: readonly StaffRole[], q = '', limit = 200): Promise<StaffRow[]> {
  if (!roles.length) return [];
  const marks = roles.map(() => '?').join(', ');
  const term = q.trim();
  const search = term ? " AND (lower(COALESCE(name, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(email, '')) LIKE ? ESCAPE '\\' OR user_id = ?)" : '';
  const args: unknown[] = [...roles];
  if (term) {
    const p = likePattern(term.toLowerCase());
    args.push(p, p, term);
  }
  const { results } = await db
    .prepare(
      `SELECT user_id, role, name, email, active, inactive_reason, last_seen_at FROM admin_staff
       WHERE active = 1 AND role IN (${marks})${search}
       ORDER BY COALESCE(name, email) COLLATE NOCASE, user_id LIMIT ?`,
    )
    .bind(...args, limit)
    .all<StaffRow>();
  return results ?? [];
}

/** One active staff member with one of `roles`, or null. */
export async function getActiveStaff(db: D1Database, userId: string, roles: readonly StaffRole[]): Promise<StaffRow | null> {
  if (!roles.length) return null;
  return db
    .prepare(`SELECT user_id, role, name, email, active, inactive_reason, last_seen_at FROM admin_staff WHERE user_id = ? AND active = 1 AND role IN (${roles.map(() => '?').join(', ')})`)
    .bind(userId, ...roles)
    .first<StaffRow>();
}
