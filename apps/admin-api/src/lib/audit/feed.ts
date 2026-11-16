/**
 * The admin-wide audit feed (GET /api/audit, issue #711): site_settings_log (the content audit,
 * soft deletes and settings changes) and admin_audit_log (Auth requests, status incidents, staff
 * devices) merged newest first, with filters for the actor, the item, the area, the action and a
 * date range, a page at a time (keyset cursor `<created_at>|<source>:<id>`).
 *
 * Invite actions are written to both tables (lib/invites.ts and the content audit); the feed shows
 * the content copy only. Reads only: the page writes no audit row.
 */
import {
  ADMIN_AUDIT_AREAS,
  ADMIN_AUDIT_ITEM_KINDS,
  REVIEW_ALERT_SETTINGS_KEY,
  SITE_THEME_SETTING_KEY,
  type AdminAuditArea,
  type AdminAuditFeedEntry,
  type AdminAuditItemKind,
  type AdminAuditQuery,
} from '@al-ummah/shared-types';
import type { D1Database } from '../types';

export const AUDIT_PAGE_DEFAULT = 25;
export const AUDIT_PAGE_MAX = 100;

/** One row of the union query. */
interface FeedRow {
  src: 'c' | 'a';
  id: string;
  target: string;
  target_type: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_id: string;
  actor_email: string | null;
  created_at: string;
  action: string | null;
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A stored value of a settings row: JSON when it is JSON, else the plain value. */
function settingValue(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  return parseJson(value) ?? { value };
}

/** The area, item and setting of a site_settings_log key. */
export function describeKey(key: string): { area: AdminAuditArea; target: { kind: string; id: string } | null; setting: string | null } {
  const rest = (prefix: string) => key.slice(prefix.length);
  const split = (prefix: string) => {
    const tail = rest(prefix);
    const at = tail.indexOf(':');
    return at > 0 ? { kind: tail.slice(0, at), id: tail.slice(at + 1) } : null;
  };
  if (key.startsWith('content:live-')) return { area: 'live', target: split('content:'), setting: null };
  if (key.startsWith('content:site:')) return { area: 'sites', target: { kind: 'channel', id: rest('content:site:') }, setting: null };
  // Payments (admin-api billing.router.ts): providers, keys, tax, prices, subscriptions, refunds
  if (key.startsWith('content:billing-')) return { area: 'payments', target: split('content:'), setting: null };
  if (key.startsWith('content:')) return { area: 'content', target: split('content:'), setting: null };
  if (key.startsWith('trash:')) return { area: 'trash', target: split('trash:'), setting: null };
  if (key.startsWith('processing:video:')) return { area: 'processing', target: { kind: 'video', id: rest('processing:video:') }, setting: null };
  if (key.startsWith('media:video:')) return { area: 'media', target: { kind: 'video', id: rest('media:video:') }, setting: null };
  if (key.startsWith('uploads:stale:')) return { area: 'uploads', target: { kind: 'video', id: rest('uploads:stale:') }, setting: null };
  if (key.startsWith('uploads:')) return { area: 'uploads', target: null, setting: key };
  if (key.startsWith('media:')) return { area: 'media', target: null, setting: key };
  if (key.startsWith('ops:threshold:')) return { area: 'operations', target: null, setting: key };
  if (key === SITE_THEME_SETTING_KEY || key.startsWith('theme')) return { area: 'themes', target: null, setting: key };
  if (key === REVIEW_ALERT_SETTINGS_KEY || key.startsWith('review-alerts:')) return { area: 'review', target: null, setting: key };
  return { area: 'settings', target: null, setting: key };
}

/** The area of an admin_audit_log action. */
export function areaOfAdminAction(action: string): AdminAuditArea {
  if (action.startsWith('auth_request.')) return 'auth';
  if (action.startsWith('status.')) return 'status';
  if (action.startsWith('staff_device')) return 'staff';
  return 'settings';
}

export function toFeedEntry(row: FeedRow): AdminAuditFeedEntry {
  if (row.src === 'a') {
    return {
      id: `admin:${row.id}`,
      source: 'admin',
      area: areaOfAdminAction(row.action ?? ''),
      action: row.action ?? 'unknown',
      target: row.target_type && row.target ? { kind: row.target_type, id: row.target } : null,
      details: parseJson(row.new_value),
      previous: null,
      setting: null,
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      createdAt: row.created_at,
    };
  }
  const { area, target, setting } = describeKey(row.target);
  const value = parseJson(row.new_value);
  const hasAction = typeof value?.action === 'string';
  // Content rows: { action, details? }; trash rows: { action, reason? }; settings rows: the new value
  const details = hasAction ? ((value!.details as Record<string, unknown> | undefined) ?? (value!.reason ? { reason: value!.reason } : null)) : settingValue(row.new_value);
  // A comp is audited on its user (content:user:<id>, action billing-comp): it is a Payments change
  const billingAction = hasAction && String(value!.action).startsWith('billing-');
  return {
    id: `content:${row.id}`,
    source: 'content',
    area: billingAction ? 'payments' : area,
    action: hasAction ? (value!.action as string) : 'changed',
    target,
    details,
    previous: hasAction ? parseJson(row.old_value) : settingValue(row.old_value),
    setting: hasAction ? null : setting,
    actorId: row.actor_id,
    actorEmail: null,
    createdAt: row.created_at,
  };
}

/** SQL (per table) for an area: LIKE patterns on site_settings_log keys, on admin_audit_log actions. */
function areaClauses(area: AdminAuditArea): { content: string | null; admin: string | null } {
  const like = (patterns: string[], not: string[] = []) => [`(${patterns.map((p) => `key LIKE '${p}'`).join(' OR ')})`, ...not.map((p) => `key NOT LIKE '${p}'`)].join(' AND ');
  const settingKeys = ['content:%', 'trash:%', 'processing:%', 'media:%', 'uploads:%', 'ops:threshold:%', 'theme%', `${SITE_THEME_SETTING_KEY}`, 'review-alerts:%'];
  switch (area) {
    case 'content':
      return { content: `${like(['content:%'], ['content:live-%', 'content:site:%', 'content:billing-%'])} AND new_value NOT LIKE '{"action":"billing-%'`, admin: null };
    case 'payments':
      return { content: `(key LIKE 'content:billing-%' OR (key LIKE 'content:%' AND new_value LIKE '{"action":"billing-%'))`, admin: null };
    case 'live':
      return { content: like(['content:live-%']), admin: null };
    case 'sites':
      return { content: like(['content:site:%']), admin: null };
    case 'trash':
      return { content: like(['trash:%']), admin: null };
    case 'processing':
      return { content: like(['processing:%']), admin: null };
    case 'media':
      return { content: like(['media:%']), admin: null };
    case 'uploads':
      return { content: like(['uploads:%']), admin: null };
    case 'operations':
      return { content: like(['ops:threshold:%']), admin: null };
    case 'themes':
      return { content: like(['theme%', SITE_THEME_SETTING_KEY]), admin: null };
    case 'review':
      return { content: like(['review-alerts:%']), admin: null };
    case 'settings':
      return { content: settingKeys.map((p) => `key NOT LIKE '${p}'`).join(' AND '), admin: "action NOT LIKE 'auth_request.%' AND action NOT LIKE 'status.%' AND action NOT LIKE 'staff_device%'" };
    case 'status':
      return { content: null, admin: "action LIKE 'status.%'" };
    case 'auth':
      return { content: null, admin: "action LIKE 'auth_request.%'" };
    case 'staff':
      return { content: null, admin: "action LIKE 'staff_device%'" };
  }
}

/** Keys of one item in site_settings_log (its content, soft-delete and per-video rows). */
function itemKeys(kind: AdminAuditItemKind, id: string): string[] {
  const keys = [`content:${kind}:${id}`, `trash:${kind}:${id}`];
  if (kind === 'video') keys.push(`processing:video:${id}`, `media:video:${id}`, `uploads:stale:${id}`);
  if (kind === 'channel') keys.push(`content:site:${id}`, `content:live-override:${id}`);
  return keys;
}

/** A bare date (YYYY-MM-DD) as the start, or with `end` the end, of that UTC day. */
function boundary(value: string | undefined, end: boolean): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return end ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function encodeCursor(entry: AdminAuditFeedEntry): string {
  return `${entry.createdAt}|${entry.id}`;
}

function decodeCursor(cursor: string | undefined): { createdAt: string; key: string } | null {
  if (!cursor) return null;
  const at = cursor.indexOf('|');
  if (at <= 0) return null;
  const createdAt = cursor.slice(0, at);
  const key = cursor.slice(at + 1);
  return /^(content|admin):/.test(key) ? { createdAt, key } : null;
}

/** Cleans a query from the URL (unknown values are dropped, not errors). */
export function cleanAuditQuery(q: Record<string, string | undefined>): AdminAuditQuery {
  const text = (v: string | undefined, max = 200) => (v && v.trim() ? v.trim().slice(0, max) : undefined);
  const itemKind = (ADMIN_AUDIT_ITEM_KINDS as readonly string[]).includes(q.itemKind ?? '') ? (q.itemKind as AdminAuditItemKind) : undefined;
  return {
    actorId: text(q.actorId),
    itemKind,
    itemId: itemKind ? text(q.itemId) : undefined,
    area: (ADMIN_AUDIT_AREAS as readonly string[]).includes(q.area ?? '') ? (q.area as AdminAuditArea) : undefined,
    action: text(q.action, 100),
    from: text(q.from, 40),
    to: text(q.to, 40),
    cursor: text(q.cursor, 300),
    limit: Math.min(Math.max(Math.floor(Number(q.limit) || AUDIT_PAGE_DEFAULT), 1), AUDIT_PAGE_MAX),
  };
}

/** The computed action of a site_settings_log row (settings rows hold a value, not an action). */
const CONTENT_ACTION = `CASE WHEN json_valid(new_value) AND json_type(new_value, '$.action') = 'text' THEN json_extract(new_value, '$.action') ELSE 'changed' END`;

/** One page of the feed. */
export async function readAuditFeed(db: D1Database, query: AdminAuditQuery): Promise<{ items: AdminAuditFeedEntry[]; next: string | null }> {
  const limit = query.limit ?? AUDIT_PAGE_DEFAULT;
  const content: string[] = [];
  const contentArgs: unknown[] = [];
  const admin: string[] = ["action NOT LIKE 'invite.%'"];
  const adminArgs: unknown[] = [];
  let useContent = true;
  let useAdmin = true;

  if (query.actorId) {
    content.push('actor_id = ?');
    contentArgs.push(query.actorId);
    admin.push('actor_id = ?');
    adminArgs.push(query.actorId);
  }
  if (query.itemKind && query.itemId) {
    const keys = itemKeys(query.itemKind, query.itemId);
    content.push(`key IN (${keys.map(() => '?').join(', ')})`);
    contentArgs.push(...keys);
    admin.push('target_type = ? AND target_id = ?');
    adminArgs.push(query.itemKind, query.itemId);
  }
  if (query.area) {
    const clauses = areaClauses(query.area);
    if (clauses.content) content.push(clauses.content);
    else useContent = false;
    if (clauses.admin) admin.push(clauses.admin);
    else useAdmin = false;
  }
  if (query.action) {
    content.push(`${CONTENT_ACTION} = ?`);
    contentArgs.push(query.action);
    admin.push('action = ?');
    adminArgs.push(query.action);
  }
  const from = boundary(query.from, false);
  const to = boundary(query.to, true);
  for (const [clause, value] of [['created_at >= ?', from], ['created_at <= ?', to]] as const) {
    if (!value) continue;
    content.push(clause);
    contentArgs.push(value);
    admin.push(clause);
    adminArgs.push(value);
  }
  // Keyset: rows strictly after the cursor in (created_at DESC, key DESC) order
  const after = decodeCursor(query.cursor);
  if (after) {
    content.push("(created_at < ? OR (created_at = ? AND ('content:' || id) < ?))");
    contentArgs.push(after.createdAt, after.createdAt, after.key);
    admin.push("(created_at < ? OR (created_at = ? AND ('admin:' || id) < ?))");
    adminArgs.push(after.createdAt, after.createdAt, after.key);
  }

  const parts: string[] = [];
  const args: unknown[] = [];
  // Each side is limited on its own first, so neither table is read past one page
  if (useContent) {
    parts.push(
      `SELECT * FROM (SELECT 'c' AS src, id, key AS target, NULL AS target_type, old_value, new_value, actor_id, NULL AS actor_email, created_at, ${CONTENT_ACTION} AS action, 'content:' || id AS sort_key
       FROM site_settings_log ${content.length ? `WHERE ${content.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?)`,
    );
    args.push(...contentArgs, limit + 1);
  }
  if (useAdmin) {
    parts.push(
      `SELECT * FROM (SELECT 'a' AS src, id, target_id AS target, target_type, NULL AS old_value, metadata AS new_value, actor_id, actor_email, created_at, action, 'admin:' || id AS sort_key
       FROM admin_audit_log WHERE ${admin.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?)`,
    );
    args.push(...adminArgs, limit + 1);
  }
  if (!parts.length) return { items: [], next: null };
  const { results = [] } = await db
    .prepare(`${parts.join(' UNION ALL ')} ORDER BY created_at DESC, sort_key DESC LIMIT ?`)
    .bind(...args, limit + 1)
    .all<FeedRow>();
  const page = results.slice(0, limit).map(toFeedEntry);
  return { items: page, next: results.length > limit && page.length ? encodeCursor(page[page.length - 1]) : null };
}

/** Every action recorded (for the Action filter), most used first. Small tables: a grouped scan. */
export async function readAuditActions(db: D1Database): Promise<{ action: string; area: AdminAuditArea }[]> {
  const [content, admin] = await Promise.all([
    db.prepare(`SELECT ${CONTENT_ACTION} AS action, MIN(key) AS key, COUNT(*) AS n FROM site_settings_log GROUP BY 1 ORDER BY n DESC LIMIT 200`).bind().all<{ action: string; key: string }>(),
    db.prepare("SELECT action, COUNT(*) AS n FROM admin_audit_log WHERE action NOT LIKE 'invite.%' GROUP BY action ORDER BY n DESC LIMIT 200").bind().all<{ action: string }>(),
  ]);
  const seen = new Map<string, AdminAuditArea>();
  for (const r of content.results ?? []) if (!seen.has(r.action)) seen.set(r.action, describeKey(r.key).area);
  for (const r of admin.results ?? []) if (!seen.has(r.action)) seen.set(r.action, areaOfAdminAction(r.action));
  return [...seen].map(([action, area]) => ({ action, area }));
}
