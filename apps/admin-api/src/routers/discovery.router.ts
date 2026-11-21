/**
 * /api/discovery — videos admin › Discovery (wiki E07 "Discovery ranking").
 *
 *   GET    /                      pins, exclusions, home rail order, categories, the last ranking run,
 *                                 the main rails (mode, label, size) and recent runs; canManage
 *   POST   /pins                  { rail, kind, target, position, startsAt?, endsAt?, note? } pin a video or
 *                                 channel (target: id, link or @handle) at a position of a rail
 *   PATCH  /pins/:id              { position?, startsAt?, endsAt?, note? }
 *   DELETE /pins/:id              → { pin } (the removed pin, for Undo)
 *   POST   /exclusions            { kind, target, reason? } keep a video or channel off every rail
 *   DELETE /exclusions/:kind/:id
 *   PUT    /home-rails            { rails: [{ rail, enabled }] } the home page's rails, in order
 *   POST   /run                   rank now (the discovery.rank admin job)
 *   GET    /preview?rail=&scope=  a rail's first items with why each is there
 *   GET    /history               the latest changes (audit log, newest first)
 *
 * The curation tables live in the search D1 (api-videos migration 0068); the ranking job reads them.
 * Every admin role reads; changes need discovery:manage. Each change is audited first (site_settings_log
 * content:discovery:<video|channel>:<id> for pins and exclusions, content:discovery:home for the
 * home order) and the audit row is dropped when the change fails. A pin or exclusion queues a ranking run so it shows within minutes; the home order needs
 * none (the home endpoint reads it, cached two minutes).
 */
import { Hono, type Context } from 'hono';
import {
  DISCOVERY_HOME_RAILS,
  DISCOVERY_MAX_PIN_POSITION,
  DISCOVERY_NOTE_MAX,
  DISCOVERY_PIN_KINDS,
  isDiscoveryPinRail,
  type DiscoveryAdminState,
  type DiscoveryExclusionView,
  type DiscoveryHomeRail,
  type DiscoveryHomeRailView,
  type DiscoveryPinKind,
  type DiscoveryPinView,
  type SearchDb,
} from '@al-ummah/shared-types';
import { hasPermission } from '../lib/roles';
import { logger } from '../lib/logger';
import { auditKey, dropAudit, writeAudit } from '../lib/content/audit';
import { callVideos, VideosError, type VideosClientEnv } from '../lib/content/videosClient';
import { resolveNames } from '../lib/queue/names';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string, readonly fields?: Record<string, string>) {
    super(message ?? code);
  }
}

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const PREVIEW_SCOPE = /^(|lang:(ar|en)|cat:[a-z0-9_-]{1,64})$/;
const PREVIEW_RAILS = ['trending:day', 'trending:week', 'trending:month', 'popular', 'new', 'featured', 'top'];

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ success: false, code: error.code, error: error.message, ...(error.fields ? { fields: error.fields } : {}) }, error.status as 400);
  }
  if (error instanceof VideosError) {
    logger.warn('[Discovery] api-videos call failed', { path: c.req.path, status: error.status, code: error.code });
    return c.json({ success: false, code: error.code, error: error.message }, (error.status >= 500 ? 502 : error.status) as 400);
  }
  logger.error('[Discovery] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

function db(c: C): SearchDb {
  const bound = c.env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!bound) throw new HttpError(503, 'not_configured', 'SEARCH_DB not bound');
  return bound;
}

function needManage(c: C) {
  if (!hasPermission(c.get('auth')?.roles, 'discovery:manage')) {
    logger.warn('[Discovery] Permission denied', { userId: actorOf(c), path: c.req.path });
    throw new HttpError(403, 'forbidden', 'The discovery:manage permission is required');
  }
}

/**
 * Pure: the id a pasted value names. Accepts an id, a watch/Shorts/live link (/video/<id>,
 * /shorts/<id>, /live/<id>, ?v=<id>), a channel link (/channel/<id>) or an @handle.
 */
