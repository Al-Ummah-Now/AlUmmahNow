/**
 * The DeepL API key on Caption settings (AUN-CAPTIONS DEEPL-KEY): super admins only, sealed into
 * SEARCH_DB service_credentials, never returned or audited (last4 and plan only), tested with
 * DeepL's /v2/usage (mocked here: no test calls DeepL), removable, and the Errors page Retry.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { openServiceCredential, type ServiceCredentialRow } from '@al-ummah/shared-types';
import contentRouter from '../src/routers/content.router';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import { registerStepUpRoutes } from '../src/middleware/step-up-routes';
import { sqliteD1 } from './d1-sqlite';

const INTERNAL = 'qa-internal-api-key-0123456789';
const PRO = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const FREE = `9a8b7c6d-5e4f-3a2b-1c0d-ffeeddccbbaa:fx`;

/** SEARCH_DB with the service_credentials migration (api-videos migrations/search 0069). */
function searchD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(process.cwd(), '..', 'api-videos', 'migrations', 'search', '0071_service_credentials.sql'), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql);
    const p = args.map((a) => (a === undefined ? null : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...p), success: true, meta: { changes: 0 } };
    const r = stmt.run(...p);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  };
  const st = (sql: string, args: unknown[] = []) => ({
    bind: (...n: unknown[]) => st(sql, n),
    first: async <T>() => (exec(sql, args).results[0] as T) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
  });
  return { prepare: (sql: string) => st(sql) } as unknown as D1Database;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** DeepL as recorded: /v2/usage per key; anything else fails the test. */
function deeplFetch(answers: Record<string, () => Response>): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const key = new Headers(init?.headers).get('authorization')?.replace('DeepL-Auth-Key ', '') ?? '';
    seen.push(`${url} ${key.slice(-4)}`);
    assert.match(url, /^https:\/\/api(-free)?\.deepl\.com\/v2\/usage$/);
    const answer = answers[key];
    assert.ok(answer, 'unexpected DeepL key');
    return answer();
  }) as typeof fetch;
  return seen;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function setup(deeplKeySource: 'admin' | 'binding' | null = null, opts: { stepUp?: boolean } = {}) {
  const env = {
    SEARCH_DB: searchD1(),
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: INTERNAL,
    ENVIRONMENT: 'qa',
    VIDEOS: {
      async fetch() {
        return json({ success: true, result: { settings: { translation: { deepl: true } }, editions: [], translations30d: [], deeplKeyBound: deeplKeySource !== null, deeplKeySource } });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = (c.req.header('x-test-roles') ?? '').split(',').filter(Boolean);
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'super-1', roles, email: 'owner@example.com', payload: { name: 'Owner' } } as never);
    await next();
  });
  if (opts.stepUp) registerStepUpRoutes(app);
  app.route('/api/content', contentRouter);
  const req = (path: string, init: RequestInit & { roles?: string; json?: unknown } = {}) => {
    const { roles = 'super_admin', json: body, ...rest } = init;
    const headers: Record<string, string> = { 'x-test-roles': roles };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return app.request(path, { ...rest, headers, body: body !== undefined ? JSON.stringify(body) : rest.body }, env as never);
  };
  return { req, env };
}

const row = async (env: { SEARCH_DB: D1Database }) => env.SEARCH_DB.prepare("SELECT * FROM service_credentials WHERE provider = 'deepl'").first<ServiceCredentialRow>();
const auditRows = async (env: { REPORTS_DB: D1Database }) =>
  ((await env.REPORTS_DB.prepare("SELECT key, old_value, new_value, actor_id FROM site_settings_log WHERE key = 'content:captions-settings:deepl-key' ORDER BY created_at, rowid").all<{ key: string; old_value: string | null; new_value: string; actor_id: string }>()).results ?? []);

