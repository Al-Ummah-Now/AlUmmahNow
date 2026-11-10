/**
 * Role helpers for the admin API.
 *
 * The auth server puts RBAC role display names in the token ("Super Admin",
 * "Admin", "Moderator"). Everything in this service compares against
 * snake_case ids, so roles are normalized once when the token is read.
 *
 * This module has no imports so it can be unit tested without the Workers runtime.
 */

export const ADMIN_ROLE_IDS = ['super_admin', 'admin'] as const;
export const MODERATOR_ROLE_IDS = [...ADMIN_ROLE_IDS, 'moderator'] as const;

/** "Super Admin" -> "super_admin", "admin" -> "admin". */
export function normalizeRole(role: unknown): string {
  return String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Normalize a token's role claim, dropping empty and non-string entries. */
export function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .filter((role): role is string => typeof role === 'string')
    .map(normalizeRole)
    .filter((role) => role.length > 0);
}

/** True for super admins and admins (not moderators). */
export function hasAdminRole(roles: readonly string[] | undefined): boolean {
  const normalized = normalizeRoles(roles ?? []);
  return ADMIN_ROLE_IDS.some((role) => normalized.includes(role));
}

/** True for anyone allowed into the admin API: super admins, admins and moderators. */
export function hasModeratorRole(roles: readonly string[] | undefined): boolean {
  const normalized = normalizeRoles(roles ?? []);
  return MODERATOR_ROLE_IDS.some((role) => normalized.includes(role));
}

/**
 * Permissions of the videos admin (this service), granted per role. The auth
 * server only names the roles; what a role may do here is decided here.
 */
export const PERMISSIONS = {
  /** Read the Contact us inbox. */
  'contact:read': ADMIN_ROLE_IDS,
  /** Change status and assignee, add notes, reply to and delete contact messages. */
  'contact:manage': ADMIN_ROLE_IDS,
  /** Upload processing health: sync from Bunny, retry processing, mark failed. */
  'videos:processing': ADMIN_ROLE_IDS,
} as const satisfies Record<string, readonly string[]>;

export type Permission = keyof typeof PERMISSIONS;

/** True when any of the roles grants the permission. */
export function hasPermission(roles: readonly string[] | undefined, permission: Permission): boolean {
  const granted: readonly string[] = PERMISSIONS[permission];
  return normalizeRoles(roles ?? []).some((role) => granted.includes(role));
}

/** Every permission the roles grant (sorted), for clients that hide what they cannot do. */
export function permissionsFor(roles: readonly string[] | undefined): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => hasPermission(roles, p)).sort();
}
