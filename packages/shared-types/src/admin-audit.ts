/**
 * The admin-wide Audit page (issue #711): every recorded admin action, from the content audit
 * (site_settings_log, which also holds settings changes) and the admin audit log
 * (admin_audit_log: Auth requests, status incidents, staff devices), newest first.
 *
 * Ids are named for display (#745): `names` carries the users and items a page mentions, so the
 * page never shows a raw id as its main text.
 */

/** What part of the admin an entry belongs to (the Area filter). */
export const ADMIN_AUDIT_AREAS = [
  'content',
  'trash',
  'processing',
  'uploads',
  'media',
  'live',
  'payments',
  'sites',
  'themes',
  'settings',
  'operations',
  'review',
  'status',
  'auth',
  'staff',
] as const;
export type AdminAuditArea = (typeof ADMIN_AUDIT_AREAS)[number];

/** Item kinds the Item filter can pick (the autocomplete kinds that audit rows name). */
export const ADMIN_AUDIT_ITEM_KINDS = ['user', 'channel', 'video', 'playlist', 'post', 'comment'] as const;
export type AdminAuditItemKind = (typeof ADMIN_AUDIT_ITEM_KINDS)[number];

export interface AdminAuditFeedEntry {
  /** `<source>:<row id>`, unique across both tables. */
  id: string;
  source: 'content' | 'admin';
  area: AdminAuditArea;
  /** The recorded action ('transfer', 'delete', 'auth_request.sent'…); settings changes are 'changed'. */
  action: string;
  /** The item acted on, when the row names one. */
  target: { kind: string; id: string } | null;
  details: Record<string, unknown> | null;
  previous: Record<string, unknown> | null;
  /** The setting a 'changed' row is about (its key), for its label. */
  setting: string | null;
  actorId: string;
  actorEmail: string | null;
  createdAt: string;
}

export interface AdminAuditQuery {
  actorId?: string;
  itemKind?: AdminAuditItemKind;
  itemId?: string;
  area?: AdminAuditArea;
  action?: string;
  /** ISO date or date-time; inclusive. */
  from?: string;
  /** ISO date or date-time; a bare date includes that whole day. */
  to?: string;
  cursor?: string;
  limit?: number;
}

/** A user named for display. */
export interface AdminNamedUser {
  id: string;
  found: boolean;
  name: string | null;
  userName: string | null;
  email: string | null;
}

/** An item named for display. */
export interface AdminNamedItem {
  kind: string;
  id: string;
  found: boolean;
  title: string | null;
}

/** Names for the ids a response mentions: users by id, items by `<kind>:<id>`. */
export interface AdminNames {
  users: Record<string, AdminNamedUser>;
  items: Record<string, AdminNamedItem>;
}

export interface AdminAuditFeedPage {
  items: AdminAuditFeedEntry[];
  /** Cursor of the next page; null after the last one. */
  next: string | null;
  names: AdminNames;
}

/** POST /api/names: ids to name (each list capped at ADMIN_NAMES_MAX). */
export interface AdminNamesRequest {
  users?: string[];
  items?: { kind: string; id: string }[];
}
export const ADMIN_NAMES_MAX = 100;

/** Actor ids that are the system, not a person (cleanups, queues, the CSAM responder). */
export function isSystemActor(actorId: string | null | undefined): boolean {
  if (!actorId) return true;
  return /^(system[:-]|cron[:-]|queue$|cleanup$|admin$|csam-response$|e2e$)/.test(actorId) || actorId.startsWith('system');
}

/** Detail keys whose value is the id of a user, channel, video or playlist (named on display). */
export function auditRefKind(key: string, value: unknown): 'user' | 'channel' | 'video' | 'playlist' | null {
  if (typeof value !== 'string' || !value || value.length > 200) return null;
  const k = key.toLowerCase();
  if (!k.endsWith('id')) return null;
  if (/channel/.test(k)) return 'channel';
  if (/video/.test(k)) return 'video';
  if (/playlist/.test(k)) return 'playlist';
  if (/owner|user|actor|member|assignee|subject|moderator|admin/.test(k) || /^usr_/.test(value)) return 'user';
  return null;
}
