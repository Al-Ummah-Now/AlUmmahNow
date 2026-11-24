/**
 * The Features page's contract with this API (wiki AUN-FEATURES §3–§5): admin-web reads every
 * /api/features answer with shared-types features-api.ts. These tests run the real router and feed its
 * real answers (list, history, a direct write, 409 feature_changed, 409 feature_precondition and the
 * 202 of a change sent for approval) through those readers, so a change on either side fails here.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import {
  FEATURE_REGISTRY,
  forgetFeatureSwitches,
  readFeatureHistory,
  readFeatureList,
  readFeatureRefusal,
  readFeatureWrite,
  type FeatureStateReport,
} from '@al-ummah/shared-types';
import { createFeaturesRouter } from '../src/routers/features.router';
import { errorEnvelope } from '../src/middleware/error-envelope';
import type { FeaturePrecondition } from '../src/lib/feature-preconditions';
import { sqliteD1 } from './d1-sqlite';

function searchD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
    return { results: [], success: true, meta: { changes: Number(stmt.run(...params).changes) } };
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...v: unknown[]) => statement(sql, v),
    first: async () => (exec(sql, args).results as unknown[])[0] ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _run: () => exec(sql, args),
  });
  return {
    raw,
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { _run: () => unknown }[]) => {
      raw.exec('BEGIN');
      try {
        const out = stmts.map((s) => s._run());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const STATE: FeatureStateReport = { legacy: {}, ready: {} };
const REASON = { en: 'Creator support can’t be switched on yet: the organization isn’t formed.', ar: 'لا يمكن تشغيل دعم صنّاع المحتوى بعد: لم تُؤسَّس المنظمة.' };

function setup(checks: Record<string, FeaturePrecondition>) {
  forgetFeatureSwitches();
  const env = {
    SEARCH_DB: searchD1(),
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: { fetch: async () => Response.json({ success: true, result: STATE }) },
  };
  const app = new Hono();
  app.use('*', errorEnvelope);
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'sa1', roles: ['super_admin'], payload: { auth_time: Math.floor(Date.now() / 1000) } } as never);
    await next();
  });
  app.route('/api/features', createFeaturesRouter(checks as never));
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await app.request(`/api/features${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-App-Locale': 'ar' } }, env as never);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const put = (key: string, json: unknown) => call(`/${key}`, { method: 'PUT', body: JSON.stringify(json) });
  return { call, put };
}

beforeEach(() => forgetFeatureSwitches());

describe('admin-web reads /api/features as admin-api answers it', () => {
  it('list: every row, in registry order, from the { success, result: { items } } envelope', async () => {
    const t = setup({ creatorSupport: async () => ({ ok: true }) });
    const { status, body } = await t.call('');
    assert.equal(status, 200);
    const items = readFeatureList(body);
    assert.deepEqual(items.map((i) => i.key), FEATURE_REGISTRY.map((d) => d.key));
    const row = items.find((i) => i.key === 'newsletter')!;
    assert.equal(typeof row.enabled, 'boolean');
    assert.equal(row.version, 0);
    assert.equal(row.updatedBy, null);
    assert.equal(row.pending, null);
  });

  it('a direct write (200), then its history page', async () => {
    const t = setup({ creatorSupport: async () => ({ ok: true }) });
    const res = await t.put('newsletter', { enabled: false, expectedVersion: 0 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(readFeatureWrite(res.body, { enabled: false, expectedVersion: 0 }), { ok: true, data: { previous: true, enabled: false, version: 1 } });

    const history = await t.call('/newsletter/history');
    assert.equal(history.status, 200);
    const page = readFeatureHistory(history.body);
    assert.equal(page.entries.length, 1);
    const [entry] = page.entries;
    assert.equal(entry.newEnabled, false);
    assert.equal(entry.source, 'features_page');
    assert.equal(entry.actor.id, 'sa1');
    assert.ok(entry.actor.name === null || typeof entry.actor.name === 'string', 'a name or null, never undefined');
    assert.equal(typeof entry.createdAt, 'string');
    assert.equal(page.nextCursor, null);
  });

  it('409 feature_changed: the stored value and version now', async () => {
    const t = setup({ creatorSupport: async () => ({ ok: true }) });
    await t.put('newsletter', { enabled: false, expectedVersion: 0 });
    const res = await t.put('newsletter', { enabled: true, expectedVersion: 0 });
    assert.equal(res.status, 409);
    assert.deepEqual(readFeatureRefusal(res.status, res.body), { ok: false, kind: 'changed', current: { enabled: false, version: 1 } });
  });

  it('409 feature_precondition: the reason in both languages and its code, whatever the request language', async () => {
    const t = setup({ creatorSupport: async () => ({ ok: false, reason: REASON, reasonKey: 'organization_not_formed' }) });
    const res = await t.put('creatorSupport', { enabled: true, expectedVersion: 0, reason: 'r' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.deepEqual(readFeatureRefusal(res.status, res.body), { ok: false, kind: 'precondition', reason: REASON, reasonKey: 'organization_not_formed' });
  });

  it('202 pending_approval: the request id, and the list then shows the change waiting', async () => {
    const t = setup({ creatorSupport: async () => ({ ok: true }) });
    const res = await t.put('creatorSupport', { enabled: true, expectedVersion: 0, reason: 'The organization is formed' });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const out = readFeatureWrite(res.body, { enabled: true, expectedVersion: 0 });
    assert.equal(out.ok, false);
    assert.ok(!out.ok && out.kind === 'pending' && out.requestId.length > 0 && out.enabled === true, JSON.stringify(out));
    const list = readFeatureList((await t.call('')).body);
    assert.deepEqual(list.find((i) => i.key === 'creatorSupport')!.pending, { requestId: (out as { requestId: string }).requestId, enabled: true });
  });

  it('any other refusal is left to the server message', async () => {
    const t = setup({});
    const res = await t.put('notAFeature', { enabled: true, expectedVersion: 0 });
    assert.equal(res.status, 404);
    assert.equal(readFeatureRefusal(res.status, res.body), null);
    assert.equal(typeof res.body.message, 'string');
  });
});
