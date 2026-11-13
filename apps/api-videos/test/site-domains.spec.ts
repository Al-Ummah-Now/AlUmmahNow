/**
 * Own domains of a white-label site (#1212, lib/sites/domains.ts): reserve (checks, host index,
 * limit), Cloudflare answers → live host, primary host, remove with primary fallback, over in-memory R2.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkNewSiteDomain, nextDomainCheck, SITE_DOMAIN_FAST_CHECK_MS, SITE_DOMAIN_SLOW_CHECK_MS } from '@al-ummah/shared-types';
import { grantSite, publicSiteForHost } from '../src/lib/sites/service';
import { removeDomain, reserveDomain, setPrimaryHost, updateDomain } from '../src/lib/sites/domains';
import { sitesInternalRouter } from '../src/routers/sites.router';
import { MemoryBucket } from './helpers';

const CH = 'ch_scholar';
function env() {
	return {
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		channels: new MemoryBucket({
			[CH]: { id: CH, name: 'Scholar', handle: 'scholar', userId: 'usr_owner', members: [{ userId: 'usr_editor', role: 'editor', addedBy: 'usr_owner', addedAt: '2026-11-01T00:00:00Z' }] },
			ch_other: { id: 'ch_other', name: 'Other', userId: 'usr_x' },
		}),
		SITES_ENV: 'qa',
		VIDEOS_WEB_URL: 'https://videos.qa.alummahnow.net',
	} as never;
}

async function granted(tier: 'white-label' | 'white-label-domain' = 'white-label-domain') {
	const e = env();
	await grantSite(e, CH, { slug: 'scholar-site', tier, actor: 'adm' });
	await grantSite(e, 'ch_other', { slug: 'other-site', tier: 'white-label-domain', actor: 'adm' });
	return e;
}

describe('own domains', () => {
	it('checks what may be added', () => {
		const s = { domains: [], hosts: [], limits: { customDomainsMax: 1 } } as never;
		assert.deepEqual(checkNewSiteDomain('https://WWW.Example.com/path', s), { host: 'www.example.com' });
		assert.deepEqual(checkNewSiteDomain('not a domain', s), { problem: 'domain_invalid' });
		assert.deepEqual(checkNewSiteDomain('localhost', s), { problem: 'domain_invalid' });
		assert.deepEqual(checkNewSiteDomain('www.alummahnow.net', s), { problem: 'domain_platform' });
		assert.deepEqual(checkNewSiteDomain('x.alummahnow.org', s), { problem: 'domain_platform' });
		// One custom-hostname namespace for every env: QA/stage take only their test suffix, production refuses it
		assert.deepEqual(checkNewSiteDomain('www.example.com', s, 'qa'), { problem: 'domain_test_only' });
		assert.deepEqual(checkNewSiteDomain('a.qa-sites.alummahnow.com', s, 'qa'), { host: 'a.qa-sites.alummahnow.com' });
		assert.deepEqual(checkNewSiteDomain('a.qa-sites.alummahnow.com', s, 'stage'), { problem: 'domain_test_only' });
		assert.deepEqual(checkNewSiteDomain('a.stage-sites.alummahnow.com', s, 'stage'), { host: 'a.stage-sites.alummahnow.com' });
		assert.deepEqual(checkNewSiteDomain('a.qa-sites.alummahnow.com', s), { problem: 'domain_platform' });
		assert.deepEqual(checkNewSiteDomain('www.example.com', s, 'local'), { host: 'www.example.com' });
		assert.deepEqual(checkNewSiteDomain('a.example.com', { ...(s as object), domains: [{ host: 'b.example.com' }] } as never), { problem: 'domain_limit' });
		const now = Date.parse('2026-11-13T00:00:00Z');
		assert.equal(nextDomainCheck('2026-11-12T00:00:00Z', now), now + SITE_DOMAIN_FAST_CHECK_MS);
		assert.equal(nextDomainCheck('2026-11-01T00:00:00Z', now), now + SITE_DOMAIN_SLOW_CHECK_MS);
	});

	it('reserves a domain once, refuses one another site holds, and keeps to the limit', async () => {
		const e = await granted();
		const { domain, site } = await reserveDomain(e, CH, 'www.example.com', 'usr_owner');
		assert.equal(domain.status, 'waiting_dns');
		assert.deepEqual(domain.records, [{ type: 'CNAME', name: 'www.example.com', value: 'sites.alummahnow.org', purpose: 'traffic' }]);
		assert.ok(!site.hosts.some((h) => h.host === 'www.example.com'), 'not served before it is live');
		await assert.rejects(reserveDomain(e, CH, 'www.example.com', 'usr_owner'), /domain_exists/);
		await assert.rejects(reserveDomain(e, 'ch_other', 'www.example.com', 'usr_x'), /host_taken/);
		// white-label-domain allows its seeded number of own domains; the next one is refused
		const max = site.limits.customDomainsMax;
		for (let i = 1; i < max; i++) await reserveDomain(e, CH, `d${i}.example.com`, 'usr_owner');
		await assert.rejects(reserveDomain(e, CH, 'one-more.example.com', 'usr_owner'), /domain_limit/);
		const basic = env();
		await grantSite(basic, CH, { slug: 'scholar-site', tier: 'white-label', actor: 'adm' });
		await assert.rejects(reserveDomain(basic, CH, 'www.example.org', 'usr_owner'), /domain_limit/);
	});

	it('serves a domain once live, makes it primary, falls back when it is removed', async () => {
		const e = await granted();
		await reserveDomain(e, CH, 'www.example.com', 'usr_owner');
		const txt = [{ type: 'TXT', name: '_cf-custom-hostname.www.example.com', value: 'abc', purpose: 'ownership' }];
		const issuing = await updateDomain(e, CH, 'www.example.com', { cfId: 'cf1', status: 'issuing', records: txt as never }, 'admin-api');
		assert.equal(issuing.domain.cfId, 'cf1');
		await assert.rejects(setPrimaryHost(e, CH, 'www.example.com', 'usr_owner'), /host_not_live/);
		const live = await updateDomain(e, CH, 'www.example.com', { status: 'live' }, 'admin-api');
		assert.ok(live.site.hosts.some((h) => h.host === 'www.example.com' && h.kind === 'custom' && !h.primary));
		const primary = await setPrimaryHost(e, CH, 'www.example.com', 'usr_owner');
		assert.equal(primary.hosts.find((h) => h.primary)?.host, 'www.example.com');
		// the site must be live to serve: the subdomain now redirects to the own domain
		await (await import('../src/lib/sites/service')).adminUpdateSite(e, CH, { status: 'live', actor: 'adm' });
		assert.deepEqual(await publicSiteForHost(e, 'scholar-site.qa.alummahnow.org', null), { kind: 'redirect', location: 'https://www.example.com' });
		const removed = await removeDomain(e, CH, 'www.example.com', 'usr_owner');
		assert.equal(removed.site.hosts.find((h) => h.primary)?.host, 'scholar-site.qa.alummahnow.org');
		assert.deepEqual(await publicSiteForHost(e, 'www.example.com', null), { kind: 'not_found' });
		await reserveDomain(e, 'ch_other', 'www.example.com', 'usr_x'); // freed for others
	});

	it('a live domain that stops verifying leaves the hosts and gives the primary back', async () => {
		const e = await granted();
		await reserveDomain(e, CH, 'example.net', 'usr_owner');
		await updateDomain(e, CH, 'example.net', { status: 'live' }, 'admin-api');
		await setPrimaryHost(e, CH, 'example.net', 'usr_owner');
		const failed = await updateDomain(e, CH, 'example.net', { status: 'failed', error: 'DNS record not found' }, 'admin-api');
		assert.ok(!failed.site.hosts.some((h) => h.host === 'example.net'));
		assert.equal(failed.site.hosts.find((h) => h.primary)?.host, 'scholar-site.qa.alummahnow.org');
		assert.equal(failed.domain.error, 'DNS record not found');
		await assert.rejects(updateDomain(e, CH, 'example.net', { records: [{ type: 'A', name: 'x', value: 'y', purpose: 'traffic' }] as never }, 'x'), /records_invalid/);
	});

	it('internal routes: editor check by channel role, reserve and remove', async () => {
		const e = await granted();
		const call = (method: string, path: string, body?: unknown) =>
			sitesInternalRouter.request(path, { method, headers: { 'content-type': 'application/json', 'X-Admin-Actor': 'usr_owner' }, body: body ? JSON.stringify(body) : undefined }, e);
		assert.deepEqual(await (await call('GET', `/${CH}/editor?userId=usr_owner`)).json(), { canEdit: true });
		assert.deepEqual(await (await call('GET', `/${CH}/editor?userId=usr_editor`)).json(), { canEdit: false });
		assert.deepEqual(await (await call('GET', `/${CH}/editor?userId=usr_nobody`)).json(), { canEdit: false });
		assert.equal((await call('POST', `/${CH}/domains`, { host: 'www.example.com' })).status, 201);
		assert.equal((await call('POST', `/${CH}/domains`, { host: 'www.alummahnow.net' })).status, 400);
		assert.equal((await call('PUT', `/${CH}/primary`, { host: 'www.example.com' })).status, 409);
		assert.equal((await call('DELETE', `/${CH}/domains/www.example.com`)).status, 200);
		assert.equal((await call('DELETE', `/${CH}/domains/www.example.com`)).status, 404);
	});
});