describe('DeepL key on Caption settings', () => {

  it('replacing or removing the key needs a recent sign-in (step-up); the key test does not', async () => {
    // The test identity's token has no auth_time, so every step-up route answers 401 step_up_required
    const { req, env } = setup(null, { stepUp: true });
    const put = await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: `${'a'.repeat(36)}:fx` } });
    assert.equal(put.status, 401);
    assert.equal(((await put.json()) as { code?: string }).code, 'step_up_required');
    assert.equal((await req('/api/content/captions/deepl-key', { method: 'DELETE' })).status, 401);
    assert.equal(await row(env), null, 'nothing was stored');
    assert.equal((await req('/api/content/captions/deepl-key/test', { method: 'POST' })).status, 404, 'no key yet, but the test route ran');
  });
  it('only super admins set, test or remove it; admins see its state', async () => {
    const { req } = setup();
    for (const roles of ['admin', 'moderator']) {
      assert.equal((await req('/api/content/captions/deepl-key', { method: 'PUT', roles, json: { value: PRO } })).status, 403);
      assert.equal((await req('/api/content/captions/deepl-key/test', { method: 'POST', roles })).status, 403);
      assert.equal((await req('/api/content/captions/deepl-key', { method: 'DELETE', roles })).status, 403);
    }
    const view = (await (await req('/api/content/captions/settings', { roles: 'admin' })).json()) as { result: { deeplKey: { set: boolean; source: null } } };
    assert.equal(view.result.deeplKey.set, false);
    assert.equal(view.result.deeplKey.source, null);
  });

  it('sets a Pro key: sealed (never stored, returned or audited in clear), tested with /v2/usage, shown as last4 + plan + who', async () => {
    const { req, env } = setup();
    const seen = deeplFetch({ [PRO]: () => json({ character_count: 1200, character_limit: 1_000_000 }) });
    const res = await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: `  ${PRO}  ` } });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(PRO), 'the key never comes back');
    const out = JSON.parse(text) as { result: { deeplKey: Record<string, unknown>; test: Record<string, unknown> } };
    assert.deepEqual(out.result.test, { ok: true, code: 'ok', plan: 'pro', characterCount: 1200, characterLimit: 1_000_000, status: 200 });
    assert.equal(out.result.deeplKey.set, true);
    assert.equal(out.result.deeplKey.last4, '4a5b');
    assert.equal(out.result.deeplKey.plan, 'pro');
    assert.equal(out.result.deeplKey.source, 'admin');
    assert.equal(out.result.deeplKey.updatedByName, 'Owner');
    assert.deepEqual(out.result.deeplKey.test, { ok: true, code: 'ok', characterCount: 1200, characterLimit: 1_000_000, at: (out.result.deeplKey.test as { at: string }).at });
    assert.deepEqual(seen, ['https://api.deepl.com/v2/usage 4a5b']);

    const stored = (await row(env))!;
    assert.ok(!JSON.stringify(stored).includes(PRO));
    assert.equal(stored.key_id, 'ik1');
    assert.equal(await openServiceCredential(stored, INTERNAL), PRO);

    const audit = await auditRows(env);
    assert.equal(audit.length, 1);
    assert.ok(!JSON.stringify(audit).includes(PRO), 'the audit never holds the key');
    assert.deepEqual(JSON.parse(audit[0]!.new_value), { action: 'deepl-key-set', details: { last4: '4a5b', plan: 'pro' } });
    assert.equal(audit[0]!.actor_id, 'super-1');
  });

  it('a Free key (":fx") goes to api-free.deepl.com; replacing is audited with the previous last4', async () => {
    const { req, env } = setup();
    const seen = deeplFetch({ [PRO]: () => json({ character_count: 0, character_limit: 1 }), [FREE]: () => json({ character_count: 499_000, character_limit: 500_000 }) });
    await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: PRO } });
    const out = (await (await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: FREE } })).json()) as { result: { deeplKey: { plan: string; last4: string }; test: { plan: string } } };
    assert.equal(out.result.deeplKey.plan, 'free');
    assert.equal(out.result.deeplKey.last4, 'a:fx');
    assert.equal(out.result.test.plan, 'free');
    assert.equal(seen[1], 'https://api-free.deepl.com/v2/usage a:fx');
    const audit = await auditRows(env);
    assert.deepEqual(JSON.parse(audit[1]!.new_value), { action: 'deepl-key-replace', details: { last4: 'a:fx', plan: 'free' } });
    assert.deepEqual(JSON.parse(audit[1]!.old_value!), { last4: '4a5b', plan: 'pro' });
  });

  it('refuses a malformed key before sealing or calling DeepL', async () => {
    const { req, env } = setup();
    const seen = deeplFetch({});
    for (const value of ['short', `${PRO} space`, `${PRO}:zz`, 42]) {
      const res = await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value } });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { code: string }).code, 'invalid_key');
    }
    assert.equal(await row(env), null);
    assert.deepEqual(seen, []);
  });

  it('Test key reports a refused key and used-up characters, audited without the key', async () => {
    const { req, env } = setup();
    let status = 200;
    deeplFetch({ [PRO]: () => (status === 200 ? json({ character_count: 5, character_limit: 500_000 }) : json({ message: 'Forbidden' }, status)) });
    await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: PRO } });
    status = 403;
    const refused = (await (await req('/api/content/captions/deepl-key/test', { method: 'POST' })).json()) as { result: { test: { ok: boolean; code: string }; deeplKey: { test: { code: string } } } };
    assert.deepEqual([refused.result.test.ok, refused.result.test.code, refused.result.deeplKey.test.code], [false, 'invalid', 'invalid']);
    status = 456;
    const quota = (await (await req('/api/content/captions/deepl-key/test', { method: 'POST' })).json()) as { result: { test: { code: string } } };
    assert.equal(quota.result.test.code, 'quota');
    const audit = await auditRows(env);
    assert.deepEqual(audit.slice(1).map((a) => JSON.parse(a.new_value)), [
      { action: 'deepl-key-test', details: { last4: '4a5b', ok: false, code: 'invalid' } },
      { action: 'deepl-key-test', details: { last4: '4a5b', ok: false, code: 'quota' } },
    ]);
  });

  it('an INTERNAL_API_KEY rotation makes the key unreadable: shown as "set again", the bound secret takes over', async () => {
    const { req, env } = setup('binding');
    deeplFetch({ [PRO]: () => json({ character_count: 0, character_limit: 500_000 }) });
    await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: PRO } });
    env.INTERNAL_API_KEY = 'rotated-internal-api-key-000000';
    const view = (await (await req('/api/content/captions/settings', { roles: 'admin' })).json()) as { result: { deeplKey: { unreadable?: boolean; source: string } } };
    assert.equal(view.result.deeplKey.unreadable, true);
    assert.equal(view.result.deeplKey.source, 'binding');
    const tested = (await (await req('/api/content/captions/deepl-key/test', { method: 'POST' })).json()) as { result: { test: { code: string } } };
    assert.equal(tested.result.test.code, 'unreadable');
  });

  it('Remove deletes it (audited); a second remove or a test with nothing set is 404', async () => {
    const { req, env } = setup();
    deeplFetch({ [PRO]: () => json({ character_count: 0, character_limit: 500_000 }) });
    await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: PRO } });
    const res = await req('/api/content/captions/deepl-key', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { result: { deeplKey: { set: boolean } } }).result.deeplKey.set, false);
    assert.equal(await row(env), null);
    assert.equal((await req('/api/content/captions/deepl-key', { method: 'DELETE' })).status, 404);
    assert.equal((await req('/api/content/captions/deepl-key/test', { method: 'POST' })).status, 404);
    assert.deepEqual(JSON.parse((await auditRows(env)).at(-1)!.new_value), { action: 'deepl-key-remove', details: { last4: '4a5b' } });
  });

  it('a working key resolves the DeepL item on the Errors page; the Retry handler tests it again', async () => {
    const { req, env } = setup();
    let status = 403;
    deeplFetch({ [PRO]: () => (status === 200 ? json({ character_count: 0, character_limit: 500_000 }) : json({}, status)) });
    await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: PRO } });
    await env.REPORTS_DB.prepare(
      "INSERT INTO error_groups (id, fingerprint, environment, app, kind, message, first_seen, last_seen, updated_at) VALUES ('g1', 'f', 'qa', 'processor', 'action', 'DeepL', '2026-11-21T00:00:00Z', '2026-11-21T00:00:00Z', '2026-11-21T00:00:00Z')",
    ).run();
    await env.REPORTS_DB.prepare(
      "INSERT INTO error_actions (id, group_id, environment, item_key, app, source, title, status, created_at, updated_at) VALUES ('a1', 'g1', 'qa', 'deepl-key', 'processor', 'ai', 'DeepL refused the API key', 'open', '2026-11-21T00:00:00Z', '2026-11-21T00:00:00Z')",
    ).run();
    const stillOpen = await BUILTIN_RETRIES['deepl-key-test']!(env as never, {}, 'attempt-1');
    assert.deepEqual([stillOpen.ok, stillOpen.status], [false, 'open']);
    status = 200;
    const fixed = await BUILTIN_RETRIES['deepl-key-test']!(env as never, {}, 'attempt-2');
    assert.deepEqual([fixed.ok, fixed.status], [true, 'resolved']);
    const item = await env.REPORTS_DB.prepare("SELECT status FROM error_actions WHERE item_key = 'deepl-key'").first<{ status: string }>();
    assert.equal(item?.status, 'resolved');
  });
});

