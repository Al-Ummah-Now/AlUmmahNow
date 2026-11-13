/**
 * Own domains of white-label sites (#1212): admin-api asks Cloudflare for SaaS (mocked) and records
 * the answer in api-videos (faked). Covers: add with the DNS records, SaaS not enabled (1404) undoes
 * the reservation, a host another site holds, status mapping, the cron reads only due rows, remove,
 * staff permission and the Studio route's key + token + channel.edit check.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { staffSiteDomainsRouter, studioSiteDomainsRouter } from '../src/routers/siteDomains.router';
import { recordsOf, statusOf } from '../src/lib/sites/saas';
import { runDomainChecks } from '../src/lib/sites/domains';
import { sqliteD1 } from './d1-sqlite';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function fakeVideos() {
  const site: any = { channelId: 'ch_1', slug: 's', status: 'live', limits: { customDomainsMax: 2 }, hosts: [{ host: 's.qa.alummahnow.org', kind: 'subdomain', primary: true }], domains: [] };
  const taken = new Set(['taken.example.com']);
  const calls: string[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push(`${method} ${u.pathname}`);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const rest = u.pathname.replace('/internal/sites/ch_1', '');
    if (rest === '/editor') return json({ canEdit: u.searchParams.get('userId') === 'usr_owner' });
    if (rest === '' && method === 'GET') return json({ site });
    if (rest === '/domains' && method === 'POST') {
      if (taken.has(body.host)) return json({ error: 'host_taken' }, 409);
      const domain = { host: body.host, cfId: null, status: 'waiting_dns', records: [], addedAt: new Date().toISOString(), addedBy: 'x', checkedAt: null, error: null };
      site.domains.push(domain);
      return json({ site, domain }, 201);
    }
    const m = rest.match(/^\/domains\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const d = site.domains.find((x: any) => x.host === decodeURIComponent(m[1]));
      Object.assign(d, body);
      if (d.status === 'live' && !site.hosts.some((h: any) => h.host === d.host)) site.hosts.push({ host: d.host, kind: 'custom', primary: false });
      return json({ site, domain: d });
    }
    if (m && method === 'DELETE') {
      const host = decodeURIComponent(m[1]);
      site.domains = site.domains.filter((x: any) => x.host !== host);
      site.hosts = site.hosts.filter((h: any) => h.host !== host);
      return json({ site, removed: { host } });
    }
    return json({ error: 'not_found' }, 404);
  };
  return { site, calls, fetch };
}

function fakeCloudflare(mode: { saasOff?: boolean } = {}) {
  const seen: { method: string; url: string; body: any }[] = [];
  const state = new Map<string, any>();
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ method: init.method ?? 'GET', url, body });
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer saas-token');
    if (mode.saasOff) return json({ success: false, errors: [{ code: 1404, message: 'No quota has been allocated for this zone.' }] }, 403);
    if (init.method === 'POST') {
      const h = { id: `cf_${state.size + 1}`, hostname: body.hostname, status: 'pending', ssl: { status: 'pending_validation', validation_records: [{ txt_name: `_acme-challenge.${body.hostname}`, txt_value: 'cert-token' }] }, ownership_verification: { type: 'txt', name: `_cf-custom-hostname.${body.hostname}`, value: 'own-token' } };
      state.set(h.id, h);
      return json({ success: true, result: h });
    }
    const id = url.split('/').pop()!;
    if (init.method === 'DELETE') return json({ success: true, result: { id } });
    const h = state.get(id);
    return json({ success: true, result: { ...h, status: 'active', ssl: { status: 'active' } } });
  }) as typeof fetch;
  return { seen, fetch };
}

function setup(cf = fakeCloudflare()) {
  const db = sqliteD1();
  const videos = fakeVideos();
  const env = { REPORTS_DB: db, INTERNAL_API_KEY: 'k', SITES_SAAS_TOKEN: 'saas-token', VIDEOS: { fetch: videos.fetch } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = cf.fetch;
  const staff = new Hono();
  staff.use('*', async (c, next) => {
    const roles = c.req.header('x-roles') ?? 'admin';
    c.set('auth' as never, { userId: 'usr_staff', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  staff.route('/api/sites', staffSiteDomainsRouter as never);
  const call = async (method: string, path: string, body?: unknown, roles?: string) => {
    const res = await staff.request(`/api/sites${path}`, { method, headers: { 'content-type': 'application/json', ...(roles !== undefined ? { 'x-roles': roles } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env as never);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { db, videos, cf, env, call, restore: () => (globalThis.fetch = realFetch) };
}

describe('site domains (admin-api)', () => {
  it('maps Cloudflare states and records', () => {
    assert.equal(statusOf({ id: '1', hostname: 'a.com', status: 'pending', ssl: { status: 'pending_validation' } }), 'waiting_dns');
    assert.equal(statusOf({ id: '1', hostname: 'a.com', status: 'active', ssl: { status: 'pending_validation' } }), 'issuing');
    assert.equal(statusOf({ id: '1', hostname: 'a.com', status: 'pending', ssl: { status: 'pending_issuance' } }), 'issuing');
    assert.equal(statusOf({ id: '1', hostname: 'a.com', status: 'active', ssl: { status: 'active' } }), 'live');
    assert.equal(statusOf({ id: '1', hostname: 'a.com', status: 'blocked' }), 'failed');
    assert.equal(statusOf({ id: '1', hostname: 'a.com', status: 'pending', ssl: { status: 'validation_timed_out' } }), 'failed');
    assert.deepEqual(
      recordsOf({ id: '1', hostname: 'a.com', ownership_verification: { type: 'txt', name: '_cf.a.com', value: 'o' }, ssl: { validation_records: [{ txt_name: '_acme.a.com', txt_value: 'c' }] } }).map((r) => `${r.type} ${r.name} ${r.value} ${r.purpose}`),
      ['CNAME a.com sites.alummahnow.org traffic', 'TXT _cf.a.com o ownership', 'TXT _acme.a.com c certificate'],
    );
  });

  it('adds a domain with its DNS records, checks it on the cron, removes it', async () => {
    const t = setup();
    try {
      const added = await t.call('POST', '/ch_1/domains', { host: 'www.example.com' });
      assert.equal(added.status, 201);
      assert.equal(added.body.result.domain.cfId, 'cf_1');
      assert.deepEqual(added.body.result.domain.records.map((r: any) => r.purpose), ['traffic', 'ownership', 'certificate']);
      assert.equal(t.cf.seen[0].body.ssl.method, 'txt');
      const row = (await t.db.prepare('SELECT * FROM site_domain_checks').all()).results as any[];
      assert.equal(row.length, 1);
      // Nothing is due yet; later it is, and Cloudflare now says active
      assert.deepEqual(await runDomainChecks(t.env as never, Date.now()), { checked: 0, failed: 0 });
      assert.deepEqual(await runDomainChecks(t.env as never, Date.now() + 11 * 60 * 1000), { checked: 1, failed: 0 });
      assert.equal(t.videos.site.domains[0].status, 'live');
      const listed = await t.call('GET', '/ch_1/domains');
      assert.equal(listed.body.result.limit, 2);
      assert.ok(listed.body.result.hosts.some((h: any) => h.host === 'www.example.com'));
      const removed = await t.call('DELETE', '/ch_1/domains/www.example.com');
      assert.equal(removed.status, 200);
      assert.ok(t.cf.seen.some((s) => s.method === 'DELETE' && s.url.endsWith('/cf_1')));
      assert.equal(((await t.db.prepare('SELECT * FROM site_domain_checks').all()).results as any[]).length, 0);
    } finally {
      t.restore();
    }
  });

  it('SaaS not enabled (1404): a friendly code, and the reservation is undone', async () => {
    const t = setup(fakeCloudflare({ saasOff: true }));
    try {
      const res = await t.call('POST', '/ch_1/domains', { host: 'www.example.com' });
      assert.equal(res.status, 503);
      assert.equal(res.body.code, 'saas_unavailable');
      assert.equal(t.videos.site.domains.length, 0);
      assert.ok(t.videos.calls.includes('DELETE /internal/sites/ch_1/domains/www.example.com'));
    } finally {
      t.restore();
    }
  });

  it('refuses a host another site holds, and changes need creators:manage', async () => {
    const t = setup();
    try {
      const res = await t.call('POST', '/ch_1/domains', { host: 'taken.example.com' });
      assert.deepEqual([res.status, res.body.code], [409, 'host_taken']);
      assert.equal(t.cf.seen.length, 0, 'Cloudflare is never asked for a taken host');
      assert.equal((await t.call('POST', '/ch_1/domains', { host: 'a.example.com' }, 'moderator')).status, 403);
      assert.equal((await t.call('GET', '/ch_1/domains', undefined, 'moderator')).status, 200);
    } finally {
      t.restore();
    }
  });

  it('Studio route: needs the internal key, a signed-in user and channel.edit', async () => {
    const t = setup();
    try {
      const app = new Hono();
      app.route('/internal/site-domains', studioSiteDomainsRouter as never);
      const token = (sub: string) => `x.${btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 600 })).replace(/=+$/, '')}.y`;
      const req = (headers: Record<string, string>) => app.request('/internal/site-domains/ch_1/domains', { headers }, { ...t.env, ENVIRONMENT: 'local' } as never);
      assert.equal((await req({})).status, 401);
      assert.equal((await req({ 'X-API-Key': 'k' })).status, 401);
      assert.equal((await req({ 'X-API-Key': 'k', Authorization: `Bearer ${token('usr_other')}` })).status, 403);
      assert.equal((await req({ 'X-API-Key': 'k', Authorization: `Bearer ${token('usr_owner')}` })).status, 200);
    } finally {
      t.restore();
    }
  });
});
