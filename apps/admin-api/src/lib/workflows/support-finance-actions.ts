/**
 * The finance list and tech-staff marks on the approval workflow (wiki AUN-WORKFLOWS WF-5, AUN-MEMBERS §9.6).
 *
 * - `support.financeList.add`: a super admin proposes someone (or new money permissions for them); a
 *   different super admin approves. Nobody adds themselves, the person added never approves it, and tech
 *   staff can't be added. On approval the member row is written with `approved_by` = the approver, so
 *   `financeAllows` (lib/support-finance.ts) reads it exactly as before.
 * - `support.techStaff.unmark`: a super admin proposes removing the mark; a second super admin approves;
 *   whoever marked the account never approves removing the mark.
 *
 * Removing someone from the list and marking tech staff stay immediate and one-person: they only take
 * access away (§3).
 */
import { FINANCE_ONLY_SUPPORT_PERMISSIONS, type SupportPermission, type WorkflowField } from '@al-ummah/shared-types';
import { FinanceError, financeMember, isTechStaff } from '../support-finance';
import { registerWorkflowExecutor, WorkflowError } from './engine';
import type { WorkflowExecutor } from './types';

const PERMISSION_LABELS: Record<string, { en: string; ar: string }> = {
  'support:refund': { en: 'Refunds', ar: 'الاستردادات' },
  'support:disputes': { en: 'Disputes', ar: 'النزاعات' },
  'support:payouts': { en: 'Payouts', ar: 'التحويلات' },
  'support:ledger': { en: 'Ledger', ar: 'السجل المالي' },
  'support:providers': { en: 'Providers and fees', ar: 'المزوّدون والرسوم' },
};

export interface FinanceAddPayload {
  userId: string;
  permissions: SupportPermission[];
}

function cleanPermissions(input: unknown): SupportPermission[] {
  if (!Array.isArray(input) || !input.length) throw new FinanceError(400, 'invalid_request', 'Choose at least one money permission');
  const out = [...new Set(input)].filter((p): p is SupportPermission => typeof p === 'string' && (FINANCE_ONLY_SUPPORT_PERMISSIONS as readonly string[]).includes(p));
  if (out.length !== input.length) throw new FinanceError(400, 'invalid_request', 'Unknown permission');
  return out.sort();
}

async function memberVersion(db: Parameters<typeof financeMember>[0], userId: string): Promise<string> {
  const [m, tech] = await Promise.all([financeMember(db, userId), isTechStaff(db, userId)]);
  return JSON.stringify({ p: m && !m.removedAt && m.approvedBy ? m.permissions : null, tech });
}