export function parseTarget(kind: DiscoveryPinKind, input: unknown): { id: string } | { handle: string } | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || value.length > 500) return null;
  const handle = /(?:^|\/)@([A-Za-z0-9._-]{2,64})\/?$/.exec(value);
  if (handle) return kind === 'channel' ? { handle: handle[1]!.toLowerCase() } : null;
  let path = value;
  try {
    const url = new URL(value);
    const v = url.searchParams.get('v');
    if (v && kind === 'video') return /^[A-Za-z0-9_-]{1,128}$/.test(v) ? { id: v } : null;
    path = url.pathname;
  } catch {
    // Not a link: an id
  }
  const segment = kind === 'video' ? /\/(?:video|shorts|live|watch)\/([A-Za-z0-9_-]{1,128})/.exec(path) : /\/(?:channel|c)\/([A-Za-z0-9_-]{1,128})/.exec(path);
  if (segment) return { id: segment[1]! };
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? { id: value } : null;
}

interface Named {
  title: string | null;
  titleLocalized: { en?: string; ar?: string } | null;
  thumbnailUrl: string | null;
}

/** Titles (videos) and names (channels) from the search index, in one query per kind. */
async function namesOf(d: SearchDb, items: Array<{ kind: DiscoveryPinKind; id: string }>): Promise<Map<string, Named>> {
  const out = new Map<string, Named>();
  for (const kind of DISCOVERY_PIN_KINDS) {
    const ids = [...new Set(items.filter((i) => i.kind === kind).map((i) => i.id))];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const table = kind === 'video' ? 'search_videos' : 'search_channels';
      const titleField = kind === 'video' ? '$.title' : '$.name';
      const localizedField = kind === 'video' ? '$.titleLocalized' : '$.nameLocalized';
      const imageField = kind === 'video' ? '$.thumbnailUrl' : '$.avatarUrl';
      const { results = [] } = await d
        .prepare(
          `SELECT id, json_extract(payload, '${titleField}') AS title, json_extract(payload, '${localizedField}') AS localized, json_extract(payload, '${imageField}') AS image FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`,
        )
        .bind(...chunk)
        .all<{ id: string; title: string | null; localized: string | null; image: string | null }>();
      for (const r of results) {
        let localized: Named['titleLocalized'] = null;
        try {
          localized = r.localized ? (JSON.parse(r.localized) as Named['titleLocalized']) : null;
        } catch {
          localized = null;
        }
        out.set(`${kind}:${r.id}`, { title: r.title, titleLocalized: localized, thumbnailUrl: r.image });
      }
    }
  }
  return out;
}

/** The target's id once it is known to exist in the search index (public or not: an admin may pin ahead). */
async function resolveTarget(d: SearchDb, kind: DiscoveryPinKind, input: unknown): Promise<string> {
  const parsed = parseTarget(kind, input);
  if (!parsed) throw new HttpError(400, 'invalid_target', 'Choose a video or channel', { target: 'invalid' });
  if ('handle' in parsed) {
    const row = await d
      .prepare("SELECT id FROM content_ownership WHERE kind = 'channel' AND lower(handle) = ? LIMIT 1")
      .bind(parsed.handle)
      .first<{ id: string }>();
    if (!row) throw new HttpError(404, 'target_not_found', 'No channel has that handle', { target: 'not_found' });
    return row.id;
  }
  const table = kind === 'video' ? 'search_videos' : 'search_channels';
  const row = await d.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(parsed.id).first<{ id: string }>();
  if (!row) throw new HttpError(404, 'target_not_found', kind === 'video' ? 'No video has that id' : 'No channel has that id', { target: 'not_found' });
  return row.id;
}

interface PinRow {
  id: string;
  rail: string;
  kind: DiscoveryPinKind;
  target_id: string;
  position: number;
  starts_at: number | null;
  ends_at: number | null;
  note: string | null;
  created_by: string;
  created_at: number;
  updated_by: string | null;
  updated_at: number;
}

const iso = (ms: number | null) => (ms === null || ms === undefined ? null : new Date(Number(ms)).toISOString());

function pinView(row: PinRow, names: Map<string, Named>, now: number): DiscoveryPinView {
  const named = names.get(`${row.kind}:${row.target_id}`);
  const state = row.ends_at !== null && Number(row.ends_at) <= now ? 'ended' : row.starts_at !== null && Number(row.starts_at) > now ? 'scheduled' : 'active';
  return {
    id: row.id,
    rail: row.rail as DiscoveryPinView['rail'],
    kind: row.kind,
    targetId: row.target_id,
    title: named?.title ?? null,
    titleLocalized: named?.titleLocalized ?? null,
    thumbnailUrl: named?.thumbnailUrl ?? null,
    position: Number(row.position),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    note: row.note,
    createdBy: row.created_by,
    createdAt: iso(row.created_at)!,
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at)!,
    state,
  };
}

