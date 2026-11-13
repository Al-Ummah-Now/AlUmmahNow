/**
 * /api/status/* — the videos admin's Status page (docs/status-page/README.md).
 * Writes incidents and scheduled maintenance to the public status page's own D1
 * (STATUS_DB, migrations in apps/status), which the status Worker reads; reads
 * the latest checks from it. Behind authMiddleware + adminMiddleware
 * (src/index.ts); every route needs `status:manage` (admins and super admins).
 * Every change is recorded in admin_audit_log (REPORTS_DB).
 *
 *   GET    /overview                      checks (component_state) + incidents (open, recent, deleted)
 *   POST   /incidents                     { kind, titleEn, titleAr, status, impact, components, startsAt?, endsAt?, bodyEn, bodyAr }
 *   GET    /incidents/:id                 one incident with its updates
 *   PATCH  /incidents/:id                 { titleEn?, titleAr?, impact?, components?, startsAt?, endsAt? }
 *   POST   /incidents/:id/updates         { status, bodyEn, bodyAr, impact? } — resolved/completed closes it
 *   DELETE /incidents/:id                 soft delete (hidden from the public page, restorable for 30 days)
 *   POST   /incidents/:id/restore
 *   POST   /incidents/:id/purge           delete permanently now
 */
import { Hono, type Context } from 'hono';
import {
  INCIDENT_IMPACTS,
  INCIDENT_KINDS,
  STATUS_TEXT_LIMITS,
  isClosedStatus,
  isStatusComponentId,
  statusesFor,
  type IncidentKind,
  type StatusComponentId,
} from '@al-ummah/shared-types';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { logger } from '../lib/logger';
import { audit } from '../lib/authModeration';
import type { AdminBindings, AuthContext } from '../base/types';
import type { D1Database } from '../lib/types';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Deleted incidents are purged by the status Worker after this many days. */
export const STATUS_RESTORE_DAYS = 30;

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), 'status:manage')) {
    logger.warn('[Status] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The status:manage permission is required' }, 403);
  }
  if (!c.env.STATUS_DB) return c.json({ success: false, code: 'not_configured', error: 'The status page is not configured here' }, 503);
  return next();
});

app.onError((error, c) => {
  if (/no such table/i.test(String((error as Error)?.message))) {
    return c.json({ success: false, code: 'not_ready', error: 'The status page database has not been migrated yet' }, 503);
  }
  logger.error('[Status] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

const bad = (c: C, error: string) => c.json({ success: false, code: 'bad_request', error }, 400);
const notFound = (c: C) => c.json({ success: false, code: 'not_found', error: 'No such incident' }, 404);

function isIso(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
}
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\r\n?/g, '\n').trim();
  return s && s.length <= max ? s : null;
}

export interface IncidentInput {
  kind: IncidentKind;
  titleEn: string;
  titleAr: string;
  status: string;
  impact: string;
  components: StatusComponentId[];
  startsAt: string;
  endsAt: string | null;
  bodyEn: string;
  bodyAr: string;
}

/** Validates a new incident or maintenance; returns an error message or the clean input. */
export function parseIncidentInput(body: unknown, now = new Date()): IncidentInput | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (!(INCIDENT_KINDS as readonly unknown[]).includes(b.kind)) return 'kind must be incident or maintenance';
  const kind = b.kind as IncidentKind;
  const titleEn = cleanText(b.titleEn, STATUS_TEXT_LIMITS.title);
  const titleAr = cleanText(b.titleAr, STATUS_TEXT_LIMITS.title);
  if (!titleEn || !titleAr) return `English and Arabic titles are required (at most ${STATUS_TEXT_LIMITS.title} characters)`;
  const bodyEn = cleanText(b.bodyEn, STATUS_TEXT_LIMITS.body);
  const bodyAr = cleanText(b.bodyAr, STATUS_TEXT_LIMITS.body);
  if (!bodyEn || !bodyAr) return `English and Arabic messages are required (at most ${STATUS_TEXT_LIMITS.body} characters)`;
  const status = typeof b.status === 'string' ? b.status : kind === 'maintenance' ? 'scheduled' : 'investigating';
  if (!statusesFor(kind).includes(status as never)) return `status must be one of ${statusesFor(kind).join(', ')}`;
  const impact = kind === 'maintenance' ? 'maintenance' : typeof b.impact === 'string' ? b.impact : '';
  if (kind === 'incident' && !(INCIDENT_IMPACTS as readonly string[]).includes(impact)) return `impact must be one of ${INCIDENT_IMPACTS.join(', ')}`;
  if (!Array.isArray(b.components) || b.components.length === 0 || !b.components.every(isStatusComponentId)) return 'components must list at least one known component';
  const components = [...new Set(b.components as StatusComponentId[])];
  const startsAt = b.startsAt === undefined || b.startsAt === null ? now.toISOString() : isIso(b.startsAt) ? new Date(b.startsAt).toISOString() : null;
  if (!startsAt) return 'startsAt must be a date';
  let endsAt: string | null = null;
  if (b.endsAt !== undefined && b.endsAt !== null && b.endsAt !== '') {
    if (!isIso(b.endsAt)) return 'endsAt must be a date';
    endsAt = new Date(b.endsAt).toISOString();
    if (endsAt <= startsAt) return 'endsAt must be after startsAt';
  }
  if (kind === 'maintenance' && !endsAt) return 'maintenance needs an end time';
  return { kind, titleEn, titleAr, status, impact, components, startsAt, endsAt, bodyEn, bodyAr };
}

