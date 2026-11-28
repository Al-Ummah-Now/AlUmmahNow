/**
 * Status page subscriptions in admin-api (lib/status-notify.ts, routers/status.router.ts):
 * posting an incident announces it, the fan-out queues one delivery per active subscriber,
 * emails go out in the subscriber's language with the unsubscribe link and RFC 8058 headers,
 * webhooks are signed, retries back off, final failures go to the DLQ and the Errors page with
 * Retry, idempotency, internal-only incidents stay silent, and the admin endpoints (webhooks,
 * removal, retry) are audited. STATUS_DB carries apps/status's migrations; no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { StatusNotifyJob, StatusWebhookPayload } from '@al-ummah/shared-types';
import statusRouter from '../src/routers/status.router';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import { processStatusNotifyJob, renderIncidentEmail, signWebhook, validateWebhookUrl, STATUS_MAX_ATTEMPTS } from '../src/lib/status-notify';
import { sqliteD1 } from './d1-sqlite';

function statusD1(): D1Database {
  const dir = join(process.cwd(), '..', 'status', 'migrations');
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
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
    _exec: () => exec(sql, args),
  });
  return { prepare: (sql: string) => st(sql), batch: async (list: { _exec(): unknown }[]) => list.map((s) => s._exec()) } as unknown as D1Database;
}

const NOW = new Date(Date.UTC(2026, 10, 14, 12, 0));

function setup(opts: { failQueue?: boolean } = {}) {
  const queued: StatusNotifyJob[] = [];
  const dlq: unknown[] = [];
  const queue = {
    send: async (b: StatusNotifyJob) => {
      if (opts.failQueue) throw new Error('down');
      queued.push(b);
    },
    sendBatch: async (list: { body: StatusNotifyJob }[]) => {
      if (opts.failQueue) throw new Error('down');
      queued.push(...list.map((m) => m.body));
    },
  };
  const env = {
    ENVIRONMENT: 'qa',
    STATUS_DB: statusD1(),
    REPORTS_DB: sqliteD1(),
    STATUS_NOTIFY_QUEUE: queue,
    ERRORS_DLQ: { send: async (b: unknown) => void dlq.push(b) },
    RESEND_API_KEY: 'test-resend',
    STATUS_PAGE_URL: 'https://status.test',
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles: ['admin'] } as never);
    await next();
  });
  app.route('/api/status', statusRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  return { env, req, queued, dlq };
}

const send = (method: string, json: unknown): RequestInit => ({ method, body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });
const incident = { kind: 'incident', titleEn: 'Slow playback', titleAr: 'تشغيل بطيء', impact: 'partial', components: ['playback', 'api'], bodyEn: 'Looking into it.\n\nMore soon.', bodyAr: 'نتحقق من الأمر.' };

async function addEmail(db: D1Database, address: string, locale: 'en' | 'ar', status = 'active') {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO subscribers (id, kind, address, locale, status, token, created_at) VALUES (?, 'email', ?, ?, ?, ?, ?)").bind(id, address, locale, status, `tok_${id.replace(/-/g, '')}`, NOW.toISOString()).run();
  return id;
}

let seq = 0;
const msg = <T>(body: T, attempts = 1) => ({ id: `m${++seq}`, body, attempts, ack() {}, retry() {} });

/** A fetch that records requests and answers by URL. */
function fakeFetch(answer: (url: string) => number = () => 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(url.includes('resend') ? JSON.stringify({ id: 'email-1' }) : 'ok', { status: answer(url) });
  }) as unknown as typeof fetch;
  return { f, calls };
}

/** Runs every queued job (and the jobs they queue) once. */
async function drain(s: ReturnType<typeof setup>, fetchImpl: typeof fetch, attempts = 1) {
  const outcomes: string[] = [];
  while (s.queued.length) outcomes.push(await processStatusNotifyJob(s.env as never, msg(s.queued.shift()!, attempts), NOW, fetchImpl));
  return outcomes;
}

