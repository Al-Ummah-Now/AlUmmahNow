/**
 * The Features page API (FEAT-4, wiki AUN-FEATURES §3–§5.3): who may read and change switches,
 * the stored → effective view with old settings and set-up state, the version guard, the
 * precondition refusal, the audit row, history, and /public/features following the newsletter switch.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { FEATURE_KEYS, forgetFeatureSwitches, type FeatureStateReport } from '@al-ummah/shared-types';
import { createFeaturesRouter } from '../src/routers/features.router';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { publicFeatures } from '../src/lib/public-features';
import { sqliteD1 } from './d1-sqlite';

function searchD1(beforeMigration?: (file: string, raw: DatabaseSync) => void) {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    beforeMigration?.(f, raw);
    raw.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true };
    stmt.run(...params);
    return { results: [], success: true };
  };
  const statement = (sql: string, args: unknown[] = []): any => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => (exec(sql, args).results[0] as unknown) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  return { raw, prepare: (sql: string) => statement(sql), batch: async (list: any[]) => list.map((s) => s._exec()) };
}

const STATE: FeatureStateReport = {
  legacy: { viewerCaptionDownload: true, socialAutopost: false, youtubeImport: false, captionsTranslate: true, inlineTranslate: true, viewerTranslatedTitles: true, aiCategorySuggest: true, tierRequests: true },
  ready: { youtubeImport: false, live: true, socialAutopost: true, newsletter: null },
};

function setup(roles: string[], opts: { state?: FeatureStateReport | 'down'; checks?: Parameters<typeof createFeaturesRouter>[0]; userId?: string } = {}) {
  forgetFeatureSwitches();
  const search = searchD1();
  const reports = sqliteD1();
  const env = {
    SEARCH_DB: search,
    REPORTS_DB: reports,
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string) {
        if (opts.state === 'down') return new Response('{"success":false,"code":"server_error"}', { status: 503 });
        assert.equal(new URL(input).pathname, '/internal/admin/features/state');
        return Response.json({ success: true, result: opts.state ?? STATE });
      },
    },
  };
  const app = new Hono();
  app.use('*', errorEnvelope);
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: opts.userId ?? 'usr_admin1', roles } as never);
    await next();
  });
  app.route('/api/features', createFeaturesRouter(opts.checks ?? {}));
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const put = (key: string, json: unknown, headers: Record<string, string> = {}) =>
    req(`/api/features/${key}`, { method: 'PUT', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json', ...headers } });
  const list = async () => ((await (await req('/api/features')).json()) as any).result;
  const item = async (key: string) => (await list()).items.find((i: any) => i.key === key);
  return { env, req, put, list, item, search, reports };
}

beforeEach(() => forgetFeatureSwitches());

describe('GET /api/features', () => {
  it('lists every switch in registry order with stored, effective, readiness and who may toggle', async () => {
    const t = setup(['admin']);
    const result = await t.list();
    assert.deepEqual(result.items.map((i: any) => i.key), [...FEATURE_KEYS]);
    assert.equal(result.propagationSeconds, 120);
    assert.equal(result.stateAvailable, true);
    const by = Object.fromEntries(result.items.map((i: any) => [i.key, i]));
    // Old settings rule while there is no row
    assert.equal(by.viewerCaptionDownload.enabled, true);
    assert.equal(by.socialAutopost.enabled, false);
    // Not set up: a note in both languages
    assert.equal(by.youtubeImport.ready, false);
    assert.deepEqual(Object.keys(by.youtubeImport.setupNote), ['en', 'ar']);
    assert.equal(by.live.setupNote, null);
    // tierRequests moved into a row by the migration
    assert.equal(by.tierRequests.version, 1);
    // An admin may not toggle the super-admin-only switches
    assert.equal(by.upload.canToggle, false);
    assert.equal(by.bulkSchedule.canToggle, true);
    assert.equal(result.canManage, true);
  });

  it('a moderator reads but changes nothing; a reviewer gets 403', async () => {
    const mod = await setup(['moderator']).list();
    assert.equal(mod.canManage, false);
    assert.ok(mod.items.every((i: any) => !i.canToggle));
    const res = await setup(['content_reviewer']).req('/api/features');
    assert.equal(res.status, 403);
  });

  it('keeps working when api-videos is down (defaults, readiness unknown)', async () => {
    const result = await setup(['admin'], { state: 'down' }).list();
    assert.equal(result.stateAvailable, false);
    assert.equal(result.items.length, FEATURE_KEYS.length);
  });

  it('shows a required switch that is off as the blocker', async () => {
    const t = setup(['super_admin']);
    assert.equal((await t.put('upload', { enabled: false, expectedVersion: 0 })).status, 200);
    const yt = await t.item('youtubeImport');
    assert.deepEqual(yt.blockedBy, ['upload']);
    assert.equal(yt.effective, false);
  });
});

describe('PUT /api/features/:key', () => {
  it('writes the switch and its change, audits it, and answers previous/enabled/version', async () => {
    const t = setup(['admin']);
    const res = await t.put('bulkSchedule', { enabled: false, expectedVersion: 0 });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).result, { previous: true, enabled: false, version: 1 });
    const item = await t.item('bulkSchedule');
    assert.equal(item.enabled, false);
    assert.equal(item.version, 1);
    assert.equal(item.updatedBy.id, 'usr_admin1');
    const audit = (await t.reports.prepare("SELECT key, old_value, new_value, actor_id FROM site_settings_log WHERE key = 'feature:bulkSchedule'").all<any>()).results!;
    assert.equal(audit.length, 1);
    assert.deepEqual(JSON.parse(audit[0].old_value), { enabled: true });
    assert.deepEqual(JSON.parse(audit[0].new_value), { action: 'feature.switch', details: { enabled: false, undo: false } });
  });

  it('records the old setting as the previous value on the first write', async () => {
    const t = setup(['super_admin']);
    const res = await t.put('viewerCaptionDownload', { enabled: false, expectedVersion: 0 });
    assert.deepEqual((await res.json()).result, { previous: true, enabled: false, version: 1 });
    const history = (await (await t.req('/api/features/viewerCaptionDownload/history')).json()).result;
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].oldEnabled, null);
    assert.equal(history.items[0].newEnabled, false);
    assert.equal(history.items[0].source, 'features_page');
    assert.equal(history.items[0].actor.id, 'usr_admin1');
  });

  it('refuses a stale version with 409 feature_changed and the current state, changing nothing', async () => {
    const t = setup(['admin']);
    await t.put('bulkSchedule', { enabled: false, expectedVersion: 0 });
    const res = await t.put('bulkSchedule', { enabled: true, expectedVersion: 0 }, { 'X-App-Locale': 'ar' });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'feature_changed');
    assert.deepEqual(body.current, { enabled: false, version: 1 });
    assert.equal(body.lang, 'ar');
    assert.equal((await t.item('bulkSchedule')).enabled, false);
    const audits = (await t.reports.prepare("SELECT id FROM site_settings_log WHERE key = 'feature:bulkSchedule'").all<any>()).results!;
    assert.equal(audits.length, 1, 'the refused change left no audit row');
  });

  it('an undo is recorded as one', async () => {
    const t = setup(['admin']);
    await t.put('bulkSchedule', { enabled: false, expectedVersion: 0 });
    await t.put('bulkSchedule', { enabled: true, expectedVersion: 1, undo: true });
    const items = (await (await t.req('/api/features/bulkSchedule/history')).json()).result.items;
    assert.deepEqual(items.map((i: any) => i.source), ['undo', 'features_page']);
  });

  it('super-admin-only switches need super admin', async () => {
    const res = await setup(['admin']).put('upload', { enabled: false, expectedVersion: 0 });
    assert.equal(res.status, 403);
    assert.equal((await setup(['super_admin']).put('upload', { enabled: false, expectedVersion: 0 })).status, 200);
  });

  it('moderators cannot change; bad input and unknown keys are refused', async () => {
    assert.equal((await setup(['moderator']).put('bulkSchedule', { enabled: false, expectedVersion: 0 })).status, 403);
    const t = setup(['admin']);
    assert.equal((await t.put('bulkSchedule', { enabled: 'no', expectedVersion: 0 })).status, 400);
    assert.equal((await t.put('bulkSchedule', { enabled: false })).status, 400);
    assert.equal((await t.put('nope', { enabled: false, expectedVersion: 0 })).status, 404);
  });

  it('a precondition refuses turning on with its reason in the caller’s language; turning off is never refused', async () => {
    const reason = { en: 'Form the organization first.', ar: 'أسّس المنظمة أولًا.' };
    let calls = 0;
    const checks = { creatorSupport: async () => { calls++; return { ok: false as const, reason, reasonKey: 'organization_not_formed' }; } };
    const t = setup(['super_admin'], { checks });
    const res = await t.put('creatorSupport', { enabled: true, expectedVersion: 0 }, { 'X-App-Locale': 'ar' });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'feature_precondition');
    assert.equal(body.message, reason.ar);
    assert.equal(body.lang, 'ar');
    assert.equal(body.feature, 'creatorSupport');
    assert.equal(body.reasonKey, 'organization_not_formed');
    assert.equal((await t.item('creatorSupport')).enabled, false);
    // Already off: writing off again skips the check
    assert.equal((await t.put('creatorSupport', { enabled: false, expectedVersion: 0 })).status, 200);
    assert.equal(calls, 1);
  });

  it('a precondition that throws refuses with the generic reason', async () => {
    const t = setup(['super_admin'], { checks: { creatorSupport: async () => { throw new Error('db down'); } } });
    const body = await (await t.put('creatorSupport', { enabled: true, expectedVersion: 0 })).json();
    assert.equal(body.code, 'feature_precondition');
    assert.match(body.message, /couldn’t check/);
    assert.equal(body.reasonKey, 'precondition_unreadable');
  });
});

describe('history paging', () => {
  it('pages 50 at a time, newest first', async () => {
    const t = setup(['admin']);
    for (let v = 0; v < 52; v++) await t.put('bulkSchedule', { enabled: v % 2 === 1, expectedVersion: v });
    const first = (await (await t.req('/api/features/bulkSchedule/history')).json()).result;
    assert.equal(first.items.length, 50);
    assert.ok(first.nextCursor);
    const second = (await (await t.req(`/api/features/bulkSchedule/history?cursor=${encodeURIComponent(first.nextCursor)}`)).json()).result;
    assert.equal(second.items.length, 2);
    assert.equal(second.nextCursor, null);
    const ids = new Set([...first.items, ...second.items].map((i: any) => i.id));
    assert.equal(ids.size, 52);
  });
});

describe('/public/features follows the newsletter switch', () => {
  it('turns off when the switch is off, and FEATURES_FORCE_OFF wins', async () => {
    const t = setup(['admin']);
    const env = { ...t.env, RESEND_API_KEY: 'r', CONTACT_MAIL_QUEUE: { sendBatch: async () => {} } };
    assert.deepEqual(await publicFeatures(env as never), { newsletter: true });
    await t.put('newsletter', { enabled: false, expectedVersion: 0 });
    assert.deepEqual(await publicFeatures(env as never), { newsletter: false });
    forgetFeatureSwitches();
    const fresh = setup(['admin']);
    assert.deepEqual(await publicFeatures({ ...fresh.env, RESEND_API_KEY: 'r', CONTACT_MAIL_QUEUE: {}, FEATURES_FORCE_OFF: 'newsletter' } as never), { newsletter: false });
  });
});

describe('the tierRequests migration', () => {
  it('copies "Allow tier requests" off into the switch', async () => {
    const search = searchD1((file, raw) => {
      if (file === '0077_feature_switches.sql') raw.exec("UPDATE creator_tier_settings SET value = '0', updated_by = 'usr_x' WHERE key = 'tier_requests_enabled'");
    });
    const row = await search.prepare("SELECT enabled, updated_by FROM feature_switches WHERE key = 'tierRequests'").first() as any;
    assert.deepEqual(row, { enabled: 0, updated_by: 'usr_x' });
  });
});

describe('creatorSupport precondition (wiki AUN-MEMBERS §9.7)', () => {
  it('the real check refuses on a fresh database, in production too, and names the first blocker', async () => {
    const { checkCanTurnOn } = await import('../src/lib/feature-preconditions');
    const search = searchD1();
    for (const env of [
      { SEARCH_DB: search, ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1' },
      { SEARCH_DB: search, ENVIRONMENT: 'production' },
      { ENVIRONMENT: 'qa' },
    ]) {
      const r = await checkCanTurnOn(env as never, 'creatorSupport');
      assert.equal(r.ok, false);
      assert.ok(!r.ok && r.reasonKey === 'organization_not_formed' && r.reason.en.length > 0 && r.reason.ar.length > 0);
    }
  });
});

describe('ageRules precondition (wiki E20 §5.2)', () => {
  it('a fresh database is refused in every environment, with the first failing check', async () => {
    const { checkCanTurnOn } = await import('../src/lib/feature-preconditions');
    for (const ENVIRONMENT of ['dev', 'qa', 'stage', 'production']) {
      // No Issuer: nothing is fetched
      const r = await checkCanTurnOn({ SEARCH_DB: searchD1(), ENVIRONMENT } as never, 'ageRules');
      assert.ok(!r.ok && r.reasonKey === 'age_rules_birth_date_off' && r.reason.en.length > 0 && r.reason.ar.length > 0);
    }
  });
});
