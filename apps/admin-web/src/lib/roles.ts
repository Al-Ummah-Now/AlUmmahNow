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
 * Pick the highest-privilege admin role from the auth server's role list
 * (display names or ids). Returns undefined when the user has none.
 */
export function highestAdminRole(roles?: readonly string[]): SystemRole | undefined {
  const normalized = (roles ?? []).map((r) => normalizeRole(r));
  return ADMIN_ROLES.find((role) => normalized.includes(role));
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

/**
 * Contact us inbox: mirrors admin-api PERMISSIONS (contact:read and
 * contact:manage are granted to admins and super admins, not moderators).
 * admin-api enforces it; this only hides what the user cannot open.
 */
export function canUseContactInbox(role?: string): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'super_admin';
}

/**
 * Upload processing health and the Errors page: mirrors admin-api PERMISSIONS
 * (videos:processing is granted to admins and super admins, not moderators).
 */
export function canUseProcessing(role?: string): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'super_admin';
}
