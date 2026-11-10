/**
 * Role checks, one place for every app (videos API, admin API, admin web).
 *
 * The auth server only names roles in the token ("Super Admin", "Admin",
 * "Moderator"); what a role may do is decided by each app. These helpers just
 * read the names the same way everywhere: case, spaces and dashes don't matter
 * ("Super Admin", "super-admin", "super_admin" and "superadmin" all match).
 */

export const ROLE_IDS = {
  superAdmin: 'super_admin',
  admin: 'admin',
  moderator: 'moderator',
} as const;

export type RoleId = (typeof ROLE_IDS)[keyof typeof ROLE_IDS];

/** Spellings without a separator that mean a known role */
const ALIASES: Record<string, string> = { superadmin: ROLE_IDS.superAdmin };

/** "Super Admin" -> "super_admin", "admin" -> "admin". */
export function normalizeRole(role: unknown): string {
  const id = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[id] ?? id;
}

/** A token's role claim, normalized; empty and non-string entries dropped. */
export function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles.filter((role): role is string => typeof role === 'string').map(normalizeRole).filter((role) => role.length > 0);
}

/** True when any of the roles is one of `ids`. */
export function hasAnyRole(roles: unknown, ids: readonly string[]): boolean {
  return normalizeRoles(roles).some((role) => ids.includes(role));
}

/** Super Admin. */
export const isSuperAdmin = (roles: unknown): boolean => hasAnyRole(roles, [ROLE_IDS.superAdmin]);

/** Super Admin or Admin (not Moderator). */
export const isAdmin = (roles: unknown): boolean => hasAnyRole(roles, [ROLE_IDS.superAdmin, ROLE_IDS.admin]);

/** Super Admin, Admin or Moderator. */
export const isModerator = (roles: unknown): boolean => hasAnyRole(roles, [ROLE_IDS.superAdmin, ROLE_IDS.admin, ROLE_IDS.moderator]);
