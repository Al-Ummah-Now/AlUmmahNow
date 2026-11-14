/**
 * White-label scholar sites (wiki AUN-SCHOLAR-SITES, phase 2).
 *
 * Internal (behind the INTERNAL_API_KEY check of /internal/*; admin-api records the add-on and audit):
 *   GET    /internal/sites/slug/:slug?channelId=   → { available, reason, host }
 *   GET    /internal/sites/:channelId              → { site }
 *   POST   /internal/sites/:channelId              { slug, tier, limits?, themeRef?, locales? } → 201 { site }
 *   PATCH  /internal/sites/:channelId              { status?, tier?, limits?, slug? } → { before, site }
 *   DELETE /internal/sites/:channelId              → { site }   (revoke; restorable for 30 days)
 *   POST   /internal/sites/:channelId/restore      → { site }
 *   GET    /internal/sites/:channelId/editor?userId= → { canEdit }   (channel.edit, for admin-api's Studio domain calls)
 *   POST   /internal/sites/:channelId/domains       { host } → 201 { site, domain }   (reserve: checks, host index)
 *   PATCH  /internal/sites/:channelId/domains/:host { cfId?, status?, records?, error? } → { site, domain }
 *   DELETE /internal/sites/:channelId/domains/:host → { site, removed }
 *   PUT    /internal/sites/:channelId/primary       { host } → { site }
 *   The acting admin (or Studio user) is X-Admin-Actor.
 *
 * Public, for the sites Worker:
 *   GET /api/sites/by-host/:host[?preview=<token>]  → PublicSite | 301-style { redirectTo } | 404
 * Public, for the platform's canonicals (videos web, www; §4.4, #1215):
 *   GET /api/sites/by-channel/:channelId            → PublicSiteLink | 404 (no live site)
 *
 * Studio (signed in; the channel's owner and admins, `channel.edit`, SS2):
 *   GET  /api/sites/channel/:channelId          → { site, etag, themes }   (404 when the channel has no site)
 *   PUT  /api/sites/channel/:channelId          SiteSettingsUpdate, If-Match: <etag> → { site, etag }
 *   POST /api/sites/channel/:channelId/preview  SiteSettingsUpdate → { token, expiresAt, url }
 *
 * Site pages (§7.1 Pages; the owner, admins and editors: `post.manage` or `channel.edit`):
 *   GET    /api/sites/channel/:channelId/pages                       → { pages, limit }
 *   POST   /api/sites/channel/:channelId/pages                       { slug, title, description?, blocks? } → 201 { page, etag }
 *   GET    /api/sites/channel/:channelId/pages/:pageId               → { page, etag }
 *   PUT    /api/sites/channel/:channelId/pages/:pageId               SitePageUpdate, If-Match → { page, etag }
 *   POST   /api/sites/channel/:channelId/pages/:pageId/restore       { index } → { page, etag }
 *   DELETE /api/sites/channel/:channelId/pages/:pageId               → { pages }
 * For the sites Worker:
 *   GET /api/sites/by-host/:host/pages/:slug[?preview=]  → { page } | 404   (drafts only in a preview)
 *   GET /api/sites/by-host/:host/home[?preview=]         → { page | null }
 */
import { Hono, type Context } from 'hono';
import { SITE_THEME_CHOICES, can, primarySiteHost, type SiteSettingsUpdate } from '@al-ummah/shared-types';
import { logger } from '../lib/logger';
import { rethrowBusy } from '../lib/r2Repo';
import { roleOnChannel } from '../lib/channelAccess';
import { CHANNEL_ID, SiteError, readSettings, siteEnvironment, writePreview, type SitesEnv } from '../lib/sites/store';
import { publicSiteLink } from '../lib/sites/canonical';
import { removeDomain, reserveDomain, setPrimaryHost, updateDomain } from '../lib/sites/domains';
import { createPage, deletePage, listPages, publicPage, publicPageById, readPage, restorePageRevision, updatePage } from '../lib/sites/pages';
import { adminUpdateSite, grantSite, pickUpdate, publicSiteForHost, restoreSite, revokeSite, slugAvailability, updateSiteSettings } from '../lib/sites/service';