describe('announce on incident writes', () => {
  it('a new incident with a public component queues one fan-out; an update queues another; edits queue none', async () => {
    const s = setup();
    const created = await (await s.req('/api/status/incidents', send('POST', incident))).json() as { result: { id: string; updates: { id: string }[] } };
    assert.deepEqual(s.queued, [{ v: 1, kind: 'status-fanout', notificationId: created.result.updates[0].id }]);
    const n = await s.env.STATUS_DB.prepare('SELECT * FROM notifications').first<{ event: string; incident_id: string }>();
    assert.equal(n?.event, 'created');
    assert.equal(n?.incident_id, created.result.id);

    await s.req(`/api/status/incidents/${created.result.id}`, send('PATCH', { titleEn: 'Slow playback in Europe' }));
    assert.equal(s.queued.length, 1, 'an edit announces nothing');
    await s.req(`/api/status/incidents/${created.result.id}/updates`, send('POST', { status: 'resolved', bodyEn: 'Fixed.', bodyAr: 'تم الإصلاح.' }));
    assert.equal(s.queued.length, 2);
    const events = (await s.env.STATUS_DB.prepare('SELECT event FROM notifications ORDER BY created_at').all<{ event: string }>()).results.map((r) => r.event).sort();
    assert.deepEqual(events, ['created', 'resolved']);
  });

  it('an incident on internal components only is never announced', async () => {
    const s = setup();
    await s.req('/api/status/incidents', send('POST', { ...incident, components: ['cms', 'admin-api'] }));
    assert.equal(s.queued.length, 0);
    assert.equal((await s.env.STATUS_DB.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>())?.n, 0);
  });

  it('a refused queue still saves the incident and flags the Errors page', async () => {
    const s = setup({ failQueue: true });
    const res = await s.req('/api/status/incidents', send('POST', incident));
    assert.equal(res.status, 201);
  });
});

