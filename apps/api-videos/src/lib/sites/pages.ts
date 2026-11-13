/**
 * Site pages (wiki AUN-SCHOLAR-SITES §7.1 Pages, SS16): block pages a channel's owner, admins and
 * editors write in Studio. Each page is one object next to the settings (sitePageKey); the settings
 * hold the list (id, slug, title, status) so menus and routing need no extra read, and the plan's
 * `site.pages.max` caps how many. Every save keeps the previous version (last 10, restorable).
 * Saves are ETag-guarded like the settings.
 */
import {
	SITE_LOCALES,
	SITE_PAGE_ID,
	SITE_PAGE_REVISIONS,
	sitePageKey,
	validateSitePageUpdate,
	type SiteLocale,
	type SitePage,
	type SitePageSummary,
	type SitePageUpdate,
	type SiteSettings,
} from '@al-ummah/shared-types';
import { SiteError, readSettings, writeSettings, type SitesEnv } from './store';

export function newPageId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return `pg_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const summaryOf = (p: SitePage): SitePageSummary => ({ id: p.id, slug: p.slug, title: p.title, status: p.status, updatedAt: p.updatedAt });

function trimText(value: unknown): Partial<Record<SiteLocale, string>> {
	const out: Partial<Record<SiteLocale, string>> = {};
	if (!value || typeof value !== 'object') return out;
	for (const l of SITE_LOCALES) {
		const v = (value as Record<string, unknown>)[l];
		if (typeof v === 'string' && v.trim()) out[l] = v.trim();
	}
	return out;
}

async function liveSite(env: SitesEnv, channelId: string): Promise<{ settings: SiteSettings; etag: string }> {
	const current = await readSettings(env, channelId);
	if (!current || current.settings.status === 'revoked') throw new SiteError(404, 'site_not_found');
	return current;
}

export async function readPage(env: SitesEnv, channelId: string, pageId: string): Promise<{ page: SitePage; etag: string } | null> {
	if (!SITE_PAGE_ID.test(pageId)) return null;
	const object = await env.channel_sections.get(sitePageKey(channelId, pageId));
	if (!object) return null;
	return { page: await object.json<SitePage>(), etag: object.etag };
}

async function writePage(env: SitesEnv, channelId: string, page: SitePage, etag: string | null): Promise<string> {
	const result = await env.channel_sections.put(sitePageKey(channelId, page.id), JSON.stringify(page), {
		onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
		httpMetadata: { contentType: 'application/json' },
	});
	if (!result) throw new SiteError(412, 'changed_elsewhere');
	return result.etag;
}

/** Writes the page list into the settings (retried once if the settings changed meanwhile). */
async function syncSummary(env: SitesEnv, channelId: string, change: (pages: SitePageSummary[], s: SiteSettings) => SitePageSummary[], actor: string, now: Date): Promise<SiteSettings> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await liveSite(env, channelId);
		const s = current.settings;
		const pages = change([...(s.pages ?? [])], s);
		const removed = new Set((s.pages ?? []).map((p) => p.id).filter((id) => !pages.some((p) => p.id === id)));
		const next: SiteSettings = {
			...s,
			pages,
			// A deleted page leaves the menu and the home
			navigation: s.navigation.filter((n) => n.kind !== 'page' || !removed.has(n.pageId ?? '')),
			home: s.home?.pageId && removed.has(s.home.pageId) ? { pageId: null } : s.home,
			configVersion: s.configVersion + 1,
			updatedAt: now.toISOString(),
			updatedBy: actor,
		};
		try {
			await writeSettings(env, next, current.etag);
			return next;
		} catch (error) {
			if (!(error instanceof SiteError && error.status === 412) || attempt === 2) throw error;
		}
	}
	throw new SiteError(412, 'changed_elsewhere');
}

export async function listPages(env: SitesEnv, channelId: string): Promise<SitePageSummary[]> {
	return (await liveSite(env, channelId)).settings.pages ?? [];
}

export async function createPage(env: SitesEnv, channelId: string, input: SitePageUpdate, actor: string, now = new Date()): Promise<{ page: SitePage; etag: string }> {
	const { settings } = await liveSite(env, channelId);
	const pages = settings.pages ?? [];
	if (pages.length >= settings.limits.pagesMax) throw new SiteError(403, 'pages_limit');
	const update: SitePageUpdate = { slug: String(input.slug ?? '').trim().toLowerCase(), title: trimText(input.title), description: trimText(input.description), blocks: input.blocks ?? {}, status: 'draft' };
	const problem = validateSitePageUpdate(update);
	if (problem) throw new SiteError(400, problem);
	if (!update.title?.en && !update.title?.ar) throw new SiteError(400, 'title_invalid');
	if (pages.some((p) => p.slug === update.slug)) throw new SiteError(409, 'slug_taken');
	const at = now.toISOString();
	const page: SitePage = { id: newPageId(), slug: update.slug!, title: update.title!, description: update.description!, blocks: update.blocks!, status: 'draft', createdAt: at, updatedAt: at, updatedBy: actor, revisions: [] };
	const etag = await writePage(env, channelId, page, null);
	try {
		await syncSummary(env, channelId, (list, s) => {
			if (list.length >= s.limits.pagesMax) throw new SiteError(403, 'pages_limit');
			if (list.some((p) => p.slug === page.slug)) throw new SiteError(409, 'slug_taken');
			return [...list, summaryOf(page)];
		}, actor, now);
	} catch (error) {
		await env.channel_sections.delete(sitePageKey(channelId, page.id));
		throw error;
	}
	return { page, etag };
}

export async function updatePage(env: SitesEnv, channelId: string, pageId: string, input: SitePageUpdate, actor: string, etag: string | null, now = new Date()): Promise<{ page: SitePage; etag: string }> {
	const current = await readPage(env, channelId, pageId);
	if (!current) throw new SiteError(404, 'page_not_found');
	if (etag && etag !== current.etag) throw new SiteError(412, 'changed_elsewhere');
	const update: SitePageUpdate = {
		...(input.slug !== undefined ? { slug: String(input.slug).trim().toLowerCase() } : {}),
		...(input.title !== undefined ? { title: trimText(input.title) } : {}),
		...(input.description !== undefined ? { description: trimText(input.description) } : {}),
		...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
		...(input.status !== undefined ? { status: input.status } : {}),
	};
	const problem = validateSitePageUpdate(update);
	if (problem) throw new SiteError(400, problem);
	const before = current.page;
	if (update.title && !update.title.en && !update.title.ar) throw new SiteError(400, 'title_invalid');
	const { settings } = await liveSite(env, channelId);
	if (update.slug && update.slug !== before.slug && (settings.pages ?? []).some((p) => p.id !== pageId && p.slug === update.slug)) throw new SiteError(409, 'slug_taken');
	const revision = { savedAt: before.updatedAt, savedBy: before.updatedBy, title: before.title, description: before.description, blocks: before.blocks };
	const page: SitePage = {
		...before,
		...update,
		updatedAt: now.toISOString(),
		updatedBy: actor,
		revisions: [revision, ...(before.revisions ?? [])].slice(0, SITE_PAGE_REVISIONS),
	} as SitePage;
	const newEtag = await writePage(env, channelId, page, current.etag);
	await syncSummary(env, channelId, (list) => list.map((p) => (p.id === pageId ? summaryOf(page) : p)), actor, now);
	return { page, etag: newEtag };
}

/** Puts back a saved version's title, description and blocks (the current one becomes a revision). */
export async function restorePageRevision(env: SitesEnv, channelId: string, pageId: string, index: number, actor: string, now = new Date()): Promise<{ page: SitePage; etag: string }> {
	const current = await readPage(env, channelId, pageId);
	if (!current) throw new SiteError(404, 'page_not_found');
	const rev = current.page.revisions?.[index];
	if (!rev) throw new SiteError(404, 'revision_not_found');
	return updatePage(env, channelId, pageId, { title: rev.title, description: rev.description, blocks: rev.blocks }, actor, current.etag, now);
}

export async function deletePage(env: SitesEnv, channelId: string, pageId: string, actor: string, now = new Date()): Promise<SiteSettings> {
	const current = await readPage(env, channelId, pageId);
	if (!current) throw new SiteError(404, 'page_not_found');
	const settings = await syncSummary(env, channelId, (list) => list.filter((p) => p.id !== pageId), actor, now);
	await env.channel_sections.delete(sitePageKey(channelId, pageId));
	return settings;
}

/** A page for the sites Worker by slug: published only, unless `withDrafts` (a valid preview). */
export async function publicPage(env: SitesEnv, settings: SiteSettings, slug: string, withDrafts: boolean): Promise<SitePage | null> {
	const summary = (settings.pages ?? []).find((p) => p.slug === slug && (withDrafts || p.status === 'published'));
	if (!summary) return null;
	const found = await readPage(env, settings.channelId, summary.id);
	if (!found || (!withDrafts && found.page.status !== 'published')) return null;
	const { revisions: _revisions, updatedBy: _by, ...page } = found.page;
	return page as SitePage;
}

/** The home page's blocks (a published page, or a draft in a preview). */
export async function publicPageById(env: SitesEnv, settings: SiteSettings, pageId: string | null | undefined, withDrafts: boolean): Promise<SitePage | null> {
	const summary = (settings.pages ?? []).find((p) => p.id === pageId);
	return summary ? publicPage(env, settings, summary.slug, withDrafts) : null;
}
