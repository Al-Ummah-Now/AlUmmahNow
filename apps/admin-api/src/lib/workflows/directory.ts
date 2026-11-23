/**
 * Who is who for the workflow engine (wiki AUN-WORKFLOWS §4.1, §4.2):
 * - roles: the person acting brings them in their token; other people's roles come from the staff list
 *   (admin_staff in the reports D1, kept from tokens; lib/admin-staff.ts);
 * - the finance list and tech-staff marks: search D1 (AUN-MEMBERS, lib/support-finance.ts);
 * - the owner: the tech-staff mark (WF-D4), plus any account in PLATFORM_OWNER_USER_IDS.
 *
 * Every lookup is by primary key or an index: idx_support_finance_active (search 0082) and the
 * admin_staff role indexes. Results are memoized for one request.
 */
import { FINANCE_ONLY_SUPPORT_PERMISSIONS, normalizeRoles, type SupportPermission, type WorkflowActor, type WorkflowApproverSet } from '@al-ummah/shared-types';
import { listActiveStaff, type StaffRole } from '../admin-staff';
import type { D1Database } from '../types';
import type { WorkflowDirectory } from './types';

function parsePermissions(raw: string | null | undefined): SupportPermission[] {
  try {
    return (JSON.parse(raw || '[]') as string[]).filter((p): p is SupportPermission => (FINANCE_ONLY_SUPPORT_PERMISSIONS as readonly string[]).includes(p));
  } catch {
    return [];
  }
}

export function ownerIdsFrom(value: string | undefined | null): Set<string> {
  return new Set((value ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

export function createWorkflowDirectory(opts: { searchDb: D1Database; reportsDb?: D1Database | null; ownerIds?: Set<string> }): WorkflowDirectory {
  const owners = opts.ownerIds ?? new Set<string>();
  const financeCache = new Map<string, Promise<SupportPermission[]>>();
  const techCache = new Map<string, Promise<boolean>>();
  const roleCache = new Map<string, Promise<string[]>>();

  const financePermissions = (userId: string) => {
    let p = financeCache.get(userId);
    if (!p) {
      p = opts.searchDb
        .prepare('SELECT roles FROM support_finance_members WHERE user_id = ? AND removed_at IS NULL AND approved_by IS NOT NULL')
        .bind(userId)
        .first<{ roles: string }>()
        .then((r) => (r ? parsePermissions(r.roles) : []));
      financeCache.set(userId, p);
    }
    return p;
  };
  const techStaff = (userId: string) => {
    let p = techCache.get(userId);
    if (!p) {
      p = opts.searchDb.prepare('SELECT 1 AS x FROM support_tech_staff WHERE user_id = ?').bind(userId).first<{ x: number }>().then((r) => !!r);
      techCache.set(userId, p);
    }
    return p;
  };
  const staffRoles = (userId: string) => {
    let p = roleCache.get(userId);
    if (!p) {
      p = opts.reportsDb
        ? opts.reportsDb
            .prepare('SELECT role FROM admin_staff WHERE user_id = ? AND active = 1')
            .bind(userId)
            .first<{ role: StaffRole }>()
            // admin_staff keeps the highest role: a super admin is also an admin
            .then((r) => (r ? (r.role === 'super_admin' ? ['super_admin', 'admin'] : [r.role]) : []))
        : Promise.resolve([]);
      roleCache.set(userId, p);
    }
    return p;
  };

  const build = async (userId: string, roles: readonly string[]): Promise<WorkflowActor> => {
    const [perms, tech] = await Promise.all([financePermissions(userId), techStaff(userId)]);
    // Tech staff never hold money permissions, whatever the list says (AUN-MEMBERS §9.6).
    return { userId, roles: [...roles], financePermissions: tech ? [] : perms, techStaff: tech, owner: tech || owners.has(userId) };
  };

  return {
    actor: (userId, roles) => build(userId, normalizeRoles([...roles])),
    facts: async (userId) => build(userId, await staffRoles(userId)),
    async candidates(sets: readonly WorkflowApproverSet[]) {
      const ids = new Set<string>();
      const roles = new Set<StaffRole>();
      let finance = false;
      for (const s of sets) {
        if (s.kind === 'people') s.userIds.forEach((u) => ids.add(u));
        else if (s.kind === 'finance') finance = true;
        else if (s.role === 'admin') {
          roles.add('admin');
          roles.add('super_admin');
        } else roles.add('super_admin');
      }
      if (roles.size && opts.reportsDb) for (const row of await listActiveStaff(opts.reportsDb, [...roles])) ids.add(row.user_id);
      if (finance) {
        const { results } = await opts.searchDb
          .prepare('SELECT user_id FROM support_finance_members WHERE removed_at IS NULL AND approved_by IS NOT NULL LIMIT 200')
          .all<{ user_id: string }>();
        for (const r of results ?? []) ids.add(r.user_id);
      }
      return [...ids];
    },
  };
}
