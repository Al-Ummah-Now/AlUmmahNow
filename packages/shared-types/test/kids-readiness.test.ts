import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  KIDS_DECISION_IDS,
  KIDS_TURN_ON_REASONS,
  kidsCanTurnOn,
  kidsCanTurnOnHook,
  kidsReadiness,
} from '../src/kids-readiness.ts';

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE kids_policy_settings (
      key TEXT PRIMARY KEY,
      decisions_json TEXT NOT NULL,
      legal_approved INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE kids_catalog_items (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE kids_learning_paths (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
  `);
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true };
    stmt.run(...params);
    return { results: [], success: true };
  };
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...next: unknown[]) => stmt(sql, next),
    first: async () => (exec(sql, args).results[0] as unknown) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
  });
  return { raw, prepare: (sql: string) => stmt(sql) };
}

test('kidsReadiness requires all decisions, legal approval, and at least one catalog or path item', () => {
  const allDecided = Object.fromEntries(KIDS_DECISION_IDS.map((id) => [id, 'Option A']));
  assert.deepEqual(
    kidsReadiness({ decisions: null, legalApproved: false, hasCatalogContent: false }),
    {
      ready: false,
      blockers: ['decisions_open', 'legal_not_approved', 'no_catalog_content'],
      openDecisions: [...KIDS_DECISION_IDS],
    },
  );
  assert.deepEqual(
    kidsReadiness({ decisions: { 'KIDS-D1': 'Option A' }, legalApproved: true, hasCatalogContent: true }),
    {
      ready: false,
      blockers: ['decisions_open'],
      openDecisions: KIDS_DECISION_IDS.filter((id) => id !== 'KIDS-D1'),
    },
  );
  assert.deepEqual(
    kidsReadiness({ decisions: allDecided, legalApproved: true, hasCatalogContent: true }),
    { ready: true, blockers: [], openDecisions: [] },
  );
});

test('kidsCanTurnOn fails closed without SEARCH_DB or when tables do not exist yet', async () => {
  const noDb = await kidsCanTurnOn({});
  assert.equal(noDb.ready, false);
  assert.deepEqual(noDb.blockers, ['decisions_open', 'legal_not_approved', 'no_catalog_content']);

  const emptyDb = { prepare: () => ({ first: async () => { throw new Error('no such table: kids_policy_settings'); } }) };
  const noTables = await kidsCanTurnOnHook({ SEARCH_DB: emptyDb as never });
  assert.equal(noTables.ok, false);
  if (!noTables.ok) {
    assert.equal(noTables.reasonKey, 'decisions_open');
    assert.deepEqual(noTables.reason, KIDS_TURN_ON_REASONS.decisions_open);
  }
});

test('kidsCanTurnOn passes only when decisions, legal sign-off, and approved content exist', async () => {
  const db = makeDb();
  const allDecided = JSON.stringify(Object.fromEntries(KIDS_DECISION_IDS.map((id) => [id, 'Option A'])));
  db.raw.prepare('INSERT INTO kids_policy_settings (key, decisions_json, legal_approved) VALUES (?, ?, ?)').run('default', allDecided, 0);
  const notLegal = await kidsCanTurnOnHook({ SEARCH_DB: db as never });
  assert.equal(notLegal.ok, false);
  if (!notLegal.ok) assert.equal(notLegal.reasonKey, 'legal_not_approved');

  db.raw.prepare("UPDATE kids_policy_settings SET legal_approved = 1 WHERE key = 'default'").run();
  const noCatalog = await kidsCanTurnOnHook({ SEARCH_DB: db as never });
  assert.equal(noCatalog.ok, false);
  if (!noCatalog.ok) assert.equal(noCatalog.reasonKey, 'no_catalog_content');

  db.raw.prepare('INSERT INTO kids_catalog_items (id, status) VALUES (?, ?)').run('item_1', 'approved');
  const ready = await kidsCanTurnOnHook({ SEARCH_DB: db as never });
  assert.deepEqual(ready, { ok: true });
});
