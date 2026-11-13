/**
 * White-label scholar sites, admin side (wiki AUN-SCHOLAR-SITES §8): the grant is recorded as
 * entitlement overrides on the channel, every change is audited, only creators:manage may change,
 * the starting theme is the platform's current theme pinned. api-videos is faked.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import sitesRouter from '../src/routers/sites.router';
import { sqliteD1 } from './d1-sqlite';

function fakeVideos() {
  const sites = new Map<string, any>();
  const calls: { method: string; path: string; actor: string | null; body: any }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace('/internal/sites', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const headers = init.headers as Record<string, string>;
    calls.push({ method: init.method ?? 'GET', path, actor: headers['X-Admin-Actor'] ?? null, body });
    assert.equal(headers['X-API-Key'], 'k');
    const id = path.split('/')[1];
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (path.startsWith('/slug/')) return json({ available: true, reason: null, host: `${path.slice(6)}.qa.alummahnow.org` });
    if (init.method === 'POST' && !path.endsWith('/restore')) {
      if (sites.has(id)) return json({ error: 'site_exists' }, 409);
      const site = { channelId: id, slug: body.slug, tier: body.tier, limits: body.limits, themeRef: body.themeRef, status: 'setup', hosts: [{ host: `${body.slug}.qa.alummahnow.org`, kind: 'subdomain', primary: true }] };
      sites.set(id, site);
      return json({ site }, 201);
    }
    const site = sites.get(id);
    if (!site) return json({ error: 'site_not_found' }, 404);
    if (init.method === 'PATCH') {
      const before = { ...site };
      Object.assign(site, body);
      return json({ before, site });
    }
    if (init.method === 'DELETE') return json({ site: Object.assign(site, { status: 'revoked' }) });
    if (path.endsWith('/restore')) return json({ site: Object.assign(site, { status: 'setup' }) });
    return json({ site });
  };
  return { sites, calls, fetch };
}

function setup(theme?: string) {
  const db = sqliteD1();
  const videos = fakeVideos();
  const channels = new Map<string, unknown>([['ch_1', { id: 'ch_1', name: 'Mustafa Elbadry', handle: 'mustafa', userId: 'usr_o' }]]);
  const env = {
    REPORTS_DB: db,
    INTERNAL_API_KEY: 'k',
    VIDEOS: { fetch: videos.fetch },
    channels: { get: async (k: string) => (channels.has(k) ? { json: async () => channels.get(k) } : null) },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-roles') ?? 'admin';
    c.set('auth' as never, { userId: 'usr_staff', email: 'staff@example.com', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/sites', sitesRouter as never);
  const call = async (method: string, path: string, json?: unknown, roles?: string) => {
    const res = await app.request(`/api/sites${path}`, { method, headers: { 'content-type': 'application/json', ...(roles !== undefined ? { 'x-roles': roles } : {}) }, body: json === undefined ? undefined : JSON.stringify(json) }, env as never);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { db, videos, call, env, theme };
}

const overrides = async (db: D1Database, channelId: string) =>
  Object.fromEntries(((await db.prepare("SELECT key, value_json, reason FROM entitlement_overrides WHERE subject_type = 'channel' AND subject_id = ?").bind(channelId).all()).results as any[]).map((r) => [r.key, { v: JSON.parse(r.value_json), reason: r.reason }]));

describe('admin Sites', () => {
  it('grants a tier: api-videos site, entitlement overrides, audit, platform theme pinned', async () => {
    const t = setup();
    await t.db.prepare("INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ('site.theme', 'nahas', 'x', '2026-11-01')").run();
    const res = await t.call('POST', '/ch_1', { tier: 'white-label', slug: 'mustafa-elbadry' });
    assert.equal(res.status, 201);
    const post = t.videos.calls.find((c) => c.method === 'POST')!;
    assert.equal(post.actor, 'usr_staff');
    assert.equal(post.body.themeRef, 'nahas@1.0.0');
    assert.equal(post.body.limits.navigationMax, 8);
    const o = await overrides(t.db, 'ch_1');
    assert.deepEqual(o['site.enabled'], { v: true, reason: 'addon:white-label' });
    assert.equal(o['site.platformMark'].v, 'minimal');
    assert.equal(o['site.customDomains.max'].v, 0);
    const detail = await t.call('GET', '/ch_1');
    assert.equal(detail.body.result.channel.name, 'Mustafa Elbadry');
    assert.equal(detail.body.result.history[0].action, 'site-grant');
    const list = await t.call('GET', '?q=mustafa');
    assert.equal(list.body.result.sites.length, 1);
    assert.equal(list.body.result.sites[0].site.slug, 'mustafa-elbadry');
    assert.equal((await t.call('GET', '?q=nobody')).body.result.sites.length, 0);
  });

  it('only creators:manage changes; any admin role reads', async () => {
    const t = setup();
    assert.equal((await t.call('POST', '/ch_1', { tier: 'white-label', slug: 'abc-def' }, 'moderator')).status, 403);
    assert.equal((await t.call('GET', '', undefined, 'moderator')).status, 200);
    assert.equal((await t.call('POST', '/ch_1', { tier: 'gold', slug: 'abc-def' })).status, 400);
    assert.equal((await t.call('POST', '/bad%20id', { tier: 'white-label', slug: 'abc-def' })).status, 400);
  });

  it('changes limits and tier, revokes (site.enabled false) and restores, all audited', async () => {
    const t = setup();
    await t.call('POST', '/ch_1', { tier: 'white-label', slug: 'mustafa-elbadry' });
    const upgraded = await t.call('PATCH', '/ch_1', { tier: 'white-label-domain', limits: { customDomainsMax: 2, platformMark: 'none', pagesMax: 100, navigationMax: 12, analytics: true, brandedSignIn: true } });
    assert.equal(upgraded.status, 200);
    assert.equal((await overrides(t.db, 'ch_1'))['site.customDomains.max'].v, 2);
    assert.equal((await t.call('PATCH', '/ch_1', {})).status, 400);
    assert.equal((await t.call('PATCH', '/ch_1', { status: 'live' })).status, 200);
    assert.equal((await t.call('DELETE', '/ch_1')).status, 200);
    assert.deepEqual((await overrides(t.db, 'ch_1'))['site.enabled'], { v: false, reason: 'addon:revoked' });
    assert.equal((await t.call('POST', '/ch_1/restore')).status, 200);
    assert.equal((await overrides(t.db, 'ch_1'))['site.enabled'].v, true);
    const actions = (await t.call('GET', '/ch_1')).body.result.history.map((h: any) => h.action);
    assert.deepEqual(actions.sort(), ['site-grant', 'site-limits', 'site-live', 'site-restore', 'site-revoke'].sort());
  });

  it('passes api-videos refusals through (taken slug, existing site)', async () => {
    const t = setup();
    await t.call('POST', '/ch_1', { tier: 'white-label', slug: 'mustafa-elbadry' });
    const again = await t.call('POST', '/ch_1', { tier: 'white-label', slug: 'mustafa-elbadry' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'site_exists');
    assert.equal((await t.call('GET', '/ch_none')).status, 404);
  });
});
