/**
 * Own domains of white-label sites (wiki AUN-SCHOLAR-SITES §4.2, #1212). The same routes twice:
 *
 *   Staff (admin-web Scholar sites; authMiddleware + adminMiddleware, creators:manage to change):
 *     /api/sites/:channelId/domains…
 *   Studio → Site → Domains (the videos site's server; X-API-Key plus the signed-in user's Bearer
 *   token; the user must hold channel.edit on the channel, checked by api-videos):
 *     /internal/site-domains/:channelId/domains…
 *
 *   GET    …/:channelId/domains                 → { domains, hosts, primaryHost, limit }
 *   POST   …/:channelId/domains                 { host } → 201 { domain }
 *   POST   …/:channelId/domains/:host/refresh   → { domain }
 *   DELETE …/:channelId/domains/:host           → { hosts }
 *   PUT    …/:channelId/primary                 { host } → { hosts }
 *
 * Errors: { success: false, code }. `saas_unavailable` (503) while Cloudflare for SaaS is not
 * enabled on the zone; the screens show a friendly "not available yet" for it.
 */
import { Hono, type Context } from 'hono';
import { hasContentPermission, type SiteSettings } from '@al-ummah/shared-types';
import { writeAudit } from '../lib/content/audit';
import { logger } from '../lib/logger';
import { SaasError } from '../lib/sites/saas';
import { addDomain, findDomain, readSite, refreshDomain, removeDomain, setPrimary, type DomainsEnv } from '../lib/sites/domains';
import { verifyAccessToken } from '../middleware/auth';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & DomainsEnv; Variables: { auth?: AuthContext; domainActor?: string } };
type C = Context<Env>;

const CHANNEL_ID = /^[A-Za-z0-9_-]{1,80}$/;

function errorReply(c: C, error: unknown) {
  if (error instanceof SaasError) {
    const status = error.code === 'cloudflare_refused' ? 422 : 503;
    const code = error.code === 'not_configured' ? 'saas_unavailable' : error.code;
    if (error.code !== 'saas_unavailable') logger.warn('[SiteDomains] Cloudflare', { code: error.code, detail: error.detail });
    return c.json({ success: false, code }, status);
  }
  const e = error as { status?: number; code?: string };
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500 && typeof e.code === 'string') return c.json({ success: false, code: e.code }, e.status as 400);
  logger.error('[SiteDomains] failed', { path: c.req.path, error: String(error) });
  return c.json({ success: false, code: 'internal_error' }, 500);
}

const view = (site: SiteSettings) => ({
  domains: site.domains ?? [],
  hosts: site.hosts,
  primaryHost: site.hosts.find((h) => h.primary)?.host ?? null,
  limit: site.limits.customDomainsMax,
});

/**
 * Registers the domain routes on `app` under `prefix`. `guard` answers the actor id, or a Response
 * when the caller may not (read = only looking; write = changing).
 */
