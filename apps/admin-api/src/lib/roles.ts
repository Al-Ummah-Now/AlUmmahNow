/**
 * Role helpers for the admin API.
 *
 * The auth server puts RBAC role display names in the token ("Super Admin",
 * "Admin", "Moderator"). Everything in this service compares against
 * snake_case ids, so roles are normalized once when the token is read.
 *
 * Role names are read by the shared helper (packages/shared-types roles.ts).
 */
import { normalizeRole, normalizeRoles } from '@al-ummah/shared-types';

export const ADMIN_ROLE_IDS = ['super_admin', 'admin'] as const;
export const MODERATOR_ROLE_IDS = [...ADMIN_ROLE_IDS, 'moderator'] as const;

// One reading of role names for every app (packages/shared-types roles.ts)
export { normalizeRole, normalizeRoles };

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
  /** See the moderation requests sent to auth and their status. */
  'auth_requests:read': MODERATOR_ROLE_IDS,
  /** Send a moderation request to auth (suspend/delete the auth identity, …), retry it, answer auth. */
  'auth_requests:send': ADMIN_ROLE_IDS,
  /** Read the Errors page (error groups, samples, timeline). */
  'errors:read': ADMIN_ROLE_IDS,
  /** Acknowledge, resolve, ignore, assign and annotate error groups. */
  'errors:manage': ADMIN_ROLE_IDS,
  /** Stale uploads: list abandoned upload placeholders and Bunny orphans; Delete now, Keep, Retry, reaper mode. */
  'videos:uploads': ADMIN_ROLE_IDS,
  /** Short/video formats: run the backfill, list unclassifiable videos, set a video's format. */
  'videos:format': ADMIN_ROLE_IDS,
  /** Delivery comparison (epic #687): the Bunny/R2 switch, transcode jobs and retry, QoE and cost. */
  'media:manage': ADMIN_ROLE_IDS,
  /** Operations page (docs/admin/LIVE_OPS.md): platform usage, latency, backlog and estimated cost. */
  'ops:read': ADMIN_ROLE_IDS,
  /** Change the Operations alert thresholds. */
  'ops:manage': ['super_admin'],
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

/** Sending a moderation request to auth: the auth_requests:send permission (admins and super admins). */
export function canRequestAuthAction(roles: readonly string[] | undefined): boolean {
  return hasPermission(roles, 'auth_requests:send');
}
