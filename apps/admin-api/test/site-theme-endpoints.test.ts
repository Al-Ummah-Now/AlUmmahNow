/**
 * The site theme endpoints through the real router: who may change the theme,
 * the audit row each change writes, and the history read that shows them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import siteSettingsRouter from '../src/routers/siteSettings.router';

interface LogRow { id: string; key: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }

/** Just enough D1 for site_settings and site_settings_log. */
function fakeDb() {
  const settings = new Map<string, { value: string; updated_by: string; updated_at: string }>();
  const log: LogRow[] = [];
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => settings.get(args[0] as string) ?? null,
    all: async () => {
      const [key, limit] = args as [string, number];
      const rows = log
        .filter((r) => r.key === key)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
        .slice(0, limit);
      return { results: rows };
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

function appFor(db: D1Database) {
  const app = new Hono<{ Bindings: { REPORTS_DB: D1Database } }>();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles');
    // Mirrors authMiddleware: a verified token puts the user and roles on the context
    if (roles !== undefined) c.set('auth' as never, { userId: c.req.header('x-test-user'), roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  const openapi = fromHono(app);
  openapi.route('/api/site-settings', siteSettingsRouter);
  return (path: string, init: RequestInit & { user?: string; roles?: string } = {}) => {
    const { user = 'user-1', roles, ...rest } = init;
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-test-user': user };
    if (roles !== undefined) headers['x-test-roles'] = roles;
    return app.request(path, { ...rest, headers }, { REPORTS_DB: db });
  };
}

const put = (theme: string) => ({ method: 'PUT', body: JSON.stringify({ theme }) });

describe('site theme endpoints', () => {
  for (const role of ['Admin', 'Super Admin']) {
    it(`${role} changes the theme; the change and its audit row are read back`, async () => {
      const { db, log } = fakeDb();
      const call = appFor(db);
      const res = await call('/api/site-settings/theme', { ...put('nahas'), roles: role, user: 'actor-1' });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { changed: boolean; result: { theme: string; isDefault: boolean; updatedBy: string } };
      assert.equal(body.changed, true);
      assert.deepEqual([body.result.theme, body.result.isDefault, body.result.updatedBy], ['nahas', false, 'actor-1']);
      assert.equal(log.length, 1);
      assert.deepEqual([log[0].old_value, log[0].new_value, log[0].actor_id], [null, 'nahas', 'actor-1']);

      const read = await call('/api/site-settings/theme', { roles: 'Moderator' });
      assert.equal(read.status, 200);
      assert.equal(((await read.json()) as { result: { theme: string } }).result.theme, 'nahas');
    });
  }

  it('a moderator may read but not change the theme, and leaves no audit row', async () => {
    const { db, log, settings } = fakeDb();
    const call = appFor(db);
    const res = await call('/api/site-settings/theme', { ...put('zujaj'), roles: 'Moderator' });
    assert.equal(res.status, 403);
    assert.equal(settings.size, 0);
    assert.equal(log.length, 0);
  });

  it('a user without an admin role cannot read or change it', async () => {
    const { db, log } = fakeDb();
    const call = appFor(db);
    assert.equal((await call('/api/site-settings/theme', { roles: '' })).status, 403);
    assert.equal((await call('/api/site-settings/theme', { ...put('zujaj'), roles: '' })).status, 403);
    assert.equal((await call('/api/site-settings/theme/history', { roles: '' })).status, 403);
    assert.equal(log.length, 0);
  });

  it('signed out is refused', async () => {
    const { db } = fakeDb();
    assert.equal((await appFor(db)('/api/site-settings/theme', put('zujaj'))).status, 401);
  });

  it('rejects a theme that does not exist', async () => {
    const { db, log } = fakeDb();
    const res = await appFor(db)('/api/site-settings/theme', { ...put('neon'), roles: 'Admin' });
    assert.equal(res.status, 400);
    assert.equal(log.length, 0);
  });

  it('history lists every change newest first with the previous value, for moderators too', async () => {
    const { db } = fakeDb();
    const call = appFor(db);
    await call('/api/site-settings/theme', { ...put('nahas'), roles: 'Admin', user: 'a1' });
    await call('/api/site-settings/theme', { ...put('nahas'), roles: 'Admin', user: 'a1' }); // no change, no row
    await new Promise((r) => setTimeout(r, 5)); // distinct created_at, so the order is defined
    await call('/api/site-settings/theme', { ...put('zujaj'), roles: 'Super Admin', user: 's1' });
    const res = await call('/api/site-settings/theme/history', { roles: 'Moderator' });
    assert.equal(res.status, 200);
    const { result } = (await res.json()) as { result: { entries: { oldValue: string | null; newValue: string; actorId: string }[] } };
    assert.deepEqual(
      result.entries.map((e) => [e.oldValue, e.newValue, e.actorId]),
      [['nahas', 'zujaj', 's1'], [null, 'nahas', 'a1']],
    );
    const one = await call('/api/site-settings/theme/history?limit=1', { roles: 'Admin' });
    assert.equal(((await one.json()) as { result: { entries: unknown[] } }).result.entries.length, 1);
    assert.equal((await call('/api/site-settings/theme/history?limit=500', { roles: 'Admin' })).status, 400);
  });
});
