/**
 * Age rules (E20-B2, wiki E20 §5.2): the saved ages (who may, version guard, audit, history) and the three checks
 * that let the switch be turned on, each failing closed.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { SUGGESTED_AGE_NUMBERS, SWITCHES_TTL_MS, forgetAgeRules, forgetFeatureSwitches, parseAgeNumbers, readAgeRules, writeAgeRules, type AgeNumbers } from '@al-ummah/shared-types';
import { AgeRulesHistorySchema, AgeRulesSavedSchema, AgeRulesViewSchema } from '../src/endpoints/ageRules/AgeRules';
import { app as adminApi } from '../src/index';
import ageRulesRouter from '../src/routers/ageRules.router';
import { ageRulesChecks } from '../src/lib/age-rules-checks';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { sqliteD1 } from './d1-sqlite';

function searchD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  let failing = '';
  const exec = (sql: string, args: unknown[]) => {
    if (failing && sql.includes(failing)) throw new Error('D1 down');
    const stmt = raw.prepare(sql);
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...(args as never[])).map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
    return { results: [], success: true, meta: { changes: Number(stmt.run(...(args as never[])).changes) } };
  };
  const statement = (sql: string, args: unknown[] = []): any => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => exec(sql, args).results[0] ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  return { raw, prepare: (sql: string) => statement(sql), batch: async (list: any[]) => list.map((s) => s._exec()), fail: (text: string) => { failing = text; } };
}

const NUMBERS: AgeNumbers = { ...SUGGESTED_AGE_NUMBERS };

function setup(roles: string[], userId = 'usr_super') {
  const search = searchD1();
  const reports = sqliteD1();
  const env = { SEARCH_DB: search, REPORTS_DB: reports } as any;
  const app = new Hono();
  app.use('*', errorEnvelope);
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId, roles } as never);
    await next();
  });
  const openapi = fromHono(app as never);
  openapi.route('/api/age-rules', ageRulesRouter as never);
  const call = async (method: string, path = '', json?: unknown) => {
    const res = await app.request(`/api/age-rules${path}`, { method, ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }) }, env);
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const log = () => reports.prepare("SELECT old_value, new_value, actor_id FROM site_settings_log WHERE key = 'age-rules' ORDER BY rowid").all<any>().then((r: any) => r.results);
  return { search, reports, env, call, log };
}

beforeEach(() => {
  forgetAgeRules();
  forgetFeatureSwitches();
});

describe('the numbers', () => {
  it('every key, each 13, 16 or 18, and nothing else', () => {
    assert.deepEqual(parseAgeNumbers(NUMBERS), NUMBERS);
    for (const bad of [null, [], 'x', {}, { ...NUMBERS, extra: 13 }, { ...NUMBERS, liveChat: 12 }, { ...NUMBERS, liveChat: 14 }, { ...NUMBERS, liveChat: '13' }, { ...NUMBERS, liveChat: undefined }, { ...NUMBERS, comment: 13 }, Object.fromEntries(Object.entries(NUMBERS).slice(1))]) {
      assert.equal(parseAgeNumbers(bad), null, JSON.stringify(bad));
    }
  });

  it('are read at most every 30 s, null when never saved, and an unreadable or invalid row throws', async () => {
    const { env, search } = setup([]);
    assert.equal(await readAgeRules(env, { now: 1000 }), null);
    search.raw.prepare("INSERT INTO age_rules (id, json, version, updated_by, updated_at) VALUES (1, ?, 1, 'a', 'b')").run(JSON.stringify(NUMBERS));
    assert.equal(await readAgeRules(env, { now: 1000 + SWITCHES_TTL_MS - 1 }), null);
    assert.deepEqual((await readAgeRules(env, { now: 1000 + SWITCHES_TTL_MS }))?.numbers, NUMBERS);
    search.raw.exec(`UPDATE age_rules SET json = '{"liveChat":5}'`);
    await assert.rejects(readAgeRules(env, { fresh: true }));
    search.raw.exec(`UPDATE age_rules SET json = 'nope'`);
    await assert.rejects(readAgeRules(env, { fresh: true }));
    search.fail('age_rules');
    await assert.rejects(readAgeRules(env, { fresh: true }));
    await assert.rejects(readAgeRules({}, { fresh: true }));
  });

  it('a write at another version changes nothing', async () => {
    const { env } = setup([]);
    const first = await writeAgeRules(env, { numbers: NUMBERS, expectedVersion: 0, actorId: 'a' });
    assert.equal(first?.version, 1);
    assert.equal(await writeAgeRules(env, { numbers: { ...NUMBERS, liveChat: 18 }, expectedVersion: 0, actorId: 'b' }), null);
    assert.equal(await writeAgeRules(env, { numbers: { ...NUMBERS, liveChat: 18 }, expectedVersion: 2, actorId: 'b' }), null);
    assert.equal((await readAgeRules(env, { fresh: true }))?.numbers.liveChat, 16);
    assert.equal((await writeAgeRules(env, { numbers: { ...NUMBERS, liveChat: 18 }, expectedVersion: 1, actorId: 'b' }))?.version, 2);
  });
});

describe('/api/age-rules', () => {
  it('starts unsaved with the suggested ages, the switch off and three failing checks', async () => {
    const t = setup(['super_admin']);
    const { status, body } = await t.call('GET');
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual([body.result.numbers, body.result.suggested, body.result.version, body.result.switchOn, body.result.canEdit], [null, NUMBERS, 0, false, true]);
    assert.deepEqual(body.result.checks.map((c: any) => [c.key, c.ok]), [['birthDate', false], ['numbers', false], ['accountEvents', false]]);
  });

  it('a super admin saves, the change is audited and listed, and saving the same again changes nothing', async () => {
    const t = setup(['super_admin']);
    assert.deepEqual((await t.call('PUT', '', { numbers: NUMBERS, expectedVersion: 0 })).body, { success: true, changed: true, result: { numbers: NUMBERS, version: 1 } });
    const next = { ...NUMBERS, liveChat: 18 };
    assert.equal((await t.call('PUT', '', { numbers: next, expectedVersion: 1 })).body.result.version, 2);
    assert.equal((await t.call('PUT', '', { numbers: next, expectedVersion: 2 })).body.changed, false);
    const read = (await t.call('GET')).body.result;
    assert.deepEqual([read.numbers, read.version, read.updatedBy.id, read.checks[1].ok], [next, 2, 'usr_super', true]);
    assert.equal((await t.log()).length, 2);
    const { entries } = (await t.call('GET', '/history')).body.result;
    assert.deepEqual(entries.map((e: any) => [e.from?.liveChat ?? null, e.to.liveChat, e.actorId]), [[16, 18, 'usr_super'], [null, 16, 'usr_super']]);
  });

  it('a stale version is 409 and leaves no audit row', async () => {
    const t = setup(['super_admin']);
    await t.call('PUT', '', { numbers: NUMBERS, expectedVersion: 0 });
    for (const expectedVersion of [0, 2]) {
      const r = await t.call('PUT', '', { numbers: { ...NUMBERS, support: 16 }, expectedVersion });
      assert.deepEqual([r.status, r.body.code], [409, 'age_rules_changed']);
    }
    assert.equal((await t.log()).length, 1);
    assert.equal((await t.call('GET')).body.result.numbers.support, 18);
  });

  it('refuses anything that is not the numbers', async () => {
    const t = setup(['super_admin']);
    for (const body of [{}, { numbers: NUMBERS }, { numbers: { ...NUMBERS, support: 12 }, expectedVersion: 0 }, { numbers: { ...NUMBERS, comment: 16 }, expectedVersion: 0 }, { numbers: { ...NUMBERS, upload: 18, post: 13 }, expectedVersion: 0 }, { numbers: NUMBERS, expectedVersion: -1 }, { numbers: NUMBERS, expectedVersion: '0' }]) {
      assert.equal((await t.call('PUT', '', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await t.log()).length, 0);
  });

  it('an admin and a moderator read and change nothing; a reviewer sees nothing', async () => {
    for (const role of ['admin', 'moderator']) {
      const t = setup([role]);
      assert.equal((await t.call('GET')).body.result.canEdit, false);
      assert.equal((await t.call('PUT', '', { numbers: NUMBERS, expectedVersion: 0 })).status, 403);
      assert.equal((await t.log()).length, 0);
    }
    const reviewer = setup(['content_reviewer']);
    for (const [method, path] of [['GET', ''], ['GET', '/history']]) assert.equal((await reviewer.call(method!, path)).status, 403);
  });

  it('a write that fails leaves no audit row and answers an error', async () => {
    const t = setup(['super_admin']);
    t.search.fail('INSERT INTO age_rules');
    assert.ok((await t.call('PUT', '', { numbers: NUMBERS, expectedVersion: 0 })).status >= 500);
    assert.equal((await t.log()).length, 0);
  });
});

describe('the OpenAPI contract', () => {
  const document = async () => (await (await adminApi.request('/openapi.json', {}, {} as never)).json()) as any;

  it('documents the three operations, the three limits and every answer', async () => {
    const { paths } = await document();
    const main = paths['/api/age-rules'];
    const history = paths['/api/age-rules/history'];
    assert.deepEqual(Object.keys(main).sort(), ['get', 'put']);
    assert.deepEqual(Object.keys(history), ['get']);
    const body = main.put.requestBody.content['application/json'].schema;
    assert.deepEqual([...body.required].sort(), ['expectedVersion', 'numbers']);
    assert.deepEqual([Object.keys(body.properties.numbers.properties).sort(), body.properties.numbers.additionalProperties], [['ageRestricted', 'liveChat', 'support'], false]);
    for (const key of ['liveChat', 'support', 'ageRestricted']) {
      const age = JSON.stringify(body.properties.numbers.properties[key]);
      for (const choice of ['13', '16', '18']) assert.ok(age.includes(choice), `${key}: ${age}`);
    }
    for (const status of ['200', '400', '401', '403', '409']) assert.ok(main.put.responses[status], status);
    for (const op of [main.get, history.get]) for (const status of ['200', '401', '403']) assert.ok(op.responses[status], status);
    assert.deepEqual(history.get.parameters.map((p: any) => p.name), ['limit']);
  });

  it('what is answered is what is documented, and what is refused is refused as documented', async () => {
    const t = setup(['super_admin']);
    AgeRulesViewSchema.parse((await t.call('GET')).body);
    AgeRulesSavedSchema.parse((await t.call('PUT', '', { numbers: NUMBERS, expectedVersion: 0 })).body);
    AgeRulesSavedSchema.parse((await t.call('PUT', '', { numbers: { ...NUMBERS, liveChat: 18 }, expectedVersion: 1 })).body);
    AgeRulesViewSchema.parse((await t.call('GET')).body);
    AgeRulesHistorySchema.parse((await t.call('GET', '/history?limit=1')).body);
    assert.equal((await t.call('GET', '/history?limit=1')).body.result.entries.length, 1);
    for (const limit of ['0', '51', 'x']) assert.equal((await t.call('GET', `/history?limit=${limit}`)).status, 400);
  });
});

describe('the three checks fail closed', () => {
  const ISSUER = 'https://auth.test.example';
  const now = Date.parse('2026-11-24T12:00:00Z');
  const discovery = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const on = discovery({ issuer: ISSUER, claims_supported: ['sub', 'age_band'] });
  const state = async (env: unknown, fetchImpl: typeof fetch) => Object.fromEntries((await ageRulesChecks(env as never, { fetchImpl, now })).map((c) => [c.key, c.ok]));

  it('the date of birth: only our issuer’s own document that lists age_band', async () => {
    const { env } = setup([]);
    env.Issuer = ISSUER;
    assert.equal((await state(env, on)).birthDate, true);
    for (const bad of [
      discovery({ issuer: ISSUER, claims_supported: ['sub'] }),
      discovery({ issuer: ISSUER }),
      discovery({ issuer: ISSUER, claims_supported: 'age_band' }),
      discovery({ issuer: 'https://evil.example', claims_supported: ['age_band'] }),
      discovery({ claims_supported: ['age_band'] }),
      discovery({ issuer: ISSUER, claims_supported: ['age_band'] }, 503),
      (async () => new Response('<html>')) as unknown as typeof fetch,
      (async () => { throw new Error('unreachable'); }) as unknown as typeof fetch,
    ]) assert.equal((await state(env, bad)).birthDate, false);
    delete env.Issuer;
    assert.equal((await state(env, on)).birthDate, false);
  });

  it('the request has a time limit and carries no credentials', async () => {
    const { env } = setup([]);
    env.Issuer = `${ISSUER}/`;
    let seen: { url: string; init: RequestInit } | null = null;
    await state(env, (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response('{}'))) as unknown as typeof fetch);
    assert.equal(seen!.url, `${ISSUER}/.well-known/openid-configuration`);
    assert.ok(seen!.init.signal);
    assert.deepEqual(Object.keys(seen!.init.headers as object), ['Accept']);
  });

  it('the numbers: saved and readable', async () => {
    const { env, search } = setup([]);
    assert.equal((await state(env, on)).numbers, false);
    await writeAgeRules(env, { numbers: NUMBERS, expectedVersion: 0, actorId: 'a' });
    assert.equal((await state(env, on)).numbers, true);
    search.fail('FROM age_rules');
    assert.equal((await state(env, on)).numbers, false);
    assert.equal((await state({}, on)).numbers, false);
  });

  it('account events: a valid one in the last 48 hours, not one from the future', async () => {
    const { env, search } = setup([]);
    const HOUR = 3_600_000;
    assert.equal((await state(env, on)).accountEvents, false);
    for (const [at, ok] of [[now, true], [now - 48 * HOUR, true], [now - 48 * HOUR - 1, false], [now + HOUR, false]] as const) {
      search.raw.prepare('INSERT OR REPLACE INTO account_event_status (id, last_valid_at) VALUES (1, ?)').run(at);
      assert.equal((await state(env, on)).accountEvents, ok, String(at - now));
    }
    search.fail('account_event_status');
    assert.equal((await state(env, on)).accountEvents, false);
  });

  it('every refusal has both languages and its own code; Arabic has no Western digits', async () => {
    const checks = await ageRulesChecks({}, { fetchImpl: on, now });
    assert.equal(new Set(checks.map((c) => c.reasonKey)).size, 3);
    for (const c of checks) assert.ok(c.reason.en && c.reason.ar && !/[0-9]/.test(c.reason.ar));
  });
});
