/**
 * The organization's finance list and tech-staff marks (wiki AUN-MEMBERS §9.6; MEM-8).
 *
 * Money permissions (refunds, disputes, payouts, ledger, providers) are never admin roles: a person
 * holds one only while they are on the finance list, the change was approved by a second person,
 * and they aren't marked as tech staff. The owner is a tech employee of the organization and is
 * marked so. A super admin role alone grants none of them.
 *
 * Rules (two-person changes, audited by the router):
 * - adding someone: a super admin proposes; a different super admin approves; neither may add themselves;
 * - removing someone takes effect at once (it only ever takes access away);
 * - marking someone as tech staff takes one super admin and removes them from the finance list;
 *   unmarking needs a different super admin from the one who marked them.
 *
 * Rows live in the search D1 (support_finance_members, support_tech_staff; migrations 0076, 0078).
 */
import { FINANCE_ONLY_SUPPORT_PERMISSIONS, type SupportPermission } from '@al-ummah/shared-types';
import type { D1Database } from './types';

export class FinanceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: 'invalid_request' | 'support_tech_staff' | 'support_same_person' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'FinanceError';
  }
}

export interface FinanceMember {
  userId: string;
  permissions: SupportPermission[];
  addedBy: string;
  approvedBy: string | null;
  addedAt: string;
  removedAt: string | null;
}

interface Row {
  user_id: string;
  roles: string;
  added_by: string;
  approved_by: string | null;
  added_at: string;
  removed_at: string | null;
}

const toMember = (r: Row): FinanceMember => {
  let permissions: SupportPermission[] = [];
  try {
    permissions = (JSON.parse(r.roles || '[]') as string[]).filter((p): p is SupportPermission => (FINANCE_ONLY_SUPPORT_PERMISSIONS as readonly string[]).includes(p));
  } catch {
    permissions = [];
  }
  return { userId: r.user_id, permissions, addedBy: r.added_by, approvedBy: r.approved_by, addedAt: r.added_at, removedAt: r.removed_at };
};

export async function isTechStaff(db: D1Database, userId: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS x FROM support_tech_staff WHERE user_id = ?').bind(userId).first<{ x: number }>());
}

export async function financeMember(db: D1Database, userId: string): Promise<FinanceMember | null> {
  const r = await db.prepare('SELECT user_id, roles, added_by, approved_by, added_at, removed_at FROM support_finance_members WHERE user_id = ?').bind(userId).first<Row>();
  return r ? toMember(r) : null;
}

/** May `userId` use the money permission `permission` right now? */
export async function financeAllows(db: D1Database, userId: string, permission: SupportPermission): Promise<boolean> {
  if (!(FINANCE_ONLY_SUPPORT_PERMISSIONS as readonly string[]).includes(permission)) return false;
  const [member, tech] = await Promise.all([financeMember(db, userId), isTechStaff(db, userId)]);
  return !tech && !!member && !member.removedAt && !!member.approvedBy && member.permissions.includes(permission);
}

export async function listFinanceMembers(db: D1Database): Promise<{ members: FinanceMember[]; techStaff: { userId: string; markedBy: string; markedAt: string }[] }> {
  const [m, t] = await Promise.all([
    db.prepare('SELECT user_id, roles, added_by, approved_by, added_at, removed_at FROM support_finance_members ORDER BY added_at DESC LIMIT 200').all<Row>(),
    db.prepare('SELECT user_id, marked_by, marked_at FROM support_tech_staff ORDER BY marked_at DESC LIMIT 200').all<{ user_id: string; marked_by: string; marked_at: string }>(),
  ]);
  return { members: (m.results ?? []).map(toMember), techStaff: (t.results ?? []).map((r) => ({ userId: r.user_id, markedBy: r.marked_by, markedAt: r.marked_at })) };
}

function cleanPermissions(input: unknown): SupportPermission[] {
  if (!Array.isArray(input) || !input.length) throw new FinanceError(400, 'invalid_request', 'Choose at least one money permission');
  const out = [...new Set(input)].filter((p): p is SupportPermission => typeof p === 'string' && (FINANCE_ONLY_SUPPORT_PERMISSIONS as readonly string[]).includes(p));
  if (out.length !== input.length) throw new FinanceError(400, 'invalid_request', 'Unknown permission');
  return out;
}