async function readPins(d: SearchDb): Promise<PinRow[]> {
  const { results = [] } = await d
    .prepare('SELECT id, rail, kind, target_id, position, starts_at, ends_at, note, created_by, created_at, updated_by, updated_at FROM discovery_pins ORDER BY rail, position, created_at')
    .all<PinRow>();
  return results;
}

async function readPin(d: SearchDb, id: string): Promise<PinRow | null> {
  return d
    .prepare('SELECT id, rail, kind, target_id, position, starts_at, ends_at, note, created_by, created_at, updated_by, updated_at FROM discovery_pins WHERE id = ?')
    .bind(id)
    .first<PinRow>();
}

/** Pure: the home rails in the admin's order; rails missing from the stored order follow, on. */
export function homeRailsView(stored: Array<{ rail: string; enabled: number }>): DiscoveryHomeRailView[] {
  const known = stored.filter((r) => (DISCOVERY_HOME_RAILS as readonly string[]).includes(r.rail));
  const seen = new Set(known.map((r) => r.rail));
  return [
    ...known.map((r) => ({ rail: r.rail as DiscoveryHomeRail, enabled: Number(r.enabled) === 1 })),
    ...DISCOVERY_HOME_RAILS.filter((r) => !seen.has(r)).map((rail) => ({ rail, enabled: true })),
  ];
}

async function readHomeRails(d: SearchDb): Promise<DiscoveryHomeRailView[]> {
  const { results = [] } = await d.prepare('SELECT rail, enabled FROM discovery_home_rails ORDER BY position, rail').all<{ rail: string; enabled: number }>();
  return homeRailsView(results);
}

/** Pure: a time field (ISO string, or null to clear); undefined when absent. */
function timeField(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new HttpError(400, 'invalid_time', 'Not a date and time', { [field]: 'invalid' });
  return ms;
}

function positionField(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > DISCOVERY_MAX_PIN_POSITION) {
    throw new HttpError(400, 'invalid_position', `Position is 1 to ${DISCOVERY_MAX_PIN_POSITION}`, { position: 'invalid' });
  }
  return n;
}

function noteField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_note', 'Note must be text', { note: 'invalid' });
  const note = value.trim().replace(/\s+/g, ' ');
  if (note.length > DISCOVERY_NOTE_MAX) throw new HttpError(400, 'invalid_note', `Note is at most ${DISCOVERY_NOTE_MAX} characters`, { note: 'too_long' });
  return note || null;
}

