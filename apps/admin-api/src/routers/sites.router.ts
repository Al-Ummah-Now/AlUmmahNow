/**
 * /api/sites/* — white-label scholar sites, the admin side (wiki AUN-SCHOLAR-SITES §8, SS1).
 *
 * Behind authMiddleware + adminMiddleware. Reads are open to every admin role; changes need
 * creators:manage (the same permission as giving a creator plan). The add-on is recorded in the
 * existing plan tables (migration 0022): one entitlement_overrides row per site.* key on the
 * channel, reason `addon:<tier>`. The site's own data (settings, hosts) lives in api-videos
 * (/internal/sites). Every change is audited (content audit, key content:site:<channelId>).
 *
 *   GET    /api/sites                       list (newest grant first)
 *   GET    /api/sites/slug/:slug?channelId= subdomain availability (format, reserved, taken)
 *   GET    /api/sites/:channelId            { site, channel, history }
 *   POST   /api/sites/:channelId            grant { tier, slug, limits?, locales? }
 *   PATCH  /api/sites/:channelId            { status?, tier?, limits?, slug? }
 *   DELETE /api/sites/:channelId            revoke (restorable for 30 days)
 *   POST   /api/sites/:channelId/restore
 */
import { Hono, type Context } from 'hono';
import {
  SITE_LIMIT_KEYS,
  SITE_TIER_SEEDS,
  SITE_TIERS,
  currentThemeRef,
  hasContentPermission,
  type SiteLimits,
  type SiteSettings,
  type SiteTier,
} from '@al-ummah/shared-types';
import { readAudit, writeAudit } from '../lib/content/audit';
import { readSiteTheme } from '../lib/siteSettings';
import { logger } from '../lib/logger';
import type { VideosClientEnv } from '../lib/content/videosClient';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? code);
  }
}

const auth = (c: C) => c.get('auth');
const actorOf = (c: C) => auth(c)?.userId ?? 'unknown';
function needManage(c: C) {
  if (!hasContentPermission(auth(c)?.roles, 'creators:manage')) throw new HttpError(403, 'forbidden', 'The creators:manage permission is required');
}
const CHANNEL_ID = /^[A-Za-z0-9_-]{1,80}$/;
function channelIdOf(c: C): string {
  const id = c.req.param('channelId') ?? '';
  if (!CHANNEL_ID.test(id)) throw new HttpError(400, 'bad_request', 'Invalid channel id');
  return id;
}

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  logger.error('[Sites] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

/** Calls api-videos /internal/sites (service binding, INTERNAL_API_KEY); errors pass through as is. */
export async function callSites<T>(env: VideosClientEnv, method: string, path: string, actorId: string, json?: unknown): Promise<T> {
  const binding = env.INTERNAL_API_KEY;
  const key = typeof binding === 'string' ? binding : await binding?.get();
  if (!key) throw new HttpError(500, 'not_configured', 'INTERNAL_API_KEY is not configured');
  const init: RequestInit = {
    method,
    headers: { 'X-API-Key': key, 'X-Admin-Actor': actorId, ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  };
  const url = `/internal/sites${path}`;
  let res: Response;
  if (env.VIDEOS) res = await env.VIDEOS.fetch(`https://videos.internal${url}`, init);
  else if (env.VIDEOS_API_URL) res = await fetch(`${env.VIDEOS_API_URL.replace(/\/$/, '')}${url}`, init);
  else throw new HttpError(500, 'not_configured', 'The VIDEOS service binding is not configured');
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new HttpError(res.status, payload?.error ?? 'videos_error', payload?.error ?? `api-videos answered ${res.status}`);
  return payload as T;
}

interface Db {
  prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results?: T[] }>; first<T>(): Promise<T | null> } };
  batch?(statements: unknown[]): Promise<unknown>;
}