describe('fan-out and deliveries', () => {
  it('queues one delivery per active subscriber (never pending), sends each in its language, idempotent', async () => {
    const s = setup();
    const db = s.env.STATUS_DB;
    const en = await addEmail(db, 'en@example.com', 'en');
    const ar = await addEmail(db, 'ar@example.com', 'ar');
    await addEmail(db, 'pending@example.com', 'en', 'pending');
    await s.req('/api/status/incidents', send('POST', incident));
    const { f, calls } = fakeFetch();
    assert.deepEqual(await drain(s, f), ['done', 'done', 'done']);
    assert.equal(calls.length, 2);
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)) as { to: string[]; subject: string; text: string; headers: Record<string, string> });
    const enMail = bodies.find((b) => b.to[0] === 'en@example.com')!;
    const arMail = bodies.find((b) => b.to[0] === 'ar@example.com')!;
    assert.equal(enMail.subject, '[qa] Status: Slow playback (Investigating)');
    assert.match(arMail.subject, /^\[qa\] الحالة: تشغيل بطيء \(قيد التحقيق\)$/);
    assert.match(enMail.text, /Playback/);
    assert.ok(!enMail.text.includes('Videos API'), 'internal components are left out');
    assert.match(enMail.headers['List-Unsubscribe'], /^<https:\/\/status\.test\/unsubscribe\?t=tok_/);
    assert.equal(enMail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.match(arMail.headers['List-Unsubscribe'], /^<https:\/\/status\.test\/ar\/unsubscribe\?t=/);
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    assert.ok(keys.every((k) => /^status-[\w-]+-[\w-]+$/.test(k)));
    const statuses = (await db.prepare('SELECT subscriber_id, status FROM deliveries').all<{ subscriber_id: string; status: string }>()).results;
    assert.deepEqual(statuses.map((d) => d.status).sort(), ['sent', 'sent']);
    assert.ok(statuses.some((d) => d.subscriber_id === en) && statuses.some((d) => d.subscriber_id === ar));

    // The same jobs again send nothing
    const n = await db.prepare('SELECT id FROM notifications').first<{ id: string }>();
    s.queued.push({ v: 1, kind: 'status-fanout', notificationId: n!.id }, { v: 1, kind: 'status-deliver', notificationId: n!.id, subscriberId: en });
    await drain(s, f);
    assert.equal(calls.length, 2);
  });

  it('signs webhook deliveries with the documented headers and payload', async () => {
    const s = setup();
    const created = await (await s.req('/api/status/webhooks', send('POST', { name: 'Ops chat', url: 'https://hooks.example.com/aun' }))).json() as { result: { id: string; secret: string } };
    assert.match(created.result.secret, /^whsec_[0-9a-f]{64}$/);
    await s.req('/api/status/incidents', send('POST', incident));
    const { f, calls } = fakeFetch();
    await drain(s, f);
    const hook = calls.find((c) => c.url === 'https://hooks.example.com/aun')!;
    const h = hook.init.headers as Record<string, string>;
    const body = String(hook.init.body);
    const payload = JSON.parse(body) as StatusWebhookPayload;
    assert.equal(payload.type, 'incident.created');
    assert.deepEqual(payload.incident.components, ['playback']);
    assert.deepEqual(payload.incident.title, { en: 'Slow playback', ar: 'تشغيل بطيء' });
    assert.equal(payload.incident.url, `https://status.test/incidents/${payload.incident.id}`);
    assert.equal(h['x-aun-event'], 'incident.created');
    assert.equal(h['x-aun-delivery'], payload.id);
    assert.equal(h['x-aun-signature'], await signWebhook(created.result.secret, h['x-aun-timestamp'], body));
    assert.equal(hook.init.redirect, 'manual');
  });

  it('retries 5xx with backoff, gives up after the last attempt: failed, DLQ, Retry requeues', async () => {
    const s = setup();
    const db = s.env.STATUS_DB;
    const id = await addEmail(db, 'r@example.com', 'en');
    await s.req('/api/status/incidents', send('POST', incident));
    const down = fakeFetch(() => 503);
    // fan-out, then the delivery fails: retry
    assert.equal(await processStatusNotifyJob(s.env as never, msg(s.queued.shift()!), NOW, down.f), 'done');
    const job = s.queued.shift()!;
    assert.equal(await processStatusNotifyJob(s.env as never, msg(job, 1), NOW, down.f), 'retry');
    assert.equal((await db.prepare('SELECT status FROM deliveries').first<{ status: string }>())?.status, 'queued');
    assert.equal(await processStatusNotifyJob(s.env as never, msg(job, STATUS_MAX_ATTEMPTS), NOW, down.f), 'failed');
    const row = await db.prepare('SELECT status, error, attempts FROM deliveries').first<{ status: string; error: string; attempts: number }>();
    assert.equal(row?.status, 'failed');
    assert.match(row!.error, /Resend 503/);
    assert.equal(s.dlq.length, 1);

    const n = await db.prepare('SELECT id FROM notifications').first<{ id: string }>();
    const retried = await BUILTIN_RETRIES['status-notify'](s.env as never, { id: n!.id }, 'a1');
    assert.equal(retried.status, 'resolved');
    assert.deepEqual(s.queued, [{ v: 1, kind: 'status-deliver', notificationId: n!.id, subscriberId: id }]);
    const ok = fakeFetch();
    await drain(s, ok.f);
    assert.equal((await db.prepare('SELECT status FROM deliveries').first<{ status: string }>())?.status, 'sent');
  });

  it('revalidates the destination loaded from storage before sending a webhook', async () => {
    const s = setup();
    const created = await (await s.req('/api/status/webhooks', send('POST', {
      name: 'Ops', url: 'https://hooks.example.com/valid',
    }))).json() as { result: { id: string } };
    await s.env.STATUS_DB.prepare('UPDATE subscribers SET address = ? WHERE id = ?')
      .bind('http://hooks.example.com/legacy', created.result.id).run();
    await s.req('/api/status/incidents', send('POST', incident));
    const { f, calls } = fakeFetch();
    assert.deepEqual(await drain(s, f), ['done', 'failed']);
    assert.equal(calls.length, 0);
  });

  it('a webhook 4xx fails at once (no retry)', async () => {
    const s = setup();
    await s.req('/api/status/webhooks', send('POST', { name: 'Gone', url: 'https://hooks.example.com/gone' }));
    await s.req('/api/status/incidents', send('POST', incident));
    const { f } = fakeFetch(() => 410);
    assert.deepEqual(await drain(s, f), ['done', 'failed']);
  });

  it('skips a delivery whose subscriber left or whose incident was deleted', async () => {
    const s = setup();
    const db = s.env.STATUS_DB;
    const id = await addEmail(db, 'gone@example.com', 'en');
    const created = await (await s.req('/api/status/incidents', send('POST', incident))).json() as { result: { id: string } };
    await processStatusNotifyJob(s.env as never, msg(s.queued.shift()!), NOW, fakeFetch().f);
    await s.req(`/api/status/incidents/${created.result.id}`, { method: 'DELETE' });
    const { f, calls } = fakeFetch();
    await drain(s, f);
    assert.equal(calls.length, 0);
    assert.equal((await db.prepare('SELECT status FROM deliveries WHERE subscriber_id = ?').bind(id).first<{ status: string }>())?.status, 'skipped');
  });

  it('confirmation email: pending only, in its language, link to /subscribe/confirm', async () => {
    const s = setup();
    const id = await addEmail(s.env.STATUS_DB, 'new@example.com', 'ar', 'pending');
    const { f, calls } = fakeFetch();
    assert.equal(await processStatusNotifyJob(s.env as never, msg({ v: 1, kind: 'status-confirm', subscriberId: id }), NOW, f), 'done');
    const mail = JSON.parse(String(calls[0].init.body)) as { subject: string; text: string };
    assert.match(mail.subject, /أكّد اشتراكك/);
    assert.match(mail.text, /https:\/\/status\.test\/ar\/subscribe\/confirm\?t=tok_/);
    await s.env.STATUS_DB.prepare("UPDATE subscribers SET status = 'active' WHERE id = ?").bind(id).run();
    await processStatusNotifyJob(s.env as never, msg({ v: 1, kind: 'status-confirm', subscriberId: id }), NOW, f);
    assert.equal(calls.length, 1, 'already confirmed: nothing sent');
  });

  it('drops malformed jobs', async () => {
    const s = setup();
    assert.equal(await processStatusNotifyJob(s.env as never, msg({ kind: 'nope' }), NOW, fakeFetch().f), 'done');
  });
});

