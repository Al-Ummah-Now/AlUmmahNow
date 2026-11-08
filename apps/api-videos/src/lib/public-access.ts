/** Role names as issued by auth ("Admin", "Super Admin"), compared case-insensitively. */
const ADMIN_ROLES = new Set(['admin', 'super admin', 'super_admin', 'superadmin']);

export function isAdminRole(roles: readonly string[] | undefined | null): boolean {
	return Array.isArray(roles) && roles.some((r) => ADMIN_ROLES.has(String(r).trim().toLowerCase()));
}