/** The add-on as entitlement overrides on the channel (one row per key). */
export async function writeSiteEntitlements(db: Db, channelId: string, enabled: boolean, limits: SiteLimits, tier: SiteTier | 'revoked', actorId: string, now: string) {
  const rows: [string, unknown][] = [['site.enabled', enabled], ...Object.entries(SITE_LIMIT_KEYS).map(([field, key]) => [key, limits[field as keyof SiteLimits]] as [string, unknown])];
  for (const [key, value] of rows) {
    await db
      .prepare(
        `INSERT INTO entitlement_overrides (id, subject_type, subject_id, key, value_json, expires_at, reason, created_by, created_at)
         VALUES (?, 'channel', ?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT(subject_type, subject_id, key) DO UPDATE SET value_json = excluded.value_json, reason = excluded.reason, created_by = excluded.created_by, created_at = excluded.created_at`,
      )
      .bind(crypto.randomUUID(), channelId, key, JSON.stringify(value), `addon:${tier}`, actorId, now)
      .run();
  }
}

/** The theme a new site starts on: the platform's current theme, pinned (a package not yet renderable on sites → Fawanees). */
async function startingThemeRef(db: Db): Promise<string> {
  const state = await readSiteTheme(db as never);
  return (!state.version && currentThemeRef(state.theme)) || (currentThemeRef('fawanees') as string);
}

interface ChannelSummary { id: string; name: string; handle: string | null; avatarUrl: string | null; userId: string | null }
async function channelSummary(env: AdminBindings, channelId: string): Promise<ChannelSummary | null> {
  const object = await (env as unknown as { channels?: R2Bucket }).channels?.get(channelId);
  if (!object) return null;
  const ch = (await object.json()) as { id: string; name?: string; handle?: string; avatarUrl?: string; userId?: string; isDeleted?: boolean };
  return { id: ch.id, name: ch.name ?? '', handle: ch.handle ?? null, avatarUrl: ch.avatarUrl ?? null, userId: ch.userId ?? null };
}

function parseLimits(input: unknown, tier: SiteTier): SiteLimits {
  if (input === undefined || input === null) return SITE_TIER_SEEDS[tier].limits;
  return { ...SITE_TIER_SEEDS[tier].limits, ...(input as Partial<SiteLimits>) };
}

const body = async (c: C) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

app.get('/', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100);
  const { results = [] } = await (c.env.REPORTS_DB as unknown as Db)
    .prepare("SELECT subject_id, value_json, reason, created_by, created_at FROM entitlement_overrides WHERE key = 'site.enabled' AND subject_type = 'channel' ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all<{ subject_id: string; value_json: string; reason: string; created_by: string; created_at: string }>();
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const sites = await Promise.all(
    results.map(async (row) => {
      const [channel, site] = await Promise.all([
        channelSummary(c.env, row.subject_id),
        callSites<{ site: SiteSettings }>(c.env, 'GET', `/${row.subject_id}`, actorOf(c)).then((r) => r.site, () => null),
      ]);
      return { channelId: row.subject_id, enabled: row.value_json === 'true', grantedBy: row.created_by, changedAt: row.created_at, channel, site };
    }),
  );
  const filtered = q ? sites.filter((s) => [s.channel?.name, s.channel?.handle, s.site?.slug, ...(s.site?.hosts.map((h) => h.host) ?? [])].some((v) => v?.toLowerCase().includes(q))) : sites;
  return c.json({ success: true, result: { sites: filtered } });
});

app.get('/slug/:slug', async (c) => {
  const slug = (c.req.param('slug') ?? '').toLowerCase();
  const channelId = c.req.query('channelId');
  const result = await callSites<{ available: boolean; reason: string | null; host: string }>(c.env, 'GET', `/slug/${encodeURIComponent(slug)}${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`, actorOf(c));
  return c.json({ success: true, result });
});

app.get('/:channelId', async (c) => {
  const channelId = channelIdOf(c);
  const [channel, site, history] = await Promise.all([
    channelSummary(c.env, channelId),
    callSites<{ site: SiteSettings }>(c.env, 'GET', `/${channelId}`, actorOf(c)).then((r) => r.site, (e) => (e instanceof HttpError && e.status === 404 ? null : Promise.reject(e))),
    readAudit(c.env.REPORTS_DB as never, { kind: 'site', id: channelId, limit: 50 }),
  ]);
  if (!channel && !site) throw new HttpError(404, 'not_found', 'No such channel');
  return c.json({ success: true, result: { channel, site, history } });
});