interface Row {
  id: string;
  kind: IncidentKind;
  title_en: string;
  title_ar: string;
  status: string;
  impact: string;
  components: string;
  starts_at: string;
  ends_at: string | null;
  resolved_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

function toIncident(r: Row) {
  let components: string[] = [];
  try {
    components = JSON.parse(r.components);
  } catch {
    components = [];
  }
  return {
    id: r.id,
    kind: r.kind,
    titleEn: r.title_en,
    titleAr: r.title_ar,
    status: r.status,
    impact: r.impact,
    components,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    deletedAt: r.deleted_at,
    purgeAfter: r.deleted_at ? new Date(Date.parse(r.deleted_at) + STATUS_RESTORE_DAYS * 86_400_000).toISOString() : null,
  };
}

async function updatesOf(db: D1Database, ids: string[]) {
  if (!ids.length) return [];
  const rows = (await db
    .prepare(`SELECT id, incident_id, status, body_en, body_ar, created_at, created_by FROM incident_updates WHERE incident_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`)
    .bind(...ids)
    .all<{ id: string; incident_id: string; status: string; body_en: string; body_ar: string; created_at: string; created_by: string }>()).results ?? [];
  return rows.map((u) => ({ id: u.id, incidentId: u.incident_id, status: u.status, bodyEn: u.body_en, bodyAr: u.body_ar, createdAt: u.created_at, createdBy: u.created_by }));
}

async function withUpdates(db: D1Database, rows: Row[]) {
  const updates = await updatesOf(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...toIncident(r), updates: updates.filter((u) => u.incidentId === r.id) }));
}

async function load(db: D1Database, id: string): Promise<Row | null> {
  return db.prepare('SELECT * FROM incidents WHERE id = ?').bind(id).first<Row>();
}

app.get('/overview', async (c) => {
  const db = c.env.STATUS_DB!;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [checks, open, recent, deleted] = await Promise.all([
    db.prepare('SELECT component, state, raw, since, checked_at, latency_ms, detail, alert_open FROM component_state').all(),
    db.prepare('SELECT * FROM incidents WHERE deleted_at IS NULL AND resolved_at IS NULL ORDER BY starts_at DESC LIMIT 100').all<Row>(),
    db.prepare('SELECT * FROM incidents WHERE deleted_at IS NULL AND resolved_at IS NOT NULL AND resolved_at >= ? ORDER BY resolved_at DESC LIMIT 50').bind(since).all<Row>(),
    db.prepare('SELECT * FROM incidents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50').all<Row>(),
  ]);
  return c.json({
    success: true,
    result: {
      checks: checks.results ?? [],
      open: await withUpdates(db, open.results ?? []),
      recent: await withUpdates(db, recent.results ?? []),
      deleted: (deleted.results ?? []).map(toIncident),
    },
  });
});

app.get('/incidents/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c);
  const row = await load(c.env.STATUS_DB!, id);
  if (!row) return notFound(c);
  return c.json({ success: true, result: (await withUpdates(c.env.STATUS_DB!, [row]))[0] });
});

