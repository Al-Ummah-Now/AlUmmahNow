import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readSiteTheme, writeSiteTheme } from '../src/lib/siteSettings';

/** Just enough D1 for the two site-settings tables. */
function fakeDb() {
  const settings = new Map<string, { value: string; updated_by: string; updated_at: string }>();
  const log: unknown[][] = [];
  const statement = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => settings.get(args[0] as string) ?? null,
    run() {
      if (sql.includes('site_settings_log')) log.push(args);
      else settings.set(args[0] as string, { value: args[1] as string, updated_by: args[2] as string, updated_at: args[3] as string });
    },
  });
  const db = { prepare: (sql: string) => statement(sql), batch: async (list: { run(): void }[]) => list.forEach((s) => s.run()) };
  return { db: db as unknown as D1Database, log, settings };
}

describe('site theme setting', () => {
  it('is fawanees when unset', async () => {
    const { db } = fakeDb();
    assert.deepEqual(await readSiteTheme(db), { theme: 'fawanees', version: null, isDefault: true, updatedBy: null, updatedAt: null });
  });

  it('falls back to fawanees for a value that is not a theme', async () => {
    const { db, settings } = fakeDb();
    settings.set('site.theme', { value: 'neon', updated_by: 'a', updated_at: 't' });
    assert.equal((await readSiteTheme(db)).theme, 'fawanees');
  });

  it('saves the theme and one audit row', async () => {
    const { db, log } = fakeDb();
    assert.equal(await writeSiteTheme(db, 'nahas', 'admin1', 'log1', 'now'), true);
    assert.equal((await readSiteTheme(db)).theme, 'nahas');
    assert.deepEqual(log, [['log1', 'site.theme', null, 'nahas', 'admin1', 'now']]);
  });

  it('writes no audit row when nothing changes', async () => {
    const { db, log } = fakeDb();
    await writeSiteTheme(db, 'nahas', 'admin1', 'log1', 'now');
    assert.equal(await writeSiteTheme(db, 'nahas', 'admin1', 'log2', 'later'), false);
    assert.equal(log.length, 1);
  });
});