/** Queues a ranking run so a change shows within minutes (best effort: the hourly run follows anyway). */
async function rankSoon(c: C): Promise<boolean> {
  try {
    await callVideos(c.env, '/rank', { method: 'POST', base: '/internal/discovery', json: { actorId: actorOf(c) }, actorId: actorOf(c) });
    return true;
  } catch (error) {
    logger.warn('[Discovery] Ranking run not queued after a change', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function audited<T>(c: C, entry: Parameters<typeof writeAudit>[1], change: () => Promise<T>): Promise<T> {
  const auditId = await writeAudit(c.env.REPORTS_DB, entry);
  try {
    return await change();
  } catch (error) {
    await dropAudit(c.env.REPORTS_DB, auditId).catch(() => undefined);
    throw error;
  }
}

app.get('/', async (c) => {
  const d = db(c);
  const now = Date.now();
  const [pins, exclusionRows, homeRails, categoryRows, status] = await Promise.all([
    readPins(d),
    d
      .prepare('SELECT kind, target_id, reason, created_by, created_at FROM discovery_exclusions ORDER BY created_at DESC')
      .all<{ kind: DiscoveryPinKind; target_id: string; reason: string | null; created_by: string; created_at: number }>()
      .then((r) => r.results ?? []),
    readHomeRails(d),
    d
      .prepare('SELECT value, label_en, label_ar FROM video_categories WHERE retired = 0 ORDER BY position, value')
      .all<{ value: string; label_en: string; label_ar: string }>()
      .then((r) => r.results ?? [])
      .catch(() => []),
    callVideos<DiscoveryAdminState['status']>(c.env, '/status', { base: '/internal/discovery' }).catch((error) => {
      logger.warn('[Discovery] Ranking status unavailable', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }),
  ]);
  const names = await namesOf(d, [...pins.map((p) => ({ kind: p.kind, id: p.target_id })), ...exclusionRows.map((x) => ({ kind: x.kind, id: x.target_id }))]);
  const exclusions: DiscoveryExclusionView[] = exclusionRows.map((x) => {
    const named = names.get(`${x.kind}:${x.target_id}`);
    return { kind: x.kind, targetId: x.target_id, title: named?.title ?? null, titleLocalized: named?.titleLocalized ?? null, reason: x.reason, createdBy: x.created_by, createdAt: iso(x.created_at)! };
  });
  const body: DiscoveryAdminState = {
    pins: pins.map((p) => pinView(p, names, now)),
    exclusions,
    homeRails,
    categories: categoryRows.map((r) => ({ value: r.value, label: { en: r.label_en, ar: r.label_ar } })),
    status,
    canManage: hasPermission(c.get('auth')?.roles, 'discovery:manage'),
  };
  return c.json({ success: true, result: body });
});

app.post('/pins', async (c) => {
  needManage(c);
  const d = db(c);
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!isDiscoveryPinRail(body.rail)) throw new HttpError(400, 'invalid_rail', 'Choose where to pin', { rail: 'invalid' });
  const kind = body.kind as DiscoveryPinKind;
  if (!(DISCOVERY_PIN_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'invalid_kind', 'Pin a video or a channel', { kind: 'invalid' });
  const position = positionField(body.position ?? 1);
  const startsAt = timeField(body.startsAt, 'startsAt') ?? null;
  const endsAt = timeField(body.endsAt, 'endsAt') ?? null;
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) throw new HttpError(400, 'invalid_window', 'The end is before the start', { endsAt: 'before_start' });
  const note = noteField(body.note) ?? null;
  const targetId = await resolveTarget(d, kind, body.target);
  const exists = await d.prepare('SELECT id FROM discovery_pins WHERE rail = ? AND kind = ? AND target_id = ?').bind(body.rail, kind, targetId).first<{ id: string }>();
  if (exists) throw new HttpError(409, 'already_pinned', 'Already pinned there', { target: 'already_pinned' });
  const id = crypto.randomUUID();
  const now = Date.now();
  const actor = actorOf(c);
  const details = { rail: body.rail, position, startsAt: iso(startsAt), endsAt: iso(endsAt), note };
  await audited(c, { kind: 'discovery', id: `${kind}:${targetId}`, action: 'discovery.pin', actorId: actor, details }, () =>
    d
      .prepare('INSERT INTO discovery_pins (id, rail, kind, target_id, position, starts_at, ends_at, note, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, body.rail, kind, targetId, position, startsAt, endsAt, note, actor, now, actor, now)
      .run(),
  );
  const ranking = await rankSoon(c);
  const row = (await readPin(d, id))!;
  return c.json({ success: true, result: { pin: pinView(row, await namesOf(d, [{ kind, id: targetId }]), now), ranking } }, 201);
});

app.patch('/pins/:id', async (c) => {
  needManage(c);
  const d = db(c);
  const row = await readPin(d, c.req.param('id'));
  if (!row) throw new HttpError(404, 'not_found', 'That pin is gone');
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const position = body.position === undefined ? Number(row.position) : positionField(body.position);
  const startsAt = timeField(body.startsAt, 'startsAt');
  const endsAt = timeField(body.endsAt, 'endsAt');
  const note = noteField(body.note);
  const next = {
    position,
    starts_at: startsAt === undefined ? row.starts_at : startsAt,
    ends_at: endsAt === undefined ? row.ends_at : endsAt,
    note: note === undefined ? row.note : note,
  };
  if (next.starts_at !== null && next.ends_at !== null && Number(next.ends_at) <= Number(next.starts_at)) {
    throw new HttpError(400, 'invalid_window', 'The end is before the start', { endsAt: 'before_start' });
  }
  const changed = next.position !== Number(row.position) || next.starts_at !== row.starts_at || next.ends_at !== row.ends_at || next.note !== row.note;
  const now = Date.now();
  if (changed) {
    const actor = actorOf(c);
    await audited(
      c,
      {
        kind: 'discovery',
        id: `${row.kind}:${row.target_id}`,
        action: 'discovery.pin-edit',
        actorId: actor,
        details: { rail: row.rail, position: next.position, startsAt: iso(next.starts_at), endsAt: iso(next.ends_at), note: next.note },
        previous: { position: Number(row.position), startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), note: row.note },
      },
      () =>
        d
          .prepare('UPDATE discovery_pins SET position = ?, starts_at = ?, ends_at = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?')
          .bind(next.position, next.starts_at, next.ends_at, next.note, actor, now, row.id)
          .run(),
    );
    await rankSoon(c);
  }
  const updated = (await readPin(d, row.id))!;
  return c.json({ success: true, result: { pin: pinView(updated, await namesOf(d, [{ kind: row.kind, id: row.target_id }]), now), changed } });
});

app.delete('/pins/:id', async (c) => {
  needManage(c);
  const d = db(c);
  const row = await readPin(d, c.req.param('id'));
  if (!row) throw new HttpError(404, 'not_found', 'That pin is gone');
  const now = Date.now();
  const view = pinView(row, await namesOf(d, [{ kind: row.kind, id: row.target_id }]), now);
  await audited(
    c,
    { kind: 'discovery', id: `${row.kind}:${row.target_id}`, action: 'discovery.unpin', actorId: actorOf(c), previous: { rail: row.rail, position: Number(row.position), startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), note: row.note } },
    () => d.prepare('DELETE FROM discovery_pins WHERE id = ?').bind(row.id).run(),
  );
  await rankSoon(c);
  return c.json({ success: true, result: { pin: view } });
});

app.post('/exclusions', async (c) => {
  needManage(c);
  const d = db(c);
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const kind = body.kind as DiscoveryPinKind;
  if (!(DISCOVERY_PIN_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'invalid_kind', 'Exclude a video or a channel', { kind: 'invalid' });
  const reason = noteField(body.reason) ?? null;
  const targetId = await resolveTarget(d, kind, body.target);
  const exists = await d.prepare('SELECT 1 AS x FROM discovery_exclusions WHERE kind = ? AND target_id = ?').bind(kind, targetId).first();
  if (exists) throw new HttpError(409, 'already_excluded', 'Already kept off the lists', { target: 'already_excluded' });
  const now = Date.now();
  const actor = actorOf(c);
  await audited(c, { kind: 'discovery', id: `${kind}:${targetId}`, action: 'discovery.exclude', actorId: actor, details: { reason } }, () =>
    d.prepare('INSERT INTO discovery_exclusions (kind, target_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(kind, targetId, reason, actor, now).run(),
  );
  const ranking = await rankSoon(c);
  const named = (await namesOf(d, [{ kind, id: targetId }])).get(`${kind}:${targetId}`);
  const exclusion: DiscoveryExclusionView = { kind, targetId, title: named?.title ?? null, titleLocalized: named?.titleLocalized ?? null, reason, createdBy: actor, createdAt: iso(now)! };
  return c.json({ success: true, result: { exclusion, ranking } }, 201);
});

app.delete('/exclusions/:kind/:id', async (c) => {
  needManage(c);
  const d = db(c);
  const kind = c.req.param('kind') as DiscoveryPinKind;
  const targetId = c.req.param('id');
  if (!(DISCOVERY_PIN_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'invalid_kind', 'Unknown kind');
  const row = await d
    .prepare('SELECT reason FROM discovery_exclusions WHERE kind = ? AND target_id = ?')
    .bind(kind, targetId)
    .first<{ reason: string | null }>();
  if (!row) throw new HttpError(404, 'not_found', 'Not kept off the lists');
  await audited(c, { kind: 'discovery', id: `${kind}:${targetId}`, action: 'discovery.include', actorId: actorOf(c), previous: { reason: row.reason } }, () =>
    d.prepare('DELETE FROM discovery_exclusions WHERE kind = ? AND target_id = ?').bind(kind, targetId).run(),
  );
  await rankSoon(c);
  return c.json({ success: true, result: { kind, targetId, reason: row.reason } });
});

app.put('/home-rails', async (c) => {
  needManage(c);
  const d = db(c);
  const body = ((await c.req.json().catch(() => null)) ?? {}) as { rails?: unknown };
  const rails = Array.isArray(body.rails) ? body.rails : null;
  const valid =
    rails &&
    rails.length === DISCOVERY_HOME_RAILS.length &&
    new Set(rails.map((r) => (r as { rail?: unknown })?.rail)).size === DISCOVERY_HOME_RAILS.length &&
    rails.every((r) => (DISCOVERY_HOME_RAILS as readonly string[]).includes((r as { rail?: unknown })?.rail as string) && typeof (r as { enabled?: unknown }).enabled === 'boolean');
  if (!valid) throw new HttpError(400, 'invalid_rails', 'Every home rail, once each, with on or off');
  const next = (rails as DiscoveryHomeRailView[]).map((r) => ({ rail: r.rail, enabled: r.enabled }));
  if (!next.some((r) => r.enabled)) throw new HttpError(400, 'none_enabled', 'Keep at least one rail on the home page', { rails: 'none_enabled' });
  const before = await readHomeRails(d);
  const changed = JSON.stringify(before) !== JSON.stringify(next);
  if (changed) {
    const actor = actorOf(c);
    const now = Date.now();
    await audited(c, { kind: 'discovery', id: 'home', action: 'discovery.home-rails', actorId: actor, details: { rails: next }, previous: { rails: before } }, () =>
      d.batch(
        next.map((r, i) =>
          d
            .prepare('INSERT INTO discovery_home_rails (rail, position, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (rail) DO UPDATE SET position = excluded.position, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
            .bind(r.rail, (i + 1) * 10, r.enabled ? 1 : 0, actor, now),
        ),
      ),
    );
  }
  return c.json({ success: true, result: { homeRails: await readHomeRails(d), changed } });
});

app.post('/run', async (c) => {
  needManage(c);
  const result = await callVideos<{ job: unknown; existing: boolean }>(c.env, '/rank', { method: 'POST', base: '/internal/discovery', json: { actorId: actorOf(c) }, actorId: actorOf(c) });
  return c.json({ success: true, result }, 202);
});

app.get('/preview', async (c) => {
  const rail = c.req.query('rail') ?? '';
  const scope = c.req.query('scope') ?? '';
  if (!PREVIEW_RAILS.includes(rail) || !PREVIEW_SCOPE.test(scope)) throw new HttpError(400, 'invalid_rail', 'Unknown rail');
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '24', 10) || 24));
  const result = await callVideos<unknown>(c.env, '/preview', { base: '/internal/discovery', query: { rail, scope, limit } });
  return c.json({ success: true, result });
});

app.get('/history', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
  const prefix = auditKey('discovery', '');
  const { results = [] } = await c.env.REPORTS_DB
    .prepare('SELECT id, key, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key >= ? AND key < ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .bind(prefix, `${prefix.slice(0, -1)};`, limit)
    .all<{ id: string; key: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }>();
  // Keys: content:discovery:<video|channel>:<id>, content:discovery:home
  const parsed = results.map((r) => {
    const rest = r.key.slice(prefix.length);
    const sep = rest.indexOf(':');
    return sep < 0 ? { row: r, kind: rest, id: '' } : { row: r, kind: rest.slice(0, sep), id: rest.slice(sep + 1) };
  });
  const [actors, titles] = await Promise.all([
    resolveNames(c.env.SEARCH_DB as never, { profiles: results.map((r) => r.actor_id) }),
    namesOf(db(c), parsed.filter((p) => p.kind === 'video' || p.kind === 'channel').map((p) => ({ kind: p.kind as DiscoveryPinKind, id: p.id }))),
  ]);
  const entries = parsed.map(({ row, kind, id }) => {
    const change = JSON.parse(row.new_value) as { action: string; details?: Record<string, unknown> };
    return {
      id: row.id,
      action: change.action,
      kind,
      targetId: id,
      title: titles.get(`${kind}:${id}`)?.title ?? null,
      details: change.details ?? null,
      previous: row.old_value ? JSON.parse(row.old_value) : null,
      actorId: row.actor_id,
      actorName: actors.profiles.get(row.actor_id) ?? null,
      createdAt: row.created_at,
    };
  });
  return c.json({ success: true, result: { entries } });
});

export default app;
