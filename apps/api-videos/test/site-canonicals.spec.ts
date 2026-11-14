/**
 * Scholar sites on the platform side (wiki AUN-SCHOLAR-SITES §4.4, #1215): the live-site index every
 * settings write keeps, GET /api/sites/by-channel/:id, and the videos sitemap leaving out what is
 * canonical on a site (posts: any live site; videos: a site on the scholar's own domain).
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { siteAlternates, siteUrl } from '@al-ummah/shared-types';
import { adminUpdateSite, grantSite, publicSiteForHost, revokeSite } from '../src/lib/sites/service';
import { reserveDomain, setPrimaryHost, updateDomain } from '../src/lib/sites/domains';
import { SITE_CANONICALS_KEY, publicSiteLink, resetSiteCanonicalMemo, siteCanonicalChannels, syncSiteCanonical } from '../src/lib/sites/canonical';
import { sitesRouter } from '../src/routers/sites.router';
import { sitemapPage, sitemapSummary } from '../src/lib/sitemap';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const CH = 'ch_scholar';
const OWN = 'www.example.qa-sites.alummahnow.com';

function env() {
	return {
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		channels: new MemoryBucket({
			[CH]: { id: CH, name: 'Scholar', handle: 'scholar', userId: 'usr_owner', members: [] },
			ch_other: { id: 'ch_other', name: 'Other', userId: 'usr_x' },
		}),
		SITES_ENV: 'qa',
		VIDEOS_WEB_URL: 'https://videos.qa.alummahnow.net',
	} as never as Parameters<typeof grantSite>[0] & { channel_tabs: MemoryBucket; channels: MemoryBucket };
}

async function liveSite(e = env()) {
	await grantSite(e, CH, { slug: 'scholar-site', tier: 'white-label-domain', actor: 'adm' });
	await adminUpdateSite(e, CH, { status: 'live', actor: 'adm' });
	return e;
}

async function onOwnDomain(e: ReturnType<typeof env>) {
	await reserveDomain(e, CH, OWN, 'usr_owner');
	await updateDomain(e, CH, OWN, { status: 'live' }, 'admin-api');
	await setPrimaryHost(e, CH, OWN, 'usr_owner');
}

beforeEach(() => resetSiteCanonicalMemo());

describe('site URLs (shared-types)', () => {
	const link = { primaryHost: 'scholar.example', locales: ['ar', 'en'] as ('en' | 'ar')[] };
	it('builds a page URL in a language the site serves, else its default', () => {
		assert.equal(siteUrl(link, 'en', '/posts/p1/'), 'https://scholar.example/en/posts/p1/');
		assert.equal(siteUrl({ ...link, locales: ['ar'] }, 'en', 'about/'), 'https://scholar.example/ar/about/');
	});
	it('pairs only the site languages, x-default = its default; one language has no x-default', () => {
		assert.deepEqual(siteAlternates(link, 'watch/v1/'), {
			ar: 'https://scholar.example/ar/watch/v1/',
			en: 'https://scholar.example/en/watch/v1/',
			'x-default': 'https://scholar.example/ar/watch/v1/',
		});
		assert.deepEqual(siteAlternates({ ...link, locales: ['en'] }, 'watch/v1/'), { en: 'https://scholar.example/en/watch/v1/' });
	});
});

describe('live-site index', () => {
	it('has a site only while it is live, with its primary host and languages', async () => {
		const e = env();
		await grantSite(e, CH, { slug: 'scholar-site', tier: 'white-label-domain', actor: 'adm' });
		assert.equal(await publicSiteLink(e, CH), null, 'setup is not live');
		await adminUpdateSite(e, CH, { status: 'live', actor: 'adm' });
		resetSiteCanonicalMemo();
		assert.deepEqual(await publicSiteLink(e, CH), { channelId: CH, primaryHost: 'scholar-site.qa.alummahnow.org', primaryKind: 'subdomain', locales: ['en', 'ar'] });
		assert.deepEqual(await siteCanonicalChannels(e), { posts: [CH], videos: [] });

		await onOwnDomain(e);
		resetSiteCanonicalMemo();
		const link = await publicSiteLink(e, CH);
		assert.equal(link?.primaryHost, OWN);
		assert.equal(link?.primaryKind, 'custom');
		assert.deepEqual(await siteCanonicalChannels(e), { posts: [CH], videos: [CH] });

		await adminUpdateSite(e, CH, { status: 'suspended', actor: 'adm' });
		resetSiteCanonicalMemo();
		assert.equal(await publicSiteLink(e, CH), null, 'suspended');
		await adminUpdateSite(e, CH, { status: 'live', actor: 'adm' });
		await revokeSite(e, CH, 'adm');
		resetSiteCanonicalMemo();
		assert.equal(await publicSiteLink(e, CH), null, 'revoked');
		assert.deepEqual(await siteCanonicalChannels(e), { posts: [], videos: [] });
	});

	it('keeps two sites saving at once (ETag-guarded)', async () => {
		const e = await liveSite();
		await grantSite(e, 'ch_other', { slug: 'other-site', tier: 'white-label', actor: 'adm' });
		await adminUpdateSite(e, 'ch_other', { status: 'live', actor: 'adm' });
		resetSiteCanonicalMemo();
		assert.deepEqual((await siteCanonicalChannels(e)).posts.sort(), ['ch_other', CH]);
	});

	it('a suspended or deleted channel has no link even while its site is live', async () => {
		const e = await liveSite();
		await e.channels.put(CH, JSON.stringify({ id: CH, name: 'Scholar', isSuspended: true }));
		assert.equal(await publicSiteLink(e, CH), null);
		await e.channels.put(CH, JSON.stringify({ id: CH, name: 'Scholar', isDeleted: true }));
		assert.equal(await publicSiteLink(e, CH), null);
		assert.equal(await publicSiteLink(e, 'not a channel id!'), null);
	});

	it('the host lookup repairs an entry a failed sync left out', async () => {
		const e = await liveSite();
		await e.channel_tabs.delete(SITE_CANONICALS_KEY);
		resetSiteCanonicalMemo();
		assert.equal(await publicSiteLink(e, CH), null, 'index lost');
		resetSiteCanonicalMemo();
		assert.equal((await publicSiteForHost(e, 'scholar-site.qa.alummahnow.org', null)).kind, 'site');
		resetSiteCanonicalMemo();
		assert.equal((await publicSiteLink(e, CH))?.primaryHost, 'scholar-site.qa.alummahnow.org');
	});

	it('gives up after repeated conflicts without failing the caller', async () => {
		const e = await liveSite();
		const put = e.channel_tabs.put.bind(e.channel_tabs);
		e.channel_tabs.put = (async () => null) as never;
		const settings = await (await (e.channel_sections as unknown as MemoryBucket).get(`site/${CH}/settings.json`))!.json();
		assert.equal(await syncSiteCanonical(e, { ...settings, status: 'suspended' }), false);
		e.channel_tabs.put = put;
	});
});

describe('GET /api/sites/by-channel/:id', () => {
	it('answers the live site (cached 5 minutes) or 404', async () => {
		const e = await liveSite();
		resetSiteCanonicalMemo();
		const ok = await sitesRouter.request(`/by-channel/${CH}`, {}, e as never);
		assert.equal(ok.status, 200);
		assert.equal(ok.headers.get('cache-control'), 'public, max-age=300');
		assert.deepEqual(await ok.json(), { channelId: CH, primaryHost: 'scholar-site.qa.alummahnow.org', primaryKind: 'subdomain', locales: ['en', 'ar'] });
		const none = await sitesRouter.request('/by-channel/ch_other', {}, e as never);
		assert.equal(none.status, 404);
	});
});

describe('videos sitemap leaves out what a site holds', () => {
	function seed() {
		const db = new SqliteD1();
		const insert = (table: string, id: string, channel: string) =>
			db.db
				.prepare(`INSERT INTO ${table} (id, channel_id, visible, payload, created_at, indexed_at, duration, is_short) VALUES (?, ?, 1, ?, 1, 1, NULL, 0)`)
				.run(id, channel, JSON.stringify({ id, channelId: channel, title: id, name: id }));
		insert('search_channels', 'ch_a', 'ch_a');
		insert('search_channels', 'ch_b', 'ch_b');
		insert('search_videos', 'va', 'ch_a');
		insert('search_videos', 'vb', 'ch_b');
		insert('search_posts', 'pa', 'ch_a');
		insert('search_posts', 'pb', 'ch_b');
		insert('search_playlists', 'la', 'ch_a');
		return db as never;
	}

	it('posts of a live site, videos of an own-domain site; channels and playlists stay', async () => {
		const db = seed();
		const exclude = { posts: ['ch_a'], videos: ['ch_a'] };
		assert.deepEqual((await sitemapPage(db, 'videos', 0, undefined, exclude)).map((i) => i.id), ['vb']);
		assert.deepEqual((await sitemapPage(db, 'posts', 0, undefined, exclude)).map((i) => i.id), ['pb']);
		assert.deepEqual((await sitemapPage(db, 'channels', 0, undefined, exclude)).map((i) => i.id), ['ch_a', 'ch_b']);
		assert.deepEqual((await sitemapPage(db, 'playlists', 0, undefined, exclude)).map((i) => i.id), ['la']);
		const summary = await sitemapSummary(db, exclude);
		assert.equal(summary.kinds.videos.count, 1);
		assert.equal(summary.kinds.posts.count, 1);
		assert.equal(summary.kinds.channels.count, 2);
		// No exclusions: everything
		assert.equal((await sitemapSummary(db)).kinds.videos.count, 2);
		// A subdomain site: posts out, videos stay
		assert.deepEqual((await sitemapPage(db, 'videos', 0, undefined, { posts: ['ch_a'], videos: [] })).map((i) => i.id), ['va', 'vb']);
	});
});
