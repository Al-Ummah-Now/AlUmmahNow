/**
 * Site pages, home, SEO and redirects (SS16, lib/sites/pages.ts): create within the plan's limit,
 * unique slugs, validated blocks, ETag-guarded saves with revisions and restore, drafts only in a
 * preview, delete cleans the menu and the home; settings take SEO and redirects. In-memory R2.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { siteRedirectFor, sitePageTitle, validateSitePageUpdate, validateSiteSettingsUpdate, SITE_TIER_SEEDS } from '@al-ummah/shared-types';
import { adminUpdateSite, grantSite, updateSiteSettings } from '../src/lib/sites/service';
import { createPage, deletePage, publicPage, readPage, restorePageRevision, updatePage } from '../src/lib/sites/pages';
import { readSettings } from '../src/lib/sites/store';
import { sitesRouter } from '../src/routers/sites.router';
import { MemoryBucket } from './helpers';

const CH = 'ch_scholar';
function env() {
	return {
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		channels: new MemoryBucket({
			[CH]: {
				id: CH,
				name: 'Scholar',
				handle: 'scholar',
				userId: 'usr_owner',
				members: [
					{ userId: 'usr_editor', role: 'editor', addedBy: 'usr_owner', addedAt: '2026-11-01T00:00:00Z' },
					{ userId: 'usr_mod', role: 'moderator', addedBy: 'usr_owner', addedAt: '2026-11-01T00:00:00Z' },
				],
			},
		}),
		SITES_ENV: 'qa',
		VIDEOS_WEB_URL: 'https://videos.qa.alummahnow.net',
	} as never;
}

const blocks = { en: [{ id: 'b1', type: 'markdown', text: 'Hello' }, { id: 'b2', type: 'cta', label: 'Watch', href: '/en/videos/' }] } as never;

describe('site pages', () => {
	it('validates page saves and settings additions', () => {
		assert.equal(validateSitePageUpdate({ slug: 'about-us', title: { en: 'About' }, blocks }), null);
		assert.equal(validateSitePageUpdate({ slug: 'Bad Slug' }), 'slug_invalid');
		assert.equal(validateSitePageUpdate({ slug: 'videos' }), 'slug_reserved');
		assert.equal(validateSitePageUpdate({ blocks: { en: [{ id: 'x', type: 'script' }] } as never }), 'blocks_invalid');
		assert.equal(validateSitePageUpdate({ blocks: { en: [{ id: 'x', type: 'cta', label: 'Go', href: 'javascript:alert(1)' }] } as never }), 'blocks_invalid');
		assert.equal(validateSitePageUpdate({ blocks: { en: [{ id: 'x', type: 'image', url: 'http://insecure/x.png', alt: '' }] } as never }), 'blocks_invalid');
		assert.equal(validateSitePageUpdate({ blocks: { en: [{ id: 'a', type: 'divider' }, { id: 'a', type: 'divider' }] } as never }), 'blocks_invalid');
		const limits = SITE_TIER_SEEDS['white-label'].limits;
		assert.equal(validateSiteSettingsUpdate({ seo: { titleTemplate: '%s · Scholar', googleVerification: 'abcDEF123_-xyz' } }, limits), null);
		assert.equal(validateSiteSettingsUpdate({ seo: { titleTemplate: 'no placeholder' } }, limits), 'seo_invalid');
		assert.equal(validateSiteSettingsUpdate({ seo: { googleVerification: '<meta>' } }, limits), 'seo_invalid');
		assert.equal(validateSiteSettingsUpdate({ redirects: [{ from: '/old', to: '/en/videos/' }, { from: '/blog', to: 'https://example.com/' }] }, limits), null);
		assert.equal(validateSiteSettingsUpdate({ redirects: [{ from: '/', to: '/x' }] }, limits), 'redirects_invalid');
		assert.equal(validateSiteSettingsUpdate({ redirects: [{ from: '/a', to: 'javascript:x' }] }, limits), 'redirects_invalid');
		assert.equal(siteRedirectFor([{ from: '/old/', to: '/new' }], '/old'), '/new');
		assert.equal(siteRedirectFor([{ from: '/old', to: '/new' }], '/other'), null);
		assert.equal(sitePageTitle('About', 'Scholar', '%s | Scholar site'), 'About | Scholar site');
		assert.equal(sitePageTitle('About', 'Scholar', null), 'About · Scholar');
	});

	it('creates, saves with revisions, restores, publishes; drafts only in a preview', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'scholar-site', tier: 'white-label', actor: 'adm' });
		const { page, etag } = await createPage(e, CH, { slug: 'about-us', title: { en: 'About us' }, blocks }, 'usr_owner');
		assert.equal(page.status, 'draft');
		await assert.rejects(createPage(e, CH, { slug: 'about-us', title: { en: 'Again' } }, 'usr_owner'), /slug_taken/);
		await assert.rejects(createPage(e, CH, { slug: 'no-title', title: {} }, 'usr_owner'), /title_invalid/);
		const saved = await updatePage(e, CH, page.id, { title: { en: 'About', ar: 'نبذة' } }, 'usr_editor', etag);
		await assert.rejects(updatePage(e, CH, page.id, { title: { en: 'Stale' } }, 'usr_owner', etag), /changed_elsewhere/);
		assert.equal(saved.page.revisions?.[0].title.en, 'About us');
		const restored = await restorePageRevision(e, CH, page.id, 0, 'usr_owner');
		assert.equal(restored.page.title.en, 'About us');
		assert.equal(restored.page.revisions?.length, 2);
		const settings = (await readSettings(e, CH))!.settings;
		assert.equal(publicPage(e, settings, 'about-us', false) instanceof Promise, true);
		assert.equal(await publicPage(e, settings, 'about-us', false), null, 'a draft is not public');
		assert.equal((await publicPage(e, settings, 'about-us', true))?.title.en, 'About us');
		await updatePage(e, CH, page.id, { status: 'published' }, 'usr_owner', null);
		const live = await publicPage(e, (await readSettings(e, CH))!.settings, 'about-us', false);
		assert.equal(live?.status, 'published');
		assert.equal((live as { revisions?: unknown }).revisions, undefined, 'revisions never go public');
	});

	it('keeps to the plan limit; delete removes the page from the menu and the home', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'scholar-site', tier: 'white-label', actor: 'adm' });
		await adminUpdateSite(e, CH, { limits: { ...SITE_TIER_SEEDS['white-label'].limits, pagesMax: 1 }, actor: 'adm' });
		const { page } = await createPage(e, CH, { slug: 'one', title: { en: 'One' } }, 'usr_owner');
		await assert.rejects(createPage(e, CH, { slug: 'two', title: { en: 'Two' } }, 'usr_owner'), /pages_limit/);
		await assert.rejects(updateSiteSettings(e, CH, { navigation: [{ id: 'p', kind: 'page', pageId: 'pg_0000000000000000' }] }, 'usr_owner', null), /navigation_invalid/);
		await updateSiteSettings(e, CH, { navigation: [{ id: 'p', kind: 'page', pageId: page.id }], home: { pageId: page.id }, seo: { titleTemplate: '%s · S' }, redirects: [{ from: '/old', to: '/one/' }] }, 'usr_owner', null);
		const after = await deletePage(e, CH, page.id, 'usr_owner');
		assert.deepEqual(after.navigation, []);
		assert.deepEqual(after.home, { pageId: null });
		assert.equal(after.seo?.titleTemplate, '%s · S');
		assert.equal(await readPage(e, CH, page.id), null);
	});

	it('routes: editors write pages, moderators may not; the sites Worker reads published pages by host', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'scholar-site', tier: 'white-label', actor: 'adm' });
		await adminUpdateSite(e, CH, { status: 'live', actor: 'adm' });
		const as = (userId: string) => {
			const call = (method: string, path: string, body?: unknown) =>
				sitesRouter.request(path, { method, headers: { 'content-type': 'application/json', 'x-user': userId }, body: body ? JSON.stringify(body) : undefined }, e);
			return call;
		};
		// The router reads the user from the context: give it one through a tiny wrapper app
		const { Hono } = await import('hono');
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('userId' as never, (c.req.header('x-user') || undefined) as never);
			await next();
		});
		app.route('/', sitesRouter as never);
		const req = (userId: string, method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json', 'x-user': userId }, body: body ? JSON.stringify(body) : undefined }, e);
		void as;
		const created = await req('usr_editor', 'POST', `/channel/${CH}/pages`, { slug: 'hello', title: { en: 'Hello' }, blocks });
		assert.equal(created.status, 201);
		const { page } = (await created.json()) as { page: { id: string } };
		assert.equal((await req('usr_mod', 'GET', `/channel/${CH}/pages`)).status, 403);
		assert.equal((await req('usr_editor', 'GET', `/by-host/scholar-site.qa.alummahnow.org/pages/hello`)).status, 404, 'draft');
		assert.equal((await req('usr_editor', 'PUT', `/channel/${CH}/pages/${page.id}`, { status: 'published' })).status, 200);
		const pub = await req('', 'GET', `/by-host/scholar-site.qa.alummahnow.org/pages/hello`);
		assert.equal(pub.status, 200);
		assert.equal(((await pub.json()) as { page: { title: { en: string } } }).page.title.en, 'Hello');
		const home = await req('', 'GET', `/by-host/scholar-site.qa.alummahnow.org/home`);
		assert.deepEqual(await home.json(), { page: null });
		assert.equal((await req('usr_editor', 'DELETE', `/channel/${CH}/pages/${page.id}`)).status, 200);
	});
});