function register(app: Hono<Env>, prefix: string, guard: (c: C, write: boolean) => Promise<string | Response>) {
  const channelOf = (c: C) => {
    const id = c.req.param('channelId') ?? '';
    return CHANNEL_ID.test(id) ? id : null;
  };
  const audit = (c: C, channelId: string, actor: string, action: string, details: Record<string, unknown>) =>
    writeAudit(c.env.REPORTS_DB as never, { kind: 'site', id: channelId, action, actorId: actor, details }).catch((error) => logger.warn('[SiteDomains] audit failed', { channelId, error: String(error) }));

  app.get(`${prefix}/:channelId/domains`, async (c) => {
    const channelId = channelOf(c);
    if (!channelId) return c.json({ success: false, code: 'bad_request' }, 400);
    const actor = await guard(c, false);
    if (actor instanceof Response) return actor;
    try {
      return c.json({ success: true, result: view(await readSite(c.env, channelId)) }, 200, { 'Cache-Control': 'private, no-store' });
    } catch (error) {
      return errorReply(c, error);
    }
  });

  app.post(`${prefix}/:channelId/domains`, async (c) => {
    const channelId = channelOf(c);
    const body = (await c.req.json().catch(() => null)) as { host?: unknown } | null;
    if (!channelId || typeof body?.host !== 'string') return c.json({ success: false, code: 'bad_request' }, 400);
    const actor = await guard(c, true);
    if (actor instanceof Response) return actor;
    try {
      const { domain } = await addDomain(c.env, channelId, body.host, actor);
      await audit(c, channelId, actor, 'site-domain-add', { host: domain.host, status: domain.status });
      return c.json({ success: true, result: { domain } }, 201);
    } catch (error) {
      return errorReply(c, error);
    }
  });

  app.post(`${prefix}/:channelId/domains/:host/refresh`, async (c) => {
    const channelId = channelOf(c);
    if (!channelId) return c.json({ success: false, code: 'bad_request' }, 400);
    const actor = await guard(c, true);
    if (actor instanceof Response) return actor;
    try {
      const domain = findDomain(await readSite(c.env, channelId), c.req.param('host') ?? '');
      if (!domain) return c.json({ success: false, code: 'domain_not_found' }, 404);
      return c.json({ success: true, result: { domain: (await refreshDomain(c.env, channelId, domain, actor)).domain } });
    } catch (error) {
      return errorReply(c, error);
    }
  });

  app.delete(`${prefix}/:channelId/domains/:host`, async (c) => {
    const channelId = channelOf(c);
    if (!channelId) return c.json({ success: false, code: 'bad_request' }, 400);
    const actor = await guard(c, true);
    if (actor instanceof Response) return actor;
    try {
      const domain = findDomain(await readSite(c.env, channelId), c.req.param('host') ?? '');
      if (!domain) return c.json({ success: false, code: 'domain_not_found' }, 404);
      const site = await removeDomain(c.env, channelId, domain, actor);
      await audit(c, channelId, actor, 'site-domain-remove', { host: domain.host });
      return c.json({ success: true, result: view(site) });
    } catch (error) {
      return errorReply(c, error);
    }
  });

  app.put(`${prefix}/:channelId/primary`, async (c) => {
    const channelId = channelOf(c);
    const body = (await c.req.json().catch(() => null)) as { host?: unknown } | null;
    if (!channelId || typeof body?.host !== 'string') return c.json({ success: false, code: 'bad_request' }, 400);
    const actor = await guard(c, true);
    if (actor instanceof Response) return actor;
    try {
      const site = await setPrimary(c.env, channelId, body.host, actor);
      await audit(c, channelId, actor, 'site-primary-host', { host: body.host });
      return c.json({ success: true, result: view(site) });
    } catch (error) {
      return errorReply(c, error);
    }
  });
}

/** Staff: mounted at /api/sites (behind auth + admin middleware). */
export const staffSiteDomainsRouter = new Hono<Env>();
register(staffSiteDomainsRouter, '', async (c, write) => {
  const auth = c.get('auth');
  if (write && !hasContentPermission(auth?.roles, 'creators:manage')) return c.json({ success: false, code: 'forbidden' }, 403);
  return auth?.userId ?? 'unknown';
});

async function internalKey(env: DomainsEnv): Promise<string> {
  const b = env.INTERNAL_API_KEY;
  try {
    return typeof b === 'string' ? b : ((await b?.get()) ?? '');
  } catch {
    return '';
  }
}

function sameKey(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether api-videos says this user may edit the channel's site (channel.edit). */
async function canEdit(env: DomainsEnv, channelId: string, userId: string): Promise<boolean> {
  const key = await internalKey(env);
  const path = `/internal/sites/${channelId}/editor?userId=${encodeURIComponent(userId)}`;
  const init = { headers: { 'X-API-Key': key } };
  const res = env.VIDEOS ? await env.VIDEOS.fetch(`https://videos.internal${path}`, init) : env.VIDEOS_API_URL ? await fetch(`${env.VIDEOS_API_URL.replace(/\/$/, '')}${path}`, init) : null;
  if (!res?.ok) return false;
  return ((await res.json().catch(() => null)) as { canEdit?: boolean } | null)?.canEdit === true;
}

/** Studio: mounted at /internal/site-domains (before the admin middleware). */
export const studioSiteDomainsRouter = new Hono<Env>();
register(studioSiteDomainsRouter, '', async (c) => {
  const expected = await internalKey(c.env);
  if (!sameKey(c.req.header('X-API-Key') ?? '', expected)) return c.json({ success: false, code: 'unauthorized' }, 401);
  const authorization = c.req.header('Authorization') ?? '';
  const payload = authorization.startsWith('Bearer ') ? await verifyAccessToken(authorization.slice(7), c.env as never) : null;
  const userId = (payload as { sub?: string } | null)?.sub;
  if (!userId) return c.json({ success: false, code: 'unauthorized' }, 401);
  if (!(await canEdit(c.env, c.req.param('channelId') ?? '', userId))) return c.json({ success: false, code: 'forbidden' }, 403);
  return userId;
});