export const financeAddExecutor: WorkflowExecutor<FinanceAddPayload, { userId: string }> = {
  type: 'support.financeList.add',
  target: (p) => ({ kind: 'finance-member', id: p.userId }),
  canPropose: async (_ctx, actor, p) => actor.roles.includes('super_admin') && actor.userId !== p.userId,
  async validate(ctx, input) {
    const i = (input ?? {}) as { userId?: unknown; permissions?: unknown };
    const userId = typeof i.userId === 'string' ? i.userId.trim() : '';
    if (!userId || userId.length > 100) throw new FinanceError(400, 'invalid_request', 'Choose a person');
    if (await isTechStaff(ctx.db, userId)) throw new FinanceError(409, 'support_tech_staff', 'Tech staff can’t be on the finance list');
    return { userId, permissions: cleanPermissions(i.permissions) };
  },
  async describe(ctx, p) {
    const m = await financeMember(ctx.db, p.userId);
    const current = m && !m.removedAt && m.approvedBy ? [...m.permissions].sort() : null;
    const fields: WorkflowField[] = [
      { key: 'person', label: { en: 'Person', ar: 'الشخص' }, kind: 'person', before: current ? p.userId : null, after: p.userId },
      {
        key: 'permissions',
        label: { en: 'Money permissions', ar: 'صلاحيات الأموال' },
        kind: 'list',
        before: current,
        after: p.permissions,
        enumLabels: PERMISSION_LABELS,
      },
    ];
    return {
      title: current ? { en: 'Change someone’s money permissions', ar: 'تغيير صلاحيات الأموال لشخص' } : { en: 'Add someone to the finance list', ar: 'إضافة شخص إلى قائمة المالية' },
      fields,
      baseVersion: await memberVersion(ctx.db, p.userId),
      subjectUserId: p.userId,
    };
  },
  currentVersion: (ctx, p) => memberVersion(ctx.db, p.userId),
  async applyStatements(ctx, p, request) {
    const approvedBy = request.approvedBy[request.approvedBy.length - 1];
    if (!approvedBy) throw new WorkflowError(409, 'approval_not_allowed', { reason: 'no_approver' });
    const at = ctx.now().toISOString();
    return {
      statements: [
        ctx.db
          .prepare(
            `INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at, removed_at, removed_by) VALUES (?, ?, ?, ?, ?, NULL, NULL)
             ON CONFLICT(user_id) DO UPDATE SET roles = excluded.roles, added_by = excluded.added_by, approved_by = excluded.approved_by, added_at = excluded.added_at, removed_at = NULL, removed_by = NULL`,
          )
          .bind(p.userId, JSON.stringify(p.permissions), request.proposedBy, approvedBy, at),
      ],
      result: { userId: p.userId },
    };
  },
};

export interface TechUnmarkPayload {
  userId: string;
}

async function markedBy(db: Parameters<typeof isTechStaff>[0], userId: string): Promise<string | null> {
  const r = await db.prepare('SELECT marked_by FROM support_tech_staff WHERE user_id = ?').bind(userId).first<{ marked_by: string }>();
  return r?.marked_by ?? null;
}

export const techUnmarkExecutor: WorkflowExecutor<TechUnmarkPayload, { userId: string }> = {
  type: 'support.techStaff.unmark',
  target: (p) => ({ kind: 'tech-staff', id: p.userId }),
  canPropose: async (_ctx, actor, p) => actor.roles.includes('super_admin') && actor.userId !== p.userId,
  async validate(ctx, input) {
    const userId = typeof (input as { userId?: unknown })?.userId === 'string' ? ((input as { userId: string }).userId).trim() : '';
    if (!userId || userId.length > 100) throw new FinanceError(400, 'invalid_request', 'Choose a person');
    if (!(await markedBy(ctx.db, userId))) throw new FinanceError(404, 'not_found', 'Not marked as tech staff');
    return { userId };
  },
  async describe(ctx, p) {
    return {
      title: { en: 'Remove a tech-staff mark', ar: 'إزالة علامة الفريق التقني' },
      fields: [
        { key: 'person', label: { en: 'Person', ar: 'الشخص' }, kind: 'person', before: p.userId, after: p.userId },
        { key: 'techStaff', label: { en: 'Tech staff', ar: 'الفريق التقني' }, kind: 'bool', before: true, after: false },
      ],
      baseVersion: (await markedBy(ctx.db, p.userId)) ?? '',
      subjectUserId: p.userId,
    };
  },
  currentVersion: async (ctx, p) => (await markedBy(ctx.db, p.userId)) ?? '',
  approverBlocks: async (ctx, p, actorId) => ((await markedBy(ctx.db, p.userId)) === actorId ? ['marked_them'] : []),
  async applyStatements(ctx, p) {
    return { statements: [ctx.db.prepare('DELETE FROM support_tech_staff WHERE user_id = ?').bind(p.userId)], result: { userId: p.userId } };
  },
};

let registered = false;
export function registerSupportFinanceExecutors(): void {
  if (registered) return;
  registered = true;
  registerWorkflowExecutor(financeAddExecutor);
  registerWorkflowExecutor(techUnmarkExecutor);
}
