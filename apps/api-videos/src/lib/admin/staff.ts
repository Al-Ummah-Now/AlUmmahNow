/**
 * The videos admin's staff: every live account that holds one of the given
 * admin roles (for pickers such as the contact inbox's "Assign to"). Read-only
 * from AUTH_DB, where role assignments are stored (rbac_user_roles); never
 * written here, and roles are never changed through it.
 *
 * Indexed: rbac_user_roles by role_id (idx_rbac_user_roles_role), users by
 * primary key. Never a scan of the Auth tables (sign-ins share that database).
 */

/** The only roles this lookup answers for (role ids in the auth server's RBAC). */
export const STAFF_ROLE_IDS = ['role_super_admin', 'role_admin', 'role_moderator'] as const;
export type StaffRoleId = (typeof STAFF_ROLE_IDS)[number];

/** At most this many accounts; staff lists are small. */
export const STAFF_LIMIT = 500;

export interface StaffAccount {
	id: string;
	email: string;
	name: string | null;
	roles: StaffRoleId[];
}

interface AuthDb {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
}

export function cleanStaffRoles(raw: string | undefined): StaffRoleId[] {
	const wanted = (raw ?? '').split(',').map((r) => r.trim());
	return STAFF_ROLE_IDS.filter((id) => wanted.includes(id));
}

export async function listStaff(authDb: AuthDb, roles: StaffRoleId[], now = Date.now()): Promise<StaffAccount[]> {
	if (!roles.length) return [];
	const marks = roles.map(() => '?').join(', ');
	const { results } = await authDb
		.prepare(
			`SELECT ur.user_id AS id, ur.role_id AS role, u.email AS email, u.name AS name
			 FROM rbac_user_roles ur JOIN users u ON u.id = ur.user_id
			 WHERE ur.role_id IN (${marks}) AND ur.tenant_id = 'default'
			   AND (ur.expires_at IS NULL OR ur.expires_at > ?)
			   AND u.deleted_at IS NULL AND u.status = 'active'
			 LIMIT ?`,
		)
		.bind(...roles, now, STAFF_LIMIT * roles.length)
		.all<{ id: string; role: StaffRoleId; email: string; name: string | null }>();
	const byId = new Map<string, StaffAccount>();
	for (const row of results ?? []) {
		const account = byId.get(row.id) ?? { id: row.id, email: row.email, name: row.name?.trim() || null, roles: [] };
		if (!account.roles.includes(row.role)) account.roles.push(row.role);
		byId.set(row.id, account);
	}
	return [...byId.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)).slice(0, STAFF_LIMIT);
}