describe('Costs page DeepL line', () => {
  it('counts this month’s DeepL characters and prices them at the key’s plan', async () => {
    const { deeplMonth } = await import('../src/lib/costs');
    const { req, env } = setup();
    const now = new Date('2026-11-21T12:00:00Z');
    for (const [day, chars] of [['2026-10-31', 999_999], ['2026-11-02', 1_200_000], ['2026-11-20', 800_000]] as const) {
      await env.REPORTS_DB.prepare("INSERT INTO ai_usage_daily (day, model, feature, calls, input_tokens, output_tokens, neurons, usd) VALUES (?, 'deepl-pro', 'captions', 3, ?, 0, 0, 0)").bind(day, chars).run();
    }
    await env.REPORTS_DB.prepare("INSERT INTO ai_usage_daily (day, model, feature, calls, input_tokens, output_tokens, neurons, usd) VALUES ('2026-11-20', '@cf/google/gemma-4-26b-a4b-it', 'captions', 1, 5000, 5000, 1, 1)").run();
    const none = await deeplMonth(env as never, now);
    assert.deepEqual(none, { keySet: false, plan: null, characters: 2_000_000, calls: 6, costUsd: 0, reported: null });

    deeplFetch({ [PRO]: () => json({ character_count: 2_000_000, character_limit: 10_000_000 }) });
    await req('/api/content/captions/deepl-key', { method: 'PUT', json: { value: PRO } });
    const pro = await deeplMonth(env as never, now);
    assert.equal(pro.plan, 'pro');
    assert.equal(pro.costUsd, 55.49, '$5.49 base + 2M × $25/M');
    assert.equal(pro.reported?.characterLimit, 10_000_000);
  });
});