app.post('/incidents', async (c) => {
  const parsed = parseIncidentInput(await c.req.json().catch(() => null));
  if (typeof parsed === 'string') return bad(c, parsed);
  const db = c.env.STATUS_DB!;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const actor = actorOf(c);
  const closed = isClosedStatus(parsed.status) ? now : null;
  await db.batch([
    db
      .prepare(`INSERT INTO incidents (id, kind, title_en, title_ar, status, impact, components, starts_at, ends_at, resolved_at, created_at, created_by, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, parsed.kind, parsed.titleEn, parsed.titleAr, parsed.status, parsed.impact, JSON.stringify(parsed.components), parsed.startsAt, parsed.endsAt, closed, now, actor, now, actor),
    db.prepare('INSERT INTO incident_updates (id, incident_id, status, body_en, body_ar, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, parsed.status, parsed.bodyEn, parsed.bodyAr, now, actor),
  ]);
  await audit(c.env.REPORTS_DB, { actorId: actor, action: `status.${parsed.kind}.create`, targetType: 'status_incident', targetId: id, metadata: { status: parsed.status, impact: parsed.impact, components: parsed.components } });
  const row = await load(db, id);
  return c.json({ success: true, result: (await withUpdates(db, [row!]))[0] }, 201);
});

app.patch('/incidents/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c);
  const db = c.env.STATUS_DB!;
  const row = await load(db, id);
  if (!row || row.deleted_at) return notFound(c);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const next = parseIncidentInput(
    {
      kind: row.kind,
      titleEn: b.titleEn ?? row.title_en,
      titleAr: b.titleAr ?? row.title_ar,
      status: row.status,
      impact: b.impact ?? row.impact,
      components: b.components ?? JSON.parse(row.components),
      startsAt: b.startsAt ?? row.starts_at,
      endsAt: b.endsAt === undefined ? row.ends_at : b.endsAt,
      bodyEn: '-',
      bodyAr: '-',
    },
    new Date(row.starts_at),
  );
  if (typeof next === 'string') return bad(c, next);
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE incidents SET title_en = ?, title_ar = ?, impact = ?, components = ?, starts_at = ?, ends_at = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(next.titleEn, next.titleAr, next.impact, JSON.stringify(next.components), next.startsAt, next.endsAt, now, actorOf(c), id)
    .run();
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), action: `status.${row.kind}.edit`, targetType: 'status_incident', targetId: id, metadata: { fields: Object.keys(b) } });
  return c.json({ success: true, result: (await withUpdates(db, [(await load(db, id))!]))[0] });
});

app.post('/incidents/:id/updates', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c);
  const db = c.env.STATUS_DB!;
  const row = await load(db, id);
  if (!row || row.deleted_at) return notFound(c);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const status = typeof b.status === 'string' ? b.status : '';
  if (!statusesFor(row.kind).includes(status as never)) return bad(c, `status must be one of ${statusesFor(row.kind).join(', ')}`);
  const bodyEn = cleanText(b.bodyEn, STATUS_TEXT_LIMITS.body);
  const bodyAr = cleanText(b.bodyAr, STATUS_TEXT_LIMITS.body);
  if (!bodyEn || !bodyAr) return bad(c, `English and Arabic messages are required (at most ${STATUS_TEXT_LIMITS.body} characters)`);
  let impact = row.impact;
  if (b.impact !== undefined) {
    if (row.kind !== 'incident' || !(INCIDENT_IMPACTS as readonly unknown[]).includes(b.impact)) return bad(c, `impact must be one of ${INCIDENT_IMPACTS.join(', ')}`);
    impact = b.impact as string;
  }
  const now = new Date().toISOString();
  const actor = actorOf(c);
  const resolvedAt = isClosedStatus(status) ? (row.resolved_at ?? now) : null;
  await db.batch([
    db.prepare('INSERT INTO incident_updates (id, incident_id, status, body_en, body_ar, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, status, bodyEn, bodyAr, now, actor),
    db.prepare('UPDATE incidents SET status = ?, impact = ?, resolved_at = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(status, impact, resolvedAt, now, actor, id),
  ]);
  await audit(c.env.REPORTS_DB, { actorId: actor, action: `status.${row.kind}.update`, targetType: 'status_incident', targetId: id, metadata: { status, impact } });
  return c.json({ success: true, result: (await withUpdates(db, [(await load(db, id))!]))[0] }, 201);
});

app.delete('/incidents/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c);
  const db = c.env.STATUS_DB!;
  const row = await load(db, id);
  if (!row || row.deleted_at) return notFound(c);
  const now = new Date().toISOString();
  await db.prepare('UPDATE incidents SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(now, actorOf(c), id).run();
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), action: `status.${row.kind}.delete`, targetType: 'status_incident', targetId: id });
  return c.json({ success: true, result: toIncident((await load(db, id))!) });
});

app.post('/incidents/:id/restore', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c);
  const db = c.env.STATUS_DB!;
  const row = await load(db, id);
  if (!row || !row.deleted_at) return notFound(c);
  await db.prepare('UPDATE incidents SET deleted_at = NULL, deleted_by = NULL, updated_at = ?, updated_by = ? WHERE id = ?').bind(new Date().toISOString(), actorOf(c), id).run();
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), action: `status.${row.kind}.restore`, targetType: 'status_incident', targetId: id });
  return c.json({ success: true, result: toIncident((await load(db, id))!) });
});

app.post('/incidents/:id/purge', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return notFound(c);
  const db = c.env.STATUS_DB!;
  const row = await load(db, id);
  // Only a deleted incident can be purged: deleting first keeps the 30-day restore window the default
  if (!row || !row.deleted_at) return notFound(c);
  await db.batch([db.prepare('DELETE FROM incident_updates WHERE incident_id = ?').bind(id), db.prepare('DELETE FROM incidents WHERE id = ?').bind(id)]);
  await audit(c.env.REPORTS_DB, { actorId: actorOf(c), action: `status.${row.kind}.purge`, targetType: 'status_incident', targetId: id });
  return c.json({ success: true, result: { id } });
});

export default app;
