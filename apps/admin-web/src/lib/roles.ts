import { normalizeRole as sharedNormalizeRole } from '@al-ummah/shared-types';

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
  return sharedNormalizeRole(role);
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
 * Upload processing health and the "Uploads & processing" section of the
 * Errors page: mirrors admin-api PERMISSIONS
 * (videos:processing is granted to admins and super admins, not moderators).
 */
export function canUseProcessing(role?: string): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'super_admin';
}

/**
 * Videos users tools (Restore legacy profile fields): mirrors the users:manage
 * content permission (shared-types ROLE_CONTENT_PERMISSIONS: admins and super
 * admins). admin-api enforces it; this only hides what the user cannot use.
 */
export function canManageVideosUsers(role?: string): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'super_admin';
}

/**
 * Stale uploads: mirrors admin-api PERMISSIONS (videos:uploads is granted to
 * admins and super admins, not moderators). admin-api enforces it; this only
 * hides what the user cannot open.
 */
export function canUseStaleUploads(role?: string): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'super_admin';
}

/**
 * Errors page: mirrors admin-api PERMISSIONS (errors:read and errors:manage
 * are granted to admins and super admins, apps/admin-api/src/lib/roles.ts).
 * admin-api enforces it; this only hides what the user cannot open or do.
 */
export function canReadErrors(role?: string): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'super_admin';
}

export function canManageErrors(role?: string): boolean {
  return canReadErrors(role);
}

/**
 * Creator tiers: assigning tiers and editing their limits mirrors the
 * creators:manage content permission (admins and super admins). Moderators
 * see the Creators page read-only.
 */
export function canManageCreators(role?: string): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'super_admin';
}
