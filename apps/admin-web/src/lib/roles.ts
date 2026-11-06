/**
 * System role names that are protected from modification/deletion
 * These roles are provided by the auth server
 */
export const SYSTEM_ROLES = [
  'super_admin',
  'admin',
  'moderator',
  'user'
] as const;

export type SystemRole = typeof SYSTEM_ROLES[number];

/**
 * Roles that have admin access
 */
export const ADMIN_ROLES: SystemRole[] = ['super_admin', 'admin', 'moderator'];

/**
 * Normalize a role name from the auth server to the internal form.
 * The auth server emits RBAC role display names ("Super Admin", "Admin",
 * "Moderator"); internally we use snake_case ids ("super_admin", ...).
 */
export function normalizeRole(role?: string): string {
  return (role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Check if a role has admin access
 */
export function hasAdminAccess(role?: string): boolean {
  return ADMIN_ROLES.includes(normalizeRole(role) as SystemRole);
}

/**
 * Check if a role is super admin
 */
export function isSuperAdmin(role?: string): boolean {
  return normalizeRole(role) === "super_admin";
}

/**
 * Check if a role can perform moderation actions
 */
export function canModerate(role?: string): boolean {
  return ADMIN_ROLES.includes(normalizeRole(role) as SystemRole);
}