type Env = { Bindings: SitesEnv & { VIDEOS_WEB_URL?: string }; Variables: { userId?: string } };

function fail(c: Context<Env>, error: unknown) {
	if (error instanceof SiteError) return c.json({ error: error.code }, error.status);
	rethrowBusy(error);
	logger.error('[Sites] failed', { path: c.req.path, method: c.req.method, error });
	return c.json({ error: 'internal_error' }, 500);
}

const actorOf = (c: Context<Env>) => c.req.header('X-Admin-Actor')?.slice(0, 128) || 'admin';

// ---------------------------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------------------------
export const sitesInternalRouter = new Hono<Env>();

sitesInternalRouter.get('/slug/:slug', async (c) => {
	try {
		const channelId = c.req.query('channelId') || undefined;
		return c.json(await slugAvailability(c.env, c.req.param('slug').toLowerCase(), channelId));
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.get('/:channelId', async (c) => {
	try {
		const current = await readSettings(c.env, c.req.param('channelId'));
		if (!current) return c.json({ error: 'site_not_found' }, 404);
		return c.json({ site: current.settings });
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.post('/:channelId', async (c) => {
	try {
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) return c.json({ error: 'bad_request' }, 400);
		const site = await grantSite(c.env, c.req.param('channelId'), {
			slug: String(body.slug ?? '').toLowerCase(),
			tier: body.tier as never,
			limits: body.limits as never,
			themeRef: typeof body.themeRef === 'string' ? body.themeRef : undefined,
			locales: Array.isArray(body.locales) ? (body.locales as never) : undefined,
			actor: actorOf(c),
		});
		logger.info('[Sites] granted', { channelId: site.channelId, slug: site.slug, tier: site.tier });
		return c.json({ site }, 201);
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.patch('/:channelId', async (c) => {
	try {
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) return c.json({ error: 'bad_request' }, 400);
		const { before, after } = await adminUpdateSite(c.env, c.req.param('channelId'), {
			status: body.status as never,
			tier: body.tier as never,
			limits: body.limits as never,
			slug: typeof body.slug === 'string' ? body.slug.toLowerCase() : undefined,
			actor: actorOf(c),
		});
		return c.json({ before, site: after });
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.delete('/:channelId', async (c) => {
	try {
		return c.json({ site: await revokeSite(c.env, c.req.param('channelId'), actorOf(c)) });
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.get('/:channelId/editor', async (c) => {
	try {
		const channelId = c.req.param('channelId');
		const userId = c.req.query('userId') ?? '';
		if (!CHANNEL_ID.test(channelId) || !userId) return c.json({ canEdit: false });
		return c.json({ canEdit: can(await roleOnChannel(c.env as never, channelId, userId), 'channel.edit') });
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.post('/:channelId/domains', async (c) => {
	try {
		const body = (await c.req.json().catch(() => null)) as { host?: unknown } | null;
		if (!body || typeof body.host !== 'string') return c.json({ error: 'bad_request' }, 400);
		return c.json(await reserveDomain(c.env, c.req.param('channelId'), body.host, actorOf(c)), 201);
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.patch('/:channelId/domains/:host', async (c) => {
	try {
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) return c.json({ error: 'bad_request' }, 400);
		return c.json(await updateDomain(c.env, c.req.param('channelId'), c.req.param('host'), body as never, actorOf(c)));
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.delete('/:channelId/domains/:host', async (c) => {
	try {
		return c.json(await removeDomain(c.env, c.req.param('channelId'), c.req.param('host'), actorOf(c)));
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.put('/:channelId/primary', async (c) => {
	try {
		const body = (await c.req.json().catch(() => null)) as { host?: unknown } | null;
		if (!body || typeof body.host !== 'string') return c.json({ error: 'bad_request' }, 400);
		return c.json({ site: await setPrimaryHost(c.env, c.req.param('channelId'), body.host, actorOf(c)) });
	} catch (error) {
		return fail(c, error);
	}
});

sitesInternalRouter.post('/:channelId/restore', async (c) => {
	try {
		return c.json({ site: await restoreSite(c.env, c.req.param('channelId'), actorOf(c)) });
	} catch (error) {
		return fail(c, error);
	}
});

// ---------------------------------------------------------------------------------------------
// Public + Studio
// ---------------------------------------------------------------------------------------------
export const sitesRouter = new Hono<Env>();

sitesRouter.get('/by-channel/:channelId', async (c) => {
	try {
		const link = await publicSiteLink(c.env, c.req.param('channelId'));
		// Cached like a page: a site going live or offline reaches the canonicals within one cache cycle (§4.4)
		c.header('Cache-Control', 'public, max-age=300');
		if (!link) return c.json({ error: 'site_not_found' }, 404);
		return c.json(link);
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.get('/by-host/:host', async (c) => {
	try {
		const preview = c.req.query('preview') || null;
		const found = await publicSiteForHost(c.env, c.req.param('host'), preview);
		if (found.kind === 'not_found') {
			c.header('Cache-Control', 'no-store');
			return c.json({ error: 'site_not_found' }, 404);
		}
		if (found.kind === 'redirect') {
			c.header('Cache-Control', 'public, max-age=60');
			return c.json({ redirectTo: found.location });
		}
		c.header('Cache-Control', found.site.preview ? 'no-store' : 'public, max-age=60');
		return c.json(found.site);
	} catch (error) {
		return fail(c, error);
	}
});

/** The page for a host (published, or drafts in a valid preview); the same host rules as by-host. */
async function pageForHost(c: Context<Env>, which: { slug?: string; home?: true }) {
	const preview = c.req.query('preview') || null;
	const found = await publicSiteForHost(c.env, c.req.param('host'), preview);
	if (found.kind !== 'site') return { status: 404 as const, page: null };
	const current = await readSettings(c.env, found.site.site.channelId);
	if (!current) return { status: 404 as const, page: null };
	const drafts = found.site.preview;
	const page = which.home ? await publicPageById(c.env, current.settings, current.settings.home?.pageId, drafts) : await publicPage(c.env, current.settings, which.slug ?? '', drafts);
	return { status: 200 as const, page, preview: drafts };
}

sitesRouter.get('/by-host/:host/pages/:slug', async (c) => {
	try {
		const r = await pageForHost(c, { slug: c.req.param('slug').toLowerCase() });
		if (!r.page) {
			c.header('Cache-Control', 'no-store');
			return c.json({ error: 'page_not_found' }, 404);
		}
		c.header('Cache-Control', r.preview ? 'no-store' : 'public, max-age=60');
		return c.json({ page: r.page });
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.get('/by-host/:host/home', async (c) => {
	try {
		const r = await pageForHost(c, { home: true });
		if (r.status === 404 && !r.page) {
			c.header('Cache-Control', 'no-store');
			return c.json({ page: null });
		}
		c.header('Cache-Control', r.preview ? 'no-store' : 'public, max-age=60');
		return c.json({ page: r.page });
	} catch (error) {
		return fail(c, error);
	}
});

async function requireSiteEditor(c: Context<Env>, channelId: string): Promise<Response | null> {
	const userId = c.get('userId');
	if (!userId) return c.json({ error: 'unauthorized' }, 401);
	if (!CHANNEL_ID.test(channelId)) return c.json({ error: 'site_not_found' }, 404);
	const role = await roleOnChannel(c.env as never, channelId, userId);
	if (!can(role, 'channel.edit')) return c.json({ error: 'forbidden' }, 403);
	return null;
}

sitesRouter.get('/channel/:channelId', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requireSiteEditor(c, channelId);
	if (denied) return denied;
	try {
		const current = await readSettings(c.env, channelId);
		if (!current || current.settings.status === 'revoked') return c.json({ error: 'site_not_found' }, 404);
		c.header('Cache-Control', 'private, no-store');
		const env = siteEnvironment(c.env);
		return c.json({
			site: current.settings,
			etag: current.etag,
			primaryHost: primarySiteHost(current.settings, env).host,
			themes: SITE_THEME_CHOICES.map((t) => ({ ...t, ref: `${t.id}@${t.version}` })),
		});
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.put('/channel/:channelId', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requireSiteEditor(c, channelId);
	if (denied) return denied;
	try {
		const body = (await c.req.json().catch(() => null)) as SiteSettingsUpdate | null;
		if (!body) return c.json({ error: 'bad_request' }, 400);
		const ifMatch = c.req.header('If-Match')?.replace(/^W\//, '').replace(/"/g, '') || null;
		const result = await updateSiteSettings(c.env, channelId, body, c.get('userId') as string, ifMatch);
		return c.json({ site: result.settings, etag: result.etag });
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.post('/channel/:channelId/preview', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requireSiteEditor(c, channelId);
	if (denied) return denied;
	try {
		const current = await readSettings(c.env, channelId);
		if (!current || current.settings.status === 'revoked') return c.json({ error: 'site_not_found' }, 404);
		const body = pickUpdate((await c.req.json().catch(() => null)) as SiteSettingsUpdate | null);
		const { token, expiresAt } = await writePreview(c.env, channelId, body);
		const host = primarySiteHost(current.settings, siteEnvironment(c.env)).host;
		const scheme = siteEnvironment(c.env) === 'local' ? 'http' : 'https';
		return c.json({ token, expiresAt, url: `${scheme}://${host}/?preview=${token}` });
	} catch (error) {
		return fail(c, error);
	}
});

/** Pages: the owner, admins and editors (editors write posts and pages, SS2). */
async function requirePageWriter(c: Context<Env>, channelId: string): Promise<Response | null> {
	const userId = c.get('userId');
	if (!userId) return c.json({ error: 'unauthorized' }, 401);
	if (!CHANNEL_ID.test(channelId)) return c.json({ error: 'site_not_found' }, 404);
	const role = await roleOnChannel(c.env as never, channelId, userId);
	if (!can(role, 'post.manage') && !can(role, 'channel.edit')) return c.json({ error: 'forbidden' }, 403);
	return null;
}

const ifMatchOf = (c: Context<Env>) => c.req.header('If-Match')?.replace(/^W\//, '').replace(/"/g, '') || null;

sitesRouter.get('/channel/:channelId/pages', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requirePageWriter(c, channelId);
	if (denied) return denied;
	try {
		const current = await readSettings(c.env, channelId);
		if (!current || current.settings.status === 'revoked') return c.json({ error: 'site_not_found' }, 404);
		c.header('Cache-Control', 'private, no-store');
		return c.json({ pages: await listPages(c.env, channelId), limit: current.settings.limits.pagesMax });
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.post('/channel/:channelId/pages', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requirePageWriter(c, channelId);
	if (denied) return denied;
	try {
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) return c.json({ error: 'bad_request' }, 400);
		return c.json(await createPage(c.env, channelId, body as never, c.get('userId') as string), 201);
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.get('/channel/:channelId/pages/:pageId', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requirePageWriter(c, channelId);
	if (denied) return denied;
	try {
		const found = await readPage(c.env, channelId, c.req.param('pageId'));
		if (!found) return c.json({ error: 'page_not_found' }, 404);
		c.header('Cache-Control', 'private, no-store');
		return c.json(found);
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.put('/channel/:channelId/pages/:pageId', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requirePageWriter(c, channelId);
	if (denied) return denied;
	try {
		const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) return c.json({ error: 'bad_request' }, 400);
		return c.json(await updatePage(c.env, channelId, c.req.param('pageId'), body as never, c.get('userId') as string, ifMatchOf(c)));
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.post('/channel/:channelId/pages/:pageId/restore', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requirePageWriter(c, channelId);
	if (denied) return denied;
	try {
		const body = (await c.req.json().catch(() => null)) as { index?: unknown } | null;
		const index = Number(body?.index);
		if (!Number.isInteger(index) || index < 0) return c.json({ error: 'bad_request' }, 400);
		return c.json(await restorePageRevision(c.env, channelId, c.req.param('pageId'), index, c.get('userId') as string));
	} catch (error) {
		return fail(c, error);
	}
});

sitesRouter.delete('/channel/:channelId/pages/:pageId', async (c) => {
	const channelId = c.req.param('channelId');
	const denied = await requirePageWriter(c, channelId);
	if (denied) return denied;
	try {
		const settings = await deletePage(c.env, channelId, c.req.param('pageId'), c.get('userId') as string);
		return c.json({ pages: settings.pages ?? [] });
	} catch (error) {
		return fail(c, error);
	}
});
