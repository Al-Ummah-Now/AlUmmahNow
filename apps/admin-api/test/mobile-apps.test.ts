/**
 * Mobile apps settings (NAT-REL): admin-only writes with an audit row each, moderators read,
 * invalid values refused with the field named, defaults per environment, and the public read the
 * videos site and api-videos use.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import siteSettingsRouter from '../src/routers/siteSettings.router';
import { mobileAppsEnvironment, readMobileApps } from '../src/lib/mobileApps';
import { defaultMobileAppsSettings, type MobileAppsSettings } from '@al-ummah/shared-types';

interface LogRow { id: string; key: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }

function fakeDb() {
  const settings = new Map<string, { value: string; updated_by: string; updated_at: string }>();
  const log: LogRow[] = [];
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => settings.get(args[0] as string) ?? null,
    all: async () => {
      const [key, limit] = args as [string, number];
      return { results: log.filter((r) => r.key === key).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, limit) };
    },
    run() {
      if (sql.includes('site_settings_log')) {
        const [id, key, old_value, new_value, actor_id, created_at] = args as string[];
        log.push({ id, key, old_value, new_value, actor_id, created_at });
      } else {
        settings.set(args[0] as string, { value: args[1] as string, updated_by: args[2] as string, updated_at: args[3] as string });
      }
    },
  });
  const db = { prepare: (sql: string) => statement(sql), batch: async (list: { run(): void }[]) => list.forEach((s) => s.run()) };
  return { db: db as unknown as D1Database, log, settings };
}

function appFor(db: D1Database, ENVIRONMENT = 'qa') {
  const app = new Hono<{ Bindings: { REPORTS_DB: D1Database; ENVIRONMENT: string } }>();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles');
    if (roles !== undefined) c.set('auth' as never, { userId: c.req.header('x-test-user'), roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  fromHono(app).route('/api/site-settings', siteSettingsRouter);
  return (path: string, init: RequestInit & { user?: string; roles?: string } = {}) => {
    const { user = 'user-1', roles, ...rest } = init;
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-test-user': user };
    if (roles !== undefined) headers['x-test-roles'] = roles;
    return app.request(path, { ...rest, headers }, { REPORTS_DB: db, ENVIRONMENT });
  };
}

const FP = 'aa'.repeat(32);

function filled(): MobileAppsSettings {
  const s = defaultMobileAppsSettings('qa');
  s.apple.teamId = 'ABCDE12345';
  s.android.apps[0].sha256Fingerprints = [FP];
  return s;
}

const put = (settings: unknown) => ({ method: 'PUT', body: JSON.stringify({ settings }) });

describe('mobile apps settings', () => {
  it('reads this environment\'s defaults until something is saved; nothing is published', async () => {
    const { db } = fakeDb();
    const res = await appFor(db, 'qa')('/api/site-settings/mobile-apps', { roles: 'Moderator' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.result.isDefault, true);
    assert.equal(body.result.settings.apple.teamId, '');
    assert.equal(body.result.settings.apple.apps[0].bundleId, 'net.alummahnow.viewer.qa');
    assert.equal(body.result.preview.appleAppSiteAssociation, null);
    assert.equal(body.result.preview.assetLinks, null);
    assert.deepEqual(body.result.preview.attestation, { apple: { enabled: false }, android: { enabled: false, cloudProjectNumber: null } });
    const prod = (await (await appFor(db, 'production')('/api/site-settings/mobile-apps', { roles: 'Admin' })).json()) as any;
    assert.equal(prod.result.settings.android.apps[0].packageName, 'net.alummahnow.app');
  });

  for (const role of ['Admin', 'Super Admin']) {
    it(`${role} saves; one audit row with before and after; the preview lists the apps`, async () => {
      const { db, log } = fakeDb();
      const call = appFor(db);
      const res = await call('/api/site-settings/mobile-apps', { ...put(filled()), roles: role, user: 'actor-1' });
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      assert.equal(body.changed, true);
      assert.equal(body.result.isDefault, false);
      assert.equal(body.result.updatedBy, 'actor-1');
      assert.equal(body.result.settings.android.apps[0].sha256Fingerprints[0], 'AA:'.repeat(31) + 'AA');
      assert.ok(body.result.preview.appleAppSiteAssociation.applinks.details[0].appIDs.includes('ABCDE12345.net.alummahnow.viewer.qa'));
      assert.deepEqual(body.result.preview.appleAppSiteAssociation.appclips, { apps: ['ABCDE12345.net.alummahnow.viewer.clip.qa'] });
      assert.equal(body.result.preview.assetLinks[0].target.package_name, 'net.alummahnow.app.qa');
      assert.equal(log.length, 1);
      assert.equal(log[0].key, 'mobile_apps');
      assert.equal(log[0].old_value, null);
      assert.equal(log[0].actor_id, 'actor-1');

      const again = (await (await call('/api/site-settings/mobile-apps', { ...put(filled()), roles: role })).json()) as any;
      assert.equal(again.changed, false);
      assert.equal(log.length, 1, 'an unchanged save writes no audit row');

      const history = (await (await call('/api/site-settings/mobile-apps/history', { roles: 'Moderator' })).json()) as any;
      assert.equal(history.result.entries.length, 1);
      assert.equal(history.result.entries[0].newValue.apple.teamId, 'ABCDE12345');
      assert.equal(history.result.entries[0].oldValue, null);
    });
  }

  it('a moderator may read but not save, and leaves no audit row', async () => {
    const { db, log } = fakeDb();
    const res = await appFor(db)('/api/site-settings/mobile-apps', { ...put(filled()), roles: 'Moderator' });
    assert.equal(res.status, 403);
    assert.equal(log.length, 0);
  });

  it('refuses invalid values and names the field', async () => {
    const { db, log } = fakeDb();
    const call = appFor(db);
    const bad = filled();
    bad.apple.teamId = 'abc';
    let res = await call('/api/site-settings/mobile-apps', { ...put(bad), roles: 'Admin' });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).issues[0].path, 'apple.teamId');

    const fp = filled();
    fp.android.apps[0].sha256Fingerprints = ['12:34'];
    res = await call('/api/site-settings/mobile-apps', { ...put(fp), roles: 'Admin' });
    assert.equal(res.status, 400);

    const attest = defaultMobileAppsSettings('qa');
    attest.apple.appAttest.enabled = true;
    attest.android.playIntegrity.enabled = true;
    res = await call('/api/site-settings/mobile-apps', { ...put(attest), roles: 'Admin' });
    assert.equal(res.status, 400);
    const paths = ((await res.json()) as any).issues.map((i: { path: string }) => i.path);
    assert.ok(paths.includes('apple.appAttest.enabled'));
    assert.ok(paths.includes('android.playIntegrity.enabled'));
    assert.equal(log.length, 0);
  });

  it('a stored value that no longer parses reads as the defaults', async () => {
    const { db, settings } = fakeDb();
    settings.set('mobile_apps', { value: '{"apple":1}', updated_by: 'x', updated_at: 't' });
    const state = await readMobileApps(db, 'qa');
    assert.equal(state.settings.apple.teamId, '');
    assert.equal(state.isDefault, false);
  });

  it('maps ENVIRONMENT to the defaults it gets', () => {
    assert.deepEqual(['production', 'stage', 'staging', 'qa', 'development', undefined].map(mobileAppsEnvironment), ['production', 'stage', 'stage', 'qa', 'local', 'local']);
  });
});