/** A super admin proposes someone (or new permissions for them). Waits for a second super admin. */
export async function proposeFinanceMember(db: D1Database, input: { userId: string; permissions: unknown; proposedBy: string }, now: Date): Promise<FinanceMember> {
  if (!input.userId || input.userId.length > 100) throw new FinanceError(400, 'invalid_request', 'Choose a person');
  if (input.userId === input.proposedBy) throw new FinanceError(409, 'support_same_person', 'You can’t add yourself');
  if (await isTechStaff(db, input.userId)) throw new FinanceError(409, 'support_tech_staff', 'Tech staff can’t be on the finance list');
  const permissions = cleanPermissions(input.permissions);
  const at = now.toISOString();
  await db
    .prepare(
      `INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at, removed_at, removed_by) VALUES (?, ?, ?, NULL, ?, NULL, NULL)
       ON CONFLICT(user_id) DO UPDATE SET roles = excluded.roles, added_by = excluded.added_by, approved_by = NULL, added_at = excluded.added_at, removed_at = NULL, removed_by = NULL`,
    )
    .bind(input.userId, JSON.stringify(permissions), input.proposedBy, at)
    .run();
  return (await financeMember(db, input.userId))!;
}

/** A second super admin approves a proposal. */
export async function approveFinanceMember(db: D1Database, userId: string, approvedBy: string): Promise<FinanceMember> {
  const member = await financeMember(db, userId);
  if (!member || member.removedAt) throw new FinanceError(404, 'not_found', 'No proposal for this person');
  if (member.approvedBy) throw new FinanceError(409, 'conflict', 'Already approved');
  if (approvedBy === member.addedBy || approvedBy === userId) throw new FinanceError(409, 'support_same_person', 'A second person has to approve');
  if (await isTechStaff(db, userId)) throw new FinanceError(409, 'support_tech_staff', 'Tech staff can’t be on the finance list');
  const r = (await db.prepare('UPDATE support_finance_members SET approved_by = ? WHERE user_id = ? AND approved_by IS NULL AND removed_at IS NULL').bind(approvedBy, userId).run()) as { meta?: { changes?: number } };
  if (!r.meta?.changes) throw new FinanceError(409, 'conflict', 'Someone else changed this a moment ago');
  return (await financeMember(db, userId))!;
}

export async function removeFinanceMember(db: D1Database, userId: string, removedBy: string, now: Date): Promise<FinanceMember | null> {
  const before = await financeMember(db, userId);
  if (!before || before.removedAt) return before;
  await db.prepare('UPDATE support_finance_members SET removed_at = ?, removed_by = ? WHERE user_id = ? AND removed_at IS NULL').bind(now.toISOString(), removedBy, userId).run();
  return financeMember(db, userId);
}

/** Marks an account as tech staff; it leaves the finance list at once. */
export async function markTechStaff(db: D1Database, userId: string, markedBy: string, now: Date): Promise<void> {
  if (!userId || userId.length > 100) throw new FinanceError(400, 'invalid_request', 'Choose a person');
  const at = now.toISOString();
  await db.batch([
    db.prepare('INSERT INTO support_tech_staff (user_id, marked_by, marked_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING').bind(userId, markedBy, at),
    db.prepare('UPDATE support_finance_members SET removed_at = ?, removed_by = ? WHERE user_id = ? AND removed_at IS NULL').bind(at, markedBy, userId),
  ]);
}

/** Unmarking needs a different super admin from the one who marked the account. */
export async function unmarkTechStaff(db: D1Database, userId: string, by: string): Promise<void> {
  const row = await db.prepare('SELECT marked_by FROM support_tech_staff WHERE user_id = ?').bind(userId).first<{ marked_by: string }>();
  if (!row) throw new FinanceError(404, 'not_found', 'Not marked as tech staff');
  if (row.marked_by === by || userId === by) throw new FinanceError(409, 'support_same_person', 'A second person has to remove this mark');
  await db.prepare('DELETE FROM support_tech_staff WHERE user_id = ?').bind(userId).run();
}
