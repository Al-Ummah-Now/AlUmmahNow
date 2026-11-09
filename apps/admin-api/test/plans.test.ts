import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as p from '../src/lib/plans';

const MIGRATIONS = join(__dirname, '..', 'migrations');

function env() {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  const prepare = (sql: string) => {
    let params: any[] = [];
    const s: any = {
      bind: (...v: any[]) => ((params = v.map((x) => (x === undefined ? null : x))), s),
      first: async () => (raw.prepare(sql).get(...params) as any) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...params) }),
      run: async () => raw.prepare(sql).run(...params),
    };
    return s;
  };
  const deleted: string[] = [];
  return {
    raw,
    deleted,
    REPORTS_DB: {
      prepare,
      batch: async (statements: any[]) => {
        raw.exec('BEGIN');
        try {
          for (const s of statements) await s.run();
          raw.exec('COMMIT');
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      },
    },
    RATE_LIMIT_KV: { delete: async (k: string) => void deleted.push(k) },
  };
}

let n = 0;
const actor: p.Actor = { id: 'admin1', now: '2026-11-08T00:00:00.000Z', newId: () => `id${++n}` };
const user: p.SubjectRef = { type: 'user', id: 'u1' };
const audits = (e: ReturnType<typeof env>) => (e.raw.prepare('SELECT action FROM plan_audit_log').all() as any[]).map((r) => r.action);
const must = <T,>(o: p.Outcome<T>): any => {
  assert.equal(o.ok, true, JSON.stringify(o));
  return (o as any).result;
};
const failed = (o: p.Outcome, status: number) => {
  assert.equal(o.ok, false);
  assert.equal((o as any).status, status);
};
const activePlus = async (e: ReturnType<typeof env>) => must(await p.publishPlan(e as any, actor, 'plan_plus'));

describe('plan versioning', () => {
  it('edits to an active plan wait for publish, and shows the diff', async () => {
    const e = env();
    const r = must(await p.setPlanValues(e as any, actor, 'plan_free', { 'channel.max': 3 }));
    assert.equal(r.editableVersion, 2);
    assert.equal(r.plan.version, 1);
    assert.equal(r.published['channel.max'], 1);
    assert.ok(r.diff.some((d: any) => d.key === 'channel.max' && d.before === 1 && d.after === 3));
  });

  it('publish bumps the version and invalidates the default-plan cache', async () => {
    const e = env();
    await p.setPlanValues(e as any, actor, 'plan_free', { 'channel.max': 3 });
    const r = must(await p.publishPlan(e as any, actor, 'plan_free'));
    assert.equal(r.plan.version, 2);
    assert.deepEqual(e.deleted, [p.DEFAULT_PLAN_CACHE_KEY]);
  });

  it('keeps a subscriber on its version until migrated; dry run writes nothing', async () => {
    const e = env();
    await activePlus(e);
    await p.assignPlan(e as any, actor, user, { planId: 'plan_plus', status: 'active', reason: 'r' });
    await p.setPlanValues(e as any, actor, 'plan_plus', { 'channel.max': 9 });
    await p.publishPlan(e as any, actor, 'plan_plus');
    const version = () => (e.raw.prepare("SELECT plan_version v FROM subscriptions WHERE status='active'").get() as any).v;
    assert.equal(version(), 1);
    assert.deepEqual(must(await p.migrateSubscribers(e as any, actor, 'plan_plus', false, '')), { affected: 1, applied: false, toVersion: 2 });
    assert.equal(version(), 1);
    assert.ok(!audits(e).includes('plan.migrate'));
    failed(await p.migrateSubscribers(e as any, actor, 'plan_plus', true, ' '), 400);
    assert.equal(must(await p.migrateSubscribers(e as any, actor, 'plan_plus', true, 'notice sent')).affected, 1);
    assert.equal(version(), 2);
  });

  it('rejects unknown keys and invalid values', async () => {
    const e = env();
    failed(await p.setPlanValues(e as any, actor, 'plan_free', { nope: 1 }), 400);
    failed(await p.setPlanValues(e as any, actor, 'plan_free', { 'channel.max': -1 }), 400);
  });

  it('will not archive the default plan', async () => {
    failed(await p.archivePlan(env() as any, actor, 'plan_free'), 409);
  });

  it('will not edit or publish an archived plan', async () => {
    const e = env();
    must(await p.archivePlan(e as any, actor, 'plan_plus'));
    failed(await p.setPlanValues(e as any, actor, 'plan_plus', {}), 409);
    failed(await p.publishPlan(e as any, actor, 'plan_plus'), 409);
  });

  it('clones published values into a new draft and refuses a duplicate slug', async () => {
    const e = env();
    const r = must(await p.createPlan(e as any, actor, { slug: 'partner', name_en: 'P', name_ar: 'ب', audience: 'creator' }, 'plan_free'));
    assert.equal(r.plan.status, 'draft');
    assert.equal(r.draft['channel.max'], 1);
    failed(await p.createPlan(e as any, actor, { slug: 'partner', name_en: 'P', name_ar: 'ب', audience: 'creator' }), 409);
    failed(await p.createPlan(e as any, actor, { slug: 'Bad Slug', name_en: 'P', name_ar: 'ب', audience: 'creator' }), 400);
  });
});

