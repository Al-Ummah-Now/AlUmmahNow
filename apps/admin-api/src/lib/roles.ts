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