app.post('/:channelId', async (c) => {
  needManage(c);
  const channelId = channelIdOf(c);
  const b = await body(c);
  const tier = b.tier as SiteTier;
  if (!SITE_TIERS.includes(tier)) throw new HttpError(400, 'tier_invalid', 'Choose White-label or White-label + domain');
  const limits = parseLimits(b.limits, tier);
  const db = c.env.REPORTS_DB as unknown as Db;
  const { site } = await callSites<{ site: SiteSettings }>(c.env, 'POST', `/${channelId}`, actorOf(c), {
    slug: b.slug,
    tier,
    limits,
    themeRef: await startingThemeRef(db),
    locales: b.locales,
  });
  const now = new Date().toISOString();
  await writeSiteEntitlements(db, channelId, true, site.limits, tier, actorOf(c), now);
  await writeAudit(db as never, { kind: 'site', id: channelId, action: 'site-grant', actorId: actorOf(c), details: { tier, slug: site.slug, host: site.hosts[0]?.host, limits: site.limits, themeRef: site.themeRef } }, now);
  logger.info('[Sites] Granted', { channelId, tier, slug: site.slug, actorId: actorOf(c) });
  return c.json({ success: true, result: { site } }, 201);
});

app.patch('/:channelId', async (c) => {
  needManage(c);
  const channelId = channelIdOf(c);
  const b = await body(c);
  const patch: Record<string, unknown> = {};
  for (const k of ['status', 'tier', 'slug'] as const) if (b[k] !== undefined) patch[k] = b[k];
  if (b.limits !== undefined) patch.limits = b.limits;
  if (!Object.keys(patch).length) throw new HttpError(400, 'bad_request', 'Nothing to change');
  const { before, site } = await callSites<{ before: SiteSettings; site: SiteSettings }>(c.env, 'PATCH', `/${channelId}`, actorOf(c), patch);
  const db = c.env.REPORTS_DB as unknown as Db;
  const now = new Date().toISOString();
  if (patch.limits !== undefined || patch.tier !== undefined) await writeSiteEntitlements(db, channelId, true, site.limits, site.tier, actorOf(c), now);
  const changed = Object.fromEntries(Object.keys(patch).map((k) => [k, site[k as keyof SiteSettings]]));
  const previous = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof SiteSettings]]));
  await writeAudit(db as never, { kind: 'site', id: channelId, action: patch.slug !== undefined && patch.slug !== before.slug ? 'site-rename' : patch.status !== undefined ? `site-${site.status}` : 'site-limits', actorId: actorOf(c), details: changed, previous }, now);
  return c.json({ success: true, result: { site } });
});

app.delete('/:channelId', async (c) => {
  needManage(c);
  const channelId = channelIdOf(c);
  const { site } = await callSites<{ site: SiteSettings }>(c.env, 'DELETE', `/${channelId}`, actorOf(c));
  const db = c.env.REPORTS_DB as unknown as Db;
  const now = new Date().toISOString();
  await writeSiteEntitlements(db, channelId, false, site.limits, 'revoked', actorOf(c), now);
  await writeAudit(db as never, { kind: 'site', id: channelId, action: 'site-revoke', actorId: actorOf(c), details: { slug: site.slug } }, now);
  return c.json({ success: true, result: { site } });
});

app.post('/:channelId/restore', async (c) => {
  needManage(c);
  const channelId = channelIdOf(c);
  const { site } = await callSites<{ site: SiteSettings }>(c.env, 'POST', `/${channelId}/restore`, actorOf(c));
  const db = c.env.REPORTS_DB as unknown as Db;
  const now = new Date().toISOString();
  await writeSiteEntitlements(db, channelId, true, site.limits, site.tier, actorOf(c), now);
  await writeAudit(db as never, { kind: 'site', id: channelId, action: 'site-restore', actorId: actorOf(c), details: { status: site.status } }, now);
  return c.json({ success: true, result: { site } });
});

export default app;