describe('assignments and overrides', () => {
  it('needs an active plan and a reason', async () => {
    const e = env();
    failed(await p.assignPlan(e as any, actor, user, { planId: 'plan_plus', status: 'active', reason: 'r' }), 409);
    await activePlus(e);
    failed(await p.assignPlan(e as any, actor, user, { planId: 'plan_plus', status: 'active', reason: '  ' }), 400);
    failed(await p.assignPlan(e as any, actor, user, { planId: 'plan_plus', status: 'trialing', reason: 'r' }), 400);
  });

  it('replaces a live assignment and invalidates that subject', async () => {
    const e = env();
    await activePlus(e);
    await p.assignPlan(e as any, actor, user, { planId: 'plan_plus', status: 'active', reason: 'a' });
    e.deleted.length = 0;
    const r = must(await p.assignPlan(e as any, actor, user, { planId: 'plan_free', status: 'active', reason: 'b' }));
    assert.equal(r.subscription.slug, 'free');
    assert.deepEqual(e.deleted, ['entitlements:v1:user:u1']);
    assert.equal((e.raw.prepare("SELECT COUNT(*) n FROM subscriptions WHERE status='canceled'").get() as any).n, 1);
  });

  it('sets, replaces and removes an override for an affected user', async () => {
    const e = env();
    let r = must(await p.setOverride(e as any, actor, user, { key: 'channel.max', value: 2, reason: 'grandfathered' }));
    assert.equal(r.overrides[0].value, 2);
    r = must(await p.setOverride(e as any, actor, user, { key: 'channel.max', value: 'unlimited', reason: 'partner' }));
    assert.equal(r.overrides.length, 1);
    assert.equal(r.overrides[0].value, 'unlimited');
    r = must(await p.removeOverride(e as any, actor, user, 'channel.max', 'ended'));
    assert.equal(r.overrides.length, 0);
    assert.deepEqual(e.deleted, ['entitlements:v1:user:u1', 'entitlements:v1:user:u1', 'entitlements:v1:user:u1']);
  });

  it('validates overrides against the catalogue and requires a reason', async () => {
    const e = env();
    failed(await p.setOverride(e as any, actor, user, { key: 'nope', value: 1, reason: 'r' }), 400);
    failed(await p.setOverride(e as any, actor, user, { key: 'channel.max', value: 1, reason: ' ' }), 400);
    failed(await p.setOverride(e as any, actor, user, { key: 'channel.max', value: 1, reason: 'r', expiresAt: 'soon' }), 400);
  });

  it('audits every write with who and why', async () => {
    const e = env();
    await activePlus(e);
    await p.assignPlan(e as any, actor, user, { planId: 'plan_plus', status: 'active', reason: 'why' });
    await p.cancelAssignment(e as any, actor, user, 'done');
    await p.setOverride(e as any, actor, user, { key: 'channel.max', value: 2, reason: 'x' });
    await p.removeOverride(e as any, actor, user, 'channel.max', 'y');
    assert.deepEqual(audits(e).sort(), ['assignment.cancel', 'assignment.set', 'override.remove', 'override.set', 'plan.publish']);
    const row = e.raw.prepare("SELECT actor_id, reason FROM plan_audit_log WHERE action='assignment.set'").get() as any;
    assert.deepEqual({ ...row }, { actor_id: 'admin1', reason: 'why' });
  });

  it('a failed cache delete does not fail the write', async () => {
    const e = env();
    e.RATE_LIMIT_KV.delete = async () => {
      throw new Error('KV down');
    };
    must(await p.setOverride(e as any, actor, user, { key: 'channel.max', value: 2, reason: 'x' }));
  });

  it('parses subjects strictly', () => {
    assert.deepEqual(p.parseSubject('channel:c1'), { type: 'channel', id: 'c1' });
    for (const bad of ['organisation:1', 'c1', 'user:', ':x']) assert.equal(p.parseSubject(bad), null, bad);
  });
});

describe('admin-only guard', () => {
  it('uses hasAdminRole on every plan endpoint', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'endpoints', 'plans', 'index.ts'), 'utf8');
    assert.match(src, /if \(!hasAdminRole\(c\.get\('auth'\)\?\.roles\)\)/);
    assert.equal((src.match(/extends AdminRoute/g) ?? []).length, 1);
  });
});
