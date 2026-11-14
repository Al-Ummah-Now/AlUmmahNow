/**
 * White-label scholar sites (wiki AUN-SCHOLAR-SITES phase 2): grant, hosts, rename, revoke and
 * restore, the host lookup the sites Worker reads, Studio updates and previews, over in-memory R2.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SITE_RESERVED_SLUGS, SITE_THEME_CHOICES, validateSiteSlug, suggestSiteSlug, isChoosableThemeRef, validateSiteSettingsUpdate, SITE_TIER_SEEDS } from '@al-ummah/shared-types';
import { BUILT_IN_THEMES } from '../../../packages/theme-packages/src/builtins.generated';
import { adminUpdateSite, grantSite, publicSiteForHost, restoreSite, revokeSite, slugAvailability, updateSiteSettings } from '../src/lib/sites/service';
import { sitesInternalRouter, sitesRouter } from '../src/routers/sites.router';
import { MemoryBucket } from './helpers';

const CH = 'ch_scholar';
const OWNER = 'usr_owner';
const ADMIN = 'usr_chadmin';
const EDITOR = 'usr_editor';

function env(extra: Record<string, unknown> = {}) {
	return {
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		channels: new MemoryBucket({
			[CH]: {
				id: CH,
				name: 'Mustafa Elbadry',
				nameLocalized: { ar: 'مصطفى البدري' },
				handle: 'mustafa',
				userId: OWNER,
				members: [
					{ userId: ADMIN, role: 'admin', addedBy: OWNER, addedAt: '2026-11-01T00:00:00Z' },
					{ userId: EDITOR, role: 'editor', addedBy: OWNER, addedAt: '2026-11-01T00:00:00Z' },
				],
				avatarUrl: 'https://images.example/a.png',
				description: 'About the channel',
			},
			ch_other: { id: 'ch_other', name: 'Other', userId: 'usr_x' },
		}),
		SITES_ENV: 'qa',
		VIDEOS_WEB_URL: 'https://videos.qa.alummahnow.net',
		...extra,
	} as never;
}

describe('site rules (shared-types)', () => {
	it('checks slug shape and reserved words', () => {
		assert.equal(validateSiteSlug('mustafa-elbadry'), null);
		assert.equal(validateSiteSlug('ab'), 'too_short');
		assert.equal(validateSiteSlug('a'.repeat(41)), 'too_long');
		assert.equal(validateSiteSlug('-abc'), 'invalid');
		assert.equal(validateSiteSlug('ab--cd'), 'invalid');
		assert.equal(validateSiteSlug('Abc'), 'invalid');
		for (const word of ['www', 'sites', 'stage', 'app', 'auth', 'videos', 'quran']) assert.equal(validateSiteSlug(word), 'reserved', word);
		assert.ok(SITE_RESERVED_SLUGS.size >= 35);
		assert.equal(suggestSiteSlug('  Mustafa  Elbadry! '), 'mustafa-elbadry');
		assert.equal(suggestSiteSlug('Élbadry Ömer'), 'elbadry-omer');
		assert.equal(suggestSiteSlug(`${'a'.repeat(30)} ${'b'.repeat(30)}`), 'a'.repeat(30));
	});

	it('offers exactly the built-in themes at their current versions', () => {
		assert.deepEqual(
			SITE_THEME_CHOICES.map((t) => `${t.id}@${t.version}`),
			BUILT_IN_THEMES.map((t) => `${t.id}@${t.version}`),
		);
		assert.ok(isChoosableThemeRef('fawanees@1.3.0'));
		assert.ok(!isChoosableThemeRef('fawanees'));
		assert.ok(!isChoosableThemeRef('fawanees@1.2.0'));
	});

	it('validates Studio updates against the limits', () => {
		const limits = SITE_TIER_SEEDS['white-label'].limits;
		assert.equal(validateSiteSettingsUpdate({ locales: ['ar'] }, limits), null);
		assert.equal(validateSiteSettingsUpdate({ locales: [] }, limits), 'locales_invalid');
		assert.equal(validateSiteSettingsUpdate({ locales: ['en', 'en'] }, limits), 'locales_invalid');
		const nine = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, kind: 'videos' as const }));
		assert.equal(validateSiteSettingsUpdate({ navigation: nine }, limits), 'navigation_too_long');
		assert.equal(validateSiteSettingsUpdate({ navigation: [{ id: 'x', kind: 'url', url: 'javascript:alert(1)', label: { en: 'x' } }] }, limits), 'navigation_invalid');
		assert.equal(validateSiteSettingsUpdate({ navigation: [{ id: 'x', kind: 'url', url: 'https://example.com', label: { en: 'Books' } }] }, limits), null);
		assert.equal(validateSiteSettingsUpdate({ logoUrl: 'http://insecure/x.png' }, limits), 'image_url_invalid');
		assert.equal(validateSiteSettingsUpdate({ themeRef: 'nahas@1.0.0' }, limits), null);
		assert.equal(validateSiteSettingsUpdate({ themeRef: 'custom@1.0.0' }, limits), 'theme_not_available');
	});
});

describe('grant and hosts', () => {
	it('grants in setup on <slug>.qa.alummahnow.org, pinned to a theme, and claims the host once', async () => {
		const e = env();
		const site = await grantSite(e, CH, { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'adm' });
		assert.equal(site.status, 'setup');
		assert.equal(site.themeRef, 'fawanees@1.3.0');
		assert.deepEqual(site.hosts, [{ host: 'mustafa-elbadry.qa.alummahnow.org', kind: 'subdomain', primary: true }]);
		assert.deepEqual(site.limits, SITE_TIER_SEEDS['white-label'].limits);
		assert.ok((e as any).channel_tabs.store.has('site-hosts/mustafa-elbadry.qa.alummahnow.org.json'));
		await assert.rejects(grantSite(e, CH, { slug: 'other-slug', tier: 'white-label', actor: 'adm' }), /site_exists/);
		await assert.rejects(grantSite(e, 'ch_other', { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'adm' }), /host_taken/);
		assert.deepEqual(await slugAvailability(e, 'mustafa-elbadry', 'ch_other'), { available: false, reason: 'taken', host: 'mustafa-elbadry.qa.alummahnow.org' });
		assert.equal((await slugAvailability(e, 'mustafa-elbadry', CH)).available, true);
		assert.equal((await slugAvailability(e, 'www')).reason, 'reserved');
	});

	it('refuses unknown channels, bad slugs and themes that are not offered', async () => {
		const e = env();
		await assert.rejects(grantSite(e, 'ch_missing', { slug: 'abc-def', tier: 'white-label', actor: 'a' }), /channel_not_found/);
		await assert.rejects(grantSite(e, CH, { slug: 'sites', tier: 'white-label', actor: 'a' }), /slug_reserved/);
		await assert.rejects(grantSite(e, CH, { slug: 'abc-def', tier: 'gold' as never, actor: 'a' }), /tier_invalid/);
		await assert.rejects(grantSite(e, CH, { slug: 'abc-def', tier: 'white-label', themeRef: 'pkg@1.0.0', actor: 'a' }), /theme_not_available/);
	});

	it('uses the production and stage zones', async () => {
		const prod = env({ SITES_ENV: 'production' });
		assert.equal((await grantSite(prod, CH, { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'a' })).hosts[0].host, 'mustafa-elbadry.alummahnow.org');
		const stage = env({ SITES_ENV: 'stage' });
		assert.equal((await grantSite(stage, CH, { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'a' })).hosts[0].host, 'mustafa-elbadry.stage.alummahnow.org');
	});
});

describe('host lookup (sites Worker)', () => {
	it('hides a site in setup, serves it live, 404s unknown and platform hosts', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'a' });
		assert.equal((await publicSiteForHost(e, 'mustafa-elbadry.qa.alummahnow.org', null)).kind, 'not_found');
		await adminUpdateSite(e, CH, { status: 'live', actor: 'a' });
		const found = await publicSiteForHost(e, 'MUSTAFA-ELBADRY.qa.alummahnow.org:443', null);
		assert.equal(found.kind, 'site');
		if (found.kind !== 'site') return;
		assert.equal(found.site.site.themeRef, 'fawanees@1.3.0');
		assert.equal(found.site.site.primaryKind, 'subdomain');
		assert.equal(found.site.channel.name, 'Mustafa Elbadry');
		assert.equal(found.site.preview, false);
		assert.equal((await publicSiteForHost(e, 'nobody.qa.alummahnow.org', null)).kind, 'not_found');
		assert.equal((await publicSiteForHost(e, 'www.alummahnow.net', null)).kind, 'not_found');
		assert.equal((await publicSiteForHost(e, 'not a host', null)).kind, 'not_found');
	});

	it('redirects an old subdomain to the new one for 12 months after a rename', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'a' });
		const now = new Date('2026-11-13T00:00:00Z');
		const { after } = await adminUpdateSite(e, CH, { status: 'live', slug: 'elbadry', actor: 'a' }, now);
		assert.equal(after.hosts[0].host, 'elbadry.qa.alummahnow.org');
		assert.deepEqual(await publicSiteForHost(e, 'mustafa-elbadry.qa.alummahnow.org', null, now), { kind: 'redirect', location: 'https://elbadry.qa.alummahnow.org' });
		assert.equal((await publicSiteForHost(e, 'mustafa-elbadry.qa.alummahnow.org', null, new Date('2027-11-14T00:00:00Z'))).kind, 'not_found');
		// Nobody else can take the old name while it redirects
		await assert.rejects(grantSite(e, 'ch_other', { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'a' }), /host_taken/);
	});

	it('revoke redirects to the channel; restore within 30 days brings it back', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'a' });
		await adminUpdateSite(e, CH, { status: 'live', actor: 'a' });
		const at = new Date('2026-11-13T00:00:00Z');
		await revokeSite(e, CH, 'a', at);
		assert.deepEqual(await publicSiteForHost(e, 'mustafa-elbadry.qa.alummahnow.org', null), { kind: 'redirect', location: 'https://videos.qa.alummahnow.net/@mustafa' });
		await assert.rejects(adminUpdateSite(e, CH, { status: 'live', actor: 'a' }), /site_revoked/);
		await assert.rejects(restoreSite(e, CH, 'a', new Date('2026-12-14T00:00:00Z')), /restore_window_passed/);
		const restored = await restoreSite(e, CH, 'a', new Date('2026-11-20T00:00:00Z'));
		assert.equal(restored.status, 'live');
		assert.equal((await publicSiteForHost(e, 'mustafa-elbadry.qa.alummahnow.org', null)).kind, 'site');
	});

	it('a preview token shows unsaved settings, even in setup, and never another channel\'s', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'a' });
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('userId' as never, OWNER as never);
			await next();
		});
		app.route('/api/sites', sitesRouter as never);
		const res = await app.request(`/api/sites/channel/${CH}/preview`, { method: 'POST', body: JSON.stringify({ themeRef: 'nahas@1.0.0', locales: ['ar'] }), headers: { 'content-type': 'application/json' } }, e);
		assert.equal(res.status, 200);
		const { token, url } = (await res.json()) as { token: string; url: string };
		assert.equal(url, `https://mustafa-elbadry.qa.alummahnow.org/?preview=${token}`);
		const found = await publicSiteForHost(e, 'mustafa-elbadry.qa.alummahnow.org', token);
		assert.equal(found.kind, 'site');
		if (found.kind === 'site') {
			assert.equal(found.site.preview, true);
			assert.equal(found.site.site.themeRef, 'nahas@1.0.0');
			assert.deepEqual(found.site.site.locales, ['ar']);
		}
		assert.equal((await publicSiteForHost(e, 'mustafa-elbadry.qa.alummahnow.org', 'f'.repeat(32))).kind, 'not_found');
		assert.equal((await publicSiteForHost(e, 'mustafa-elbadry.qa.alummahnow.org', token, new Date(Date.now() + 11 * 60_000))).kind, 'not_found');
	});
});

describe('Studio settings (channel owner and admins)', () => {
	function studio(e: unknown, userId: string | null) {
		const app = new Hono();
		app.use('*', async (c, next) => {
			if (userId) c.set('userId' as never, userId as never);
			await next();
		});
		app.route('/api/sites', sitesRouter as never);
		return (path: string, init?: RequestInit) => app.request(path, init, e as never);
	}

	it('owner and channel admins edit; editors, strangers and anonymous visitors cannot', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'mustafa-elbadry', tier: 'white-label', actor: 'a' });
		assert.equal((await studio(e, null)(`/api/sites/channel/${CH}`)).status, 401);
		assert.equal((await studio(e, EDITOR)(`/api/sites/channel/${CH}`)).status, 403);
		assert.equal((await studio(e, 'usr_stranger')(`/api/sites/channel/${CH}`)).status, 403);
		const got = await studio(e, ADMIN)(`/api/sites/channel/${CH}`);
		assert.equal(got.status, 200);
		const body = (await got.json()) as { etag: string; themes: { ref: string }[]; primaryHost: string };
		assert.equal(body.primaryHost, 'mustafa-elbadry.qa.alummahnow.org');
		assert.ok(body.themes.some((t) => t.ref === 'zujaj@1.0.0'));

		const put = (who: string, update: unknown, etag?: string) =>
			studio(e, who)(`/api/sites/channel/${CH}`, { method: 'PUT', body: JSON.stringify(update), headers: { 'content-type': 'application/json', ...(etag ? { 'If-Match': `"${etag}"` } : {}) } });
		const saved = await put(OWNER, { themeRef: 'zujaj@1.0.0', name: { en: ' Sh. Mustafa ', ar: 'الشيخ مصطفى' }, status: 'live', limits: { navigationMax: 99 } }, body.etag);
		assert.equal(saved.status, 200);
		const after = (await saved.json()) as { site: any; etag: string };
		assert.equal(after.site.themeRef, 'zujaj@1.0.0');
		assert.deepEqual(after.site.name, { en: 'Sh. Mustafa', ar: 'الشيخ مصطفى' });
		// Studio can't change the status or the limits the admin set
		assert.equal(after.site.status, 'setup');
		assert.equal(after.site.limits.navigationMax, 8);
		// A save over an older version is refused instead of losing the other edit
		assert.equal((await put(ADMIN, { about: { en: 'x' } }, body.etag)).status, 412);
		assert.equal((await put(ADMIN, { themeRef: 'custom@9.9.9' }, after.etag)).status, 400);
	});
});

describe('internal routes (admin-api)', () => {
	it('grants, renames, revokes and restores over HTTP with the actor recorded', async () => {
		const e = env();
		const app = new Hono();
		app.route('/internal/sites', sitesInternalRouter as never);
		const call = (method: string, path: string, json?: unknown) =>
			app.request(`/internal/sites${path}`, { method, headers: { 'content-type': 'application/json', 'X-Admin-Actor': 'usr_staff' }, body: json === undefined ? undefined : JSON.stringify(json) }, e);
		assert.equal((await call('GET', '/slug/mustafa-elbadry')).status, 200);
		const granted = await call('POST', `/${CH}`, { slug: 'Mustafa-Elbadry', tier: 'white-label-domain' });
		assert.equal(granted.status, 201);
		const site = ((await granted.json()) as { site: any }).site;
		assert.equal(site.slug, 'mustafa-elbadry');
		assert.equal(site.grantedBy, 'usr_staff');
		assert.equal(site.limits.customDomainsMax, 2);
		assert.equal((await call('POST', `/${CH}`, { slug: 'mustafa-elbadry', tier: 'white-label' })).status, 409);
		assert.equal((await call('PATCH', `/${CH}`, { status: 'live' })).status, 200);
		assert.equal((await call('PATCH', `/${CH}`, { limits: { bad: true } })).status, 400);
		assert.equal((await call('DELETE', `/${CH}`)).status, 200);
		assert.equal(((await (await call('GET', `/${CH}`)).json()) as { site: any }).site.status, 'revoked');
		assert.equal(((await (await call('POST', `/${CH}/restore`)).json()) as { site: any }).site.status, 'live');
		assert.equal((await call('GET', '/ch_missing')).status, 404);
	});
});
