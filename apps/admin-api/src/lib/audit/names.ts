/**
 * Names for the ids admin pages show (issue #745): users by display name, @handle and email,
 * items (channels, videos, playlists, posts, comments) by title. One batched api-videos lookup
 * (POST /internal/admin/lookup) per call. An id that cannot be named comes back with
 * found=false, so the page shows the id itself; when api-videos cannot be reached every id does.
 */
import {
  ADMIN_NAMES_MAX,
  REPORTABLE_ENTITY_TYPES,
  isSystemActor,
  type AdminAuditFeedEntry,
  type AdminNames,
  type AdminNamesRequest,
  type ReportableEntityType,
  auditRefKind,
} from '@al-ummah/shared-types';
import { hiddenFrom, isHiddenItem } from '../moderation/takedown';
import { lookupMany, type MetaEnv } from '../moderation/reportMeta';

const isReportable = (kind: string): kind is ReportableEntityType => (REPORTABLE_ENTITY_TYPES as readonly string[]).includes(kind);
const cleanId = (id: unknown): string | null => (typeof id === 'string' && id.trim() && id.length <= 200 ? id.trim() : null);

/** Cleans a names request: strings only, deduplicated, each list capped. Items of kind user join the users. */
export function cleanNamesRequest(body: unknown): { users: string[]; items: { kind: ReportableEntityType; id: string }[] } {
  const raw = (body && typeof body === 'object' ? body : {}) as AdminNamesRequest;
  const users = new Set<string>();
  const items = new Map<string, { kind: ReportableEntityType; id: string }>();
  for (const id of Array.isArray(raw.users) ? raw.users : []) {
    const clean = cleanId(id);
    if (clean && !isSystemActor(clean)) users.add(clean);
  }
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    const id = cleanId(item?.id);
    if (!id || typeof item?.kind !== 'string') continue;
    if (item.kind === 'user') users.add(id);
    else if (isReportable(item.kind)) items.set(`${item.kind}:${id}`, { kind: item.kind, id });
  }
  return { users: [...users].slice(0, ADMIN_NAMES_MAX), items: [...items.values()].slice(0, ADMIN_NAMES_MAX) };
}

/**
 * Names the users and items (an empty result when api-videos cannot be reached). Emails only
 * with `includeEmail` (roles with audit:read): moderators get names, not addresses. Items under a takedown have a
 * name for super admins only.
 */
export async function resolveNames(env: MetaEnv, req: { users: string[]; items: { kind: ReportableEntityType; id: string }[] }, includeEmail = false, roles?: readonly unknown[]): Promise<AdminNames> {
  const names: AdminNames = { users: {}, items: {} };
  if (!req.users.length && !req.items.length) return names;
  const lookup = await lookupMany(env, req.items.map((i) => ({ type: i.kind, id: i.id })), req.users);
  if (!lookup) return names;
  for (const u of lookup.users.values()) {
    if (!req.users.includes(u.id)) continue;
    names.users[u.id] = { id: u.id, found: u.found, name: u.displayName, userName: u.userName, email: includeEmail ? (u.email ?? null) : null };
  }
  const hidden = await hiddenFrom(env.REPORTS_DB, roles, req.items.map((i) => ({ type: i.kind, id: i.id })));
  for (const i of lookup.items.values()) {
    names.items[`${i.type}:${i.id}`] = { kind: i.type, id: i.id, found: i.found, title: isHiddenItem(hidden, i.type, i.id) ? null : i.title };
  }
  return names;
}

/** Every user and item a page of the feed mentions: actors, targets and id-valued details. */
export function idsOfFeed(entries: AdminAuditFeedEntry[]): AdminNamesRequest {
  const users: string[] = [];
  const items: { kind: string; id: string }[] = [];
  const add = (kind: string, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    if (kind === 'user') users.push(id);
    else items.push({ kind, id });
  };
  for (const e of entries) {
    add('user', e.actorId);
    if (e.target) add(e.target.kind, e.target.id);
    for (const record of [e.details, e.previous]) {
      if (!record) continue;
      for (const [key, value] of Object.entries(record)) {
        const kind = auditRefKind(key, value);
        if (kind) add(kind, value);
      }
    }
  }
  return { users, items };
}
