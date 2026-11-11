/**
 * Warn user: who may warn, the record and its history (ordinal, suggestBan),
 * the audit row, the in-app notice asked of api-videos, the queued email and
 * how the email consumer decides (preference, language, address, failures).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  USER_WARNING_SUGGEST_BAN_AT,
  accountEmailDecision,
  contentPermissionsFor,
  hasContentPermission,
  warningEscalation,
  type AccountEmailContact,
} from '@al-ummah/shared-types';
import contentRouter from '../src/routers/content.router';
import { contactMailConsumer } from '../src/lib/contact-mail-queue';
import { parseWarningRequest, WarningInputError, getWarning } from '../src/lib/content/warnings';
import { processWarningMailJob, renderWarningEmail, warningMailJob, type WarningMailJob } from '../src/lib/warning-mail';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import { sqliteD1 } from './d1-sqlite';

interface VideosCall { method: string; path: string; body: unknown }

function fakeVideos(contacts: Record<string, Partial<AccountEmailContact>>) {
  const calls: VideosCall[] = [];
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const url = new URL(input);
      const call = { method: init.method ?? 'GET', path: url.pathname.replace('/internal/admin', ''), body: typeof init.body === 'string' ? JSON.parse(init.body) : null };
      calls.push(call);
      const match = call.path.match(/^\/users\/([^/]+)\/(account-email|account-notices)$/);
      const contact = match ? contacts[decodeURIComponent(match[1])] : undefined;
      const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (match && !contact) return answer(404, { success: false, code: 'user_not_found', error: 'user_not_found' });
      if (match?.[2] === 'account-email') return answer(200, { success: true, result: { userId: match[1], email: null, displayName: '', accountEmail: true, locale: 'en', savedLocale: null, ...contact } });
      if (match?.[2] === 'account-notices') return answer(200, { success: true, result: { queued: true } });
      return answer(200, { success: true, result: {} });
    },
  };
  return { fetcher, calls };
}

function setup(contacts: Record<string, Partial<AccountEmailContact>> = { usr_1: { email: 'amina@example.org', displayName: 'Amina' } }) {
  const db = sqliteD1();
  const videos = fakeVideos(contacts);
  const mail: unknown[] = [];
  const ingest: unknown[] = [];
  const env = {
    REPORTS_DB: db,
    VIDEOS: videos.fetcher,
    INTERNAL_API_KEY: 'internal-key',
    ENVIRONMENT: 'production',
    RESEND_API_KEY: 'k',
    VIDEOS_WEB_URL: 'https://alummahnow.net',
    CONTACT_MAIL_QUEUE: { send: async (body: unknown) => { mail.push(body); } },
    ERRORS_QUEUE: { send: async (body: unknown) => { ingest.push(body); } },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles') ?? '';
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'mod-1', email: 'mod@alummahnow.net', payload: { name: 'Mod One' }, roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/content', contentRouter);
  const call = async (path: string, init: { method?: string; roles: string; json?: unknown }) => {
    const res = await app.request(path, {
      method: init.method ?? 'GET',
      headers: { 'x-test-roles': init.roles, 'content-type': 'application/json' },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { db, env, videos, mail, ingest, call };
}

const auditRows = (db: D1Database) =>
  db.prepare("SELECT key, new_value, actor_id FROM site_settings_log WHERE key LIKE 'content:user:%' ORDER BY created_at").all<{ key: string; new_value: string; actor_id: string }>();

describe('warn user: permissions', () => {
  it('moderators, admins and super admins may warn; nobody else', () => {
    for (const role of ['moderator', 'admin', 'super_admin', 'Moderator']) assert.ok(hasContentPermission([role], 'users:warn'), role);
    assert.equal(hasContentPermission(['viewer'], 'users:warn'), false);
    assert.deepEqual(contentPermissionsFor(['moderator']), ['users:warn']);
  });

  it('a caller without users:warn can neither issue nor read warnings', async () => {
    const { call, videos } = setup();
    assert.equal((await call('/api/content/users/usr_1/warnings', { method: 'POST', roles: 'viewer', json: { reasonCode: 'spam', locale: 'en' } })).status, 403);
    assert.equal((await call('/api/content/users/usr_1/warnings', { roles: 'viewer' })).status, 403);
    assert.equal(videos.calls.length, 0);
  });
});

describe('warn user: escalation', () => {
  it('counts 1st, 2nd, 3rd and suggests a ban from the threshold', () => {
    assert.equal(USER_WARNING_SUGGEST_BAN_AT, 3);
    assert.deepEqual([1, 2, 3, 4].map(warningEscalation), [
      { ordinal: 1, suggestBan: false },
      { ordinal: 2, suggestBan: false },
      { ordinal: 3, suggestBan: true },
      { ordinal: 4, suggestBan: true },
    ]);
  });
});

describe('warn user: request', () => {
  it('accepts a reason with optional note, report and content; refuses the rest', () => {
    assert.deepEqual(parseWarningRequest({ reasonCode: 'spam', note: '  repeat links ', reportId: 'r1', entityKind: 'video', entityId: 'v1', locale: 'ar' }), {
      reasonCode: 'spam', locale: 'ar', note: 'repeat links', reportId: 'r1', entityKind: 'video', entityId: 'v1',
    });
    assert.deepEqual(parseWarningRequest({ reasonCode: 'other', locale: 'en' }), { reasonCode: 'other', locale: 'en' });
    const code = (b: Record<string, unknown>) => {
      try {
        parseWarningRequest(b);
        return 'ok';
      } catch (e) {
        return e instanceof WarningInputError ? e.code : 'thrown';
      }
    };
    assert.equal(code({ reasonCode: 'rude', locale: 'en' }), 'invalid_reason');
    assert.equal(code({ reasonCode: 'spam', locale: 'en', note: 'x'.repeat(1001) }), 'note_too_long');
    assert.equal(code({ reasonCode: 'spam', locale: 'en', entityKind: 'user', entityId: 'u' }), 'invalid_entity_kind');
    assert.equal(code({ reasonCode: 'spam', locale: 'en', entityKind: 'video' }), 'invalid_request');
    // The email language is chosen at the click: required, one language only
    assert.equal(code({ reasonCode: 'spam' }), 'invalid_locale');
    assert.equal(code({ reasonCode: 'spam', locale: 'fr' }), 'invalid_locale');
    assert.equal(code({ reasonCode: 'spam', locale: 'en,ar' }), 'invalid_locale');
  });
});

describe('warn user: endpoints', () => {
  it('a moderator warns: record, audit row, in-app notice, queued email; the 3rd suggests a ban', async () => {
    const { db, call, videos, mail } = setup();
    const issue = () => call('/api/content/users/usr_1/warnings', { method: 'POST', roles: 'moderator', json: { reasonCode: 'harassment', note: 'insults in comments', reportId: 'rep_1', entityKind: 'comment', entityId: 'c_9', locale: 'ar' } });

    const first = await issue();
    assert.equal(first.status, 200);
    const r = first.body.result;
    assert.equal(r.count, 1);
    assert.equal(r.ordinal, 1);
    assert.equal(r.suggestBan, false);
    assert.match(r.warning.id, /^wrn_[0-9a-f]{32}$/);
    assert.equal(r.warning.reasonCode, 'harassment');
    assert.equal(r.warning.issuedBy, 'mod-1');
    assert.equal(r.warning.issuedByName, 'Mod One');
    assert.equal(r.warning.inAppSent, true);
    assert.equal(r.warning.emailStatus, 'queued');
    assert.equal(r.warning.entityKind, 'comment');
    assert.equal(r.warning.locale, 'ar');

    const notice = videos.calls.find((c) => c.path === '/users/usr_1/account-notices');
    assert.deepEqual(notice?.body, { kind: 'warning', noticeId: r.warning.id, reasonCode: 'harassment', count: 1 });
    assert.deepEqual(mail, [{ v: 1, kind: 'warning', warningId: r.warning.id }]);

    const { results: audit = [] } = await auditRows(db);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].key, 'content:user:usr_1');
    assert.equal(audit[0].actor_id, 'mod-1');
    const value = JSON.parse(audit[0].new_value);
    assert.equal(value.action, 'warn');
    assert.deepEqual(value.details, { warningId: r.warning.id, reasonCode: 'harassment', ordinal: 1, locale: 'ar', note: 'insults in comments', reportId: 'rep_1', entityKind: 'comment', entityId: 'c_9' });

    assert.equal((await issue()).body.result.suggestBan, false);
    const third = (await issue()).body.result;
    assert.equal(third.ordinal, 3);
    assert.equal(third.count, 3);
    assert.equal(third.suggestBan, true);
  });

  it('reads the history newest first with ordinals and issuer names', async () => {
    const { call } = setup({ usr_1: { email: 'amina@example.org', displayName: 'Amina', savedLocale: 'ar' } });
    await call('/api/content/users/usr_1/warnings', { method: 'POST', roles: 'admin', json: { reasonCode: 'spam', locale: 'en' } });
    await new Promise((r) => setTimeout(r, 5));
    await call('/api/content/users/usr_1/warnings', { method: 'POST', roles: 'moderator', json: { reasonCode: 'copyright', locale: 'ar' } });
    const list = (await call('/api/content/users/usr_1/warnings', { roles: 'moderator' })).body.result;
    assert.equal(list.count, 2);
    assert.equal(list.suggestBan, false);
    assert.equal(list.emailLanguage, 'ar', 'the saved email language, for the Warn dialog to preselect');
    assert.deepEqual(list.items.map((w: { locale: string }) => w.locale), ['ar', 'en']);
    assert.deepEqual(list.items.map((w: { reasonCode: string; ordinal: number; issuedByName: string }) => [w.reasonCode, w.ordinal, w.issuedByName]), [
      ['copyright', 2, 'Mod One'],
      ['spam', 1, 'Mod One'],
    ]);
  });

  it('refuses an unknown user and a bad reason without a record or an audit row', async () => {
    const { db, call, mail } = setup();
    const unknown = await call('/api/content/users/usr_gone/warnings', { method: 'POST', roles: 'moderator', json: { reasonCode: 'spam', locale: 'en' } });
    assert.equal(unknown.status, 404);
    const bad = await call('/api/content/users/usr_1/warnings', { method: 'POST', roles: 'moderator', json: { reasonCode: 'rude', locale: 'en' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'invalid_reason');
    assert.equal(((await auditRows(db)).results ?? []).length, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM user_warnings').first<{ n: number }>())?.n, 0);
    assert.equal(mail.length, 0);
  });

  it('shows the warning count on the user list', async () => {
    const db = sqliteD1();
    await db.prepare("INSERT INTO user_warnings (id, user_id, reason_code, issued_by, issued_by_name, created_at) VALUES ('w1', 'usr_1', 'spam', 'm', 'M', '2026-11-01'), ('w2', 'usr_1', 'spam', 'm', 'M', '2026-11-02')").run();
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: 'mod-1', roles: ['moderator'] } as never);
      await next();
    });
    app.route('/api/content', contentRouter);
    const videos = {
      async fetch() {
        return new Response(JSON.stringify({ success: true, result: { items: [{ id: 'usr_1' }, { id: 'usr_2' }], total: 2, page: 1, pageSize: 20, indexComplete: true } }), { status: 200 });
      },
    };
    const res = await app.request('/api/content/users', {}, { REPORTS_DB: db, VIDEOS: videos, INTERNAL_API_KEY: 'k' });
    const items = ((await res.json()) as any).result.items;
    assert.deepEqual(items.map((u: { id: string; warningCount: number }) => [u.id, u.warningCount]), [['usr_1', 2], ['usr_2', 0]]);
  });
});

describe('warn user: email', () => {
  const realFetch = globalThis.fetch;
  let sent: { body: Record<string, unknown>; key?: string }[] = [];
  let respond: () => Response = () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
  beforeEach(() => {
    sent = [];
    respond = () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push({ body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)['Idempotency-Key'] });
      return respond();
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function msg(body: WarningMailJob, attempts = 1) {
    const m = { id: 'q1', body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
    return Object.assign(m, { ack: () => { m.acked = true; }, retry: (o?: { delaySeconds?: number }) => { m.retried = o ?? {}; } });
  }

  async function warned(contacts: Record<string, Partial<AccountEmailContact>>, locale: 'en' | 'ar' = 'en') {
    const s = setup(contacts);
    const res = await s.call('/api/content/users/usr_1/warnings', { method: 'POST', roles: 'moderator', json: { reasonCode: 'spam', locale } });
    return { ...s, warningId: res.body.result.warning.id as string };
  }

  it('decides: off → disabled, no address → no_address, else send in the picked language', () => {
    assert.deepEqual(accountEmailDecision({ email: 'a@b.c', accountEmail: false, locale: 'en' }), { send: false, status: 'disabled' });
    assert.deepEqual(accountEmailDecision({ email: null, accountEmail: true, locale: 'en' }), { send: false, status: 'no_address' });
    assert.deepEqual(accountEmailDecision({ email: ' a@b.c ', accountEmail: true, locale: 'ar' }), { send: true, to: 'a@b.c', locale: 'ar' });
    assert.deepEqual(accountEmailDecision({ email: 'a@b.c', accountEmail: true, locale: 'ar' }, 'en'), { send: true, to: 'a@b.c', locale: 'en' }, 'a chosen language wins');
  });

  it('renders in English and Arabic with the reason in plain words and the guidelines link', () => {
    const en = renderWarningEmail({ to: 'a@b.c', name: 'Amina', locale: 'en', reasonCode: 'spam', count: 2, origin: 'https://alummahnow.net', environment: 'qa' });
    assert.equal(en.subject, '[qa] Your Al Ummah Now account received a warning');
    assert.match(en.text, /Reason: spam or misleading content/);
    assert.match(en.text, /Warnings on your account: 2/);
    assert.match(en.text, /https:\/\/alummahnow\.net\/en\/community-guidelines/);
    assert.match(en.html, /dir="ltr"/);
    const ar = renderWarningEmail({ to: 'a@b.c', name: 'أمينة', locale: 'ar', reasonCode: 'harassment', count: 3, origin: 'https://alummahnow.net', environment: 'production' });
    assert.equal(ar.subject, 'تلقّى حسابك في الأمة الآن تحذيرًا');
    assert.match(ar.text, /السبب: التحرش أو التنمر/);
    assert.match(ar.text, /https:\/\/alummahnow\.net\/ar\/community-guidelines/);
    assert.match(ar.html, /dir="rtl"/);
  });

  it('sends in the one language chosen when warning (not the saved one) through the contact mail queue consumer, once', async () => {
    const { env, db, warningId } = await warned({ usr_1: { email: 'amina@example.org', displayName: 'Amina', locale: 'en', savedLocale: 'en' } }, 'ar');
    const m = msg(warningMailJob(warningId));
    await contactMailConsumer({ messages: [m] }, env as never);
    assert.ok(m.acked);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.to, ['amina@example.org']);
    assert.equal(sent[0].body.subject, 'تلقّى حسابك في الأمة الآن تحذيرًا');
    assert.doesNotMatch(String(sent[0].body.text), /Assalamu|Reason|warning/i, 'Arabic only, never bilingual');
    assert.equal(sent[0].key, `warning-${warningId}`);
    assert.equal((await getWarning(db, warningId))?.email_status, 'sent');
    assert.equal(await processWarningMailJob(env as never, msg(warningMailJob(warningId))), 'done');
    assert.equal(sent.length, 1, 'not sent twice');
  });

  it('sends nothing when the user turned account emails off, or has no address', async () => {
    const off = await warned({ usr_1: { email: 'amina@example.org', accountEmail: false } });
    assert.equal(await processWarningMailJob(off.env as never, msg(warningMailJob(off.warningId))), 'done');
    assert.equal((await getWarning(off.db, off.warningId))?.email_status, 'disabled');
    const none = await warned({ usr_1: { email: null } });
    assert.equal(await processWarningMailJob(none.env as never, msg(warningMailJob(none.warningId))), 'done');
    assert.equal((await getWarning(none.db, none.warningId))?.email_status, 'no_address');
    assert.equal(sent.length, 0);
  });

  it('retries a passing failure, then records the failure and flags it on the Errors page; Retry queues it again', async () => {
    const { env, db, ingest, mail, warningId } = await warned({ usr_1: { email: 'amina@example.org' } }, 'ar');
    respond = () => new Response('busy', { status: 503 });
    assert.equal(await processWarningMailJob(env as never, msg(warningMailJob(warningId), 1)), 'retry');
    assert.equal(await processWarningMailJob(env as never, msg(warningMailJob(warningId), 6)), 'failed');
    const row = await getWarning(db, warningId);
    assert.equal(row?.email_status, 'failed');
    assert.match(row?.email_error ?? '', /Resend 503/);
    const flagged = JSON.stringify(ingest);
    assert.match(flagged, new RegExp(`warning-email:${warningId}`));
    assert.match(flagged, /"handler":"warning-email"/);

    const outcome = await BUILTIN_RETRIES['warning-email'](env as never, { id: warningId }, 'a1');
    assert.equal(outcome.status, 'resolved');
    assert.equal((await getWarning(db, warningId))?.email_status, 'queued');
    assert.deepEqual(mail.at(-1), { v: 1, kind: 'warning', warningId });
    respond = () => new Response(JSON.stringify({ id: 're_2' }), { status: 200 });
    sent = [];
    assert.equal(await processWarningMailJob(env as never, msg(warningMailJob(warningId))), 'done');
    assert.equal(sent[0].body.subject, 'تلقّى حسابك في الأمة الآن تحذيرًا', 'the Retry resends in the language chosen when warning');
  });
});