describe('email rendering', () => {
  it('maintenance mail shows the window; text is escaped in HTML', () => {
    const mail = renderIncidentEmail({
      to: 'x@example.com',
      locale: 'en',
      token: 'tok',
      base: 'https://status.test',
      environment: 'production',
      incident: { id: 'i1', kind: 'maintenance', title_en: '<b>DB</b> upgrade', title_ar: 'ترقية', status: 'scheduled', impact: 'maintenance', components: '["uploads"]', starts_at: '2026-11-20T02:00:00.000Z', ends_at: '2026-11-20T03:00:00.000Z', resolved_at: null, deleted_at: null },
      update: { id: 'u1', incident_id: 'i1', status: 'scheduled', body_en: 'Uploads pause for an hour.', body_ar: 'يتوقف الرفع ساعة.', created_at: '2026-11-14T12:00:00.000Z' },
    });
    assert.equal(mail.subject, 'Status: <b>DB</b> upgrade (Scheduled)');
    assert.match(mail.text, /Window/);
    assert.match(mail.text, /Scheduled maintenance/);
    assert.ok(!mail.html.includes('<b>DB</b>'));
  });
});

describe('admin endpoints', () => {
  it('webhook URLs must be public https', () => {
    assert.deepEqual(validateWebhookUrl('https://hooks.example.com/x#frag'), { url: 'https://hooks.example.com/x' });
    for (const bad of ['http://hooks.example.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://user:pw@hooks.example.com', 'https://box.internal/x', 'https://intranet/x', 'https://localhost./x', 'https://box.internal../x', 'https://127.0.0.1./x', 'https://0x7f.1/x', 'https://metadata.google.internal./x', 'ftp://x.com', 42]) {
      assert.ok('error' in validateWebhookUrl(bad), String(bad));
    }
    assert.ok('error' in validateWebhookUrl('https://webhooks.local-stack.test/x', 'production'));
    assert.ok('error' in validateWebhookUrl('https://webhooks.local-stack.test./x', 'production'));
    assert.ok('url' in validateWebhookUrl('https://webhooks.local-stack.test/x', 'qa'));
  });

  it('lists counts (never addresses), webhooks without secrets, notifications; add/delete/remove are audited', async () => {
    const s = setup();
    const db = s.env.STATUS_DB;
    await addEmail(db, 'a@example.com', 'en');
    await addEmail(db, 'b@example.com', 'en', 'pending');
    const created = await (await s.req('/api/status/webhooks', send('POST', { name: 'Ops', url: 'https://hooks.example.com/1' }))).json() as { result: { id: string } };
    assert.equal((await s.req('/api/status/webhooks', send('POST', { name: 'Ops', url: 'https://hooks.example.com/1' }))).status, 409);
    assert.equal((await s.req('/api/status/webhooks', send('POST', { name: '', url: 'https://hooks.example.com/2' }))).status, 400);
    await s.req('/api/status/incidents', send('POST', incident));

    const list = await (await s.req('/api/status/subscriptions')).json() as { result: { email: { active: number; pending: number }; webhooks: Record<string, unknown>[]; notifications: { event: string; titleEn: string }[] } };
    assert.deepEqual(list.result.email, { active: 1, pending: 1 });
    assert.equal(list.result.webhooks.length, 1);
    assert.equal(list.result.webhooks[0].secret, undefined);
    assert.equal(list.result.notifications[0].titleEn, 'Slow playback');
    assert.ok(!JSON.stringify(list).includes('a@example.com'));

    assert.deepEqual((await (await s.req('/api/status/subscribers/remove', send('POST', { email: ' A@example.com ' }))).json() as { result: unknown }).result, { removed: true });
    assert.equal((await s.req(`/api/status/webhooks/${created.result.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await s.req(`/api/status/webhooks/${created.result.id}`, { method: 'DELETE' })).status, 404);
    const audit = (await s.env.REPORTS_DB.prepare('SELECT action, metadata FROM admin_audit_log ORDER BY created_at').all<{ action: string; metadata: string }>()).results;
    const actions = audit.map((a) => a.action);
    for (const a of ['status.webhook.create', 'status.subscriber.remove', 'status.webhook.delete']) assert.ok(actions.includes(a), a);
    assert.ok(!JSON.stringify(audit).includes('a@example.com'), 'no address in the audit log');
  });

  it('moderators cannot reach the subscription endpoints', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: 'm', roles: ['moderator'] } as never);
      await next();
    });
    app.route('/api/status', statusRouter);
    assert.equal((await app.request('/api/status/subscriptions', undefined, { STATUS_DB: statusD1() } as never)).status, 403);
  });
});
