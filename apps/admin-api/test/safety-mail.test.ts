/** Child safety and case alerts by email: to super admins only, each in their language. Synthetic values only. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import { contactMailConsumer } from '../src/lib/contact-mail-queue';
import { processIngestMessage } from '../src/endpoints/errors/ErrorsIngest';
import { errorLiveEvents } from '../src/lib/admin-live';
import { ingestErrorEvents } from '../src/lib/errors-store';
import { processSafetyMailJob, renderSafetyEmail, safetyTopic, SAFETY_MAIL_PER_HOUR, type SafetyMailJob } from '../src/lib/moderation/safetyMail';
import { sqliteD1 } from './d1-sqlite';

type Json = Record<string, any>;
/** The email's links to the admin, parsed: path and query. */
const adminLinks = (body: string) => [
  ...new Set(
    (body.match(/https?:\/\/[^\s"'<>]+/g) ?? [])
      .map((u) => new URL(u.replace(/&amp;/g, '&')))
      .filter((u) => u.origin === 'https://admin.example.org')
      .map((u) => u.pathname + u.search),
  ),
];
const ev = (key: string, over: Json = {}) =>
  scrubEvent({ app: 'admin-api', kind: 'action', ref: newErrorRef(), message: 'Waiting', environment: 'production', occurredAt: new Date().toISOString(), action: { key, source: 'other', title: over.title ?? 'Child safety report needs review', itemType: 'report', itemId: 'vid-synth-01', itemUrl: over.itemUrl ?? '/moderation?entity_type=video&entity_id=vid-synth-01' } })!;
const msg = (events: unknown[], resolved: string[] = []) => ({ v: 1 as const, events, resolved, trustedRetry: true, receivedAt: new Date().toISOString() }) as never;

function setup(over: Json = {}) {
  const db = sqliteD1();
  const queue: SafetyMailJob[] = [];
  const mails: Json[] = [];
  const contacts: Record<string, Json | number> = { usr_sa_en: { email: 'sa-en@example.org', locale: 'en' }, usr_sa_ar: { email: 'sa-ar@example.org', locale: 'ar' }, usr_admin: { email: 'admin@example.org', locale: 'en' } };
  const VIDEOS = {
    async fetch(url: string) {
      const c = contacts[decodeURIComponent(new URL(url).pathname.match(/users\/([^/]+)\/account-email/)?.[1] ?? '')];
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
      return c && typeof c === 'object' ? json(200, { success: true, result: c }) : json(c === undefined ? 404 : (c as number), { success: false, code: 'x', error: 'x' });
    },
  };
  const env: Json = { REPORTS_DB: db, ENVIRONMENT: 'production', INTERNAL_API_KEY: 'k', RESEND_API_KEY: 'k', VIDEOS, ADMIN_WEB_URL: 'https://admin.example.org', CONTACT_INBOX: 'inbox@example.org', ERRORS_ALERT_TO: 'errors@example.org', CONTACT_MAIL_QUEUE: { send: async (b: SafetyMailJob) => void queue.push(b) }, ...over };
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (over.refuse?.(body.to[0])) return new Response('no', { status: over.refuse(body.to[0]) });
    mails.push({ ...body, key: new Headers(init.headers).get('idempotency-key') });
    return new Response('{"id":"e"}');
  }) as typeof fetch;
  const staff = (id: string, role: string, active = 1) => db.prepare("INSERT INTO admin_staff (user_id, role, email, active, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'x', 'x')").bind(id, role, `${id}@example.org`, active).run();
  const run = (job: SafetyMailJob, attempts = 1) => processSafetyMailJob(env as never, { id: 'm', body: job, attempts, ack() {}, retry() {} }, { fetchImpl });
  const ready = async () => {
    await staff('usr_sa_en', 'super_admin');
    await staff('usr_sa_ar', 'super_admin');
    await staff('usr_gone', 'super_admin');
    await staff('usr_was', 'super_admin', 0);
    await staff('usr_admin', 'admin');
  };
  return { db, env, queue, mails, contacts, run, ready };
}

describe('child safety alerts by email', () => {
  it('reach the active super admins, each in their language, and no other address', async () => {
    const t = setup();
    await t.ready();
    const real = globalThis.fetch;
    globalThis.fetch = (async () => assert.fail('nothing is mailed while ingesting')) as never;
    try {
      await processIngestMessage(t.env as never, msg([ev('child-safety-report:video:vid-synth-01')]));
    } finally {
      globalThis.fetch = real;
    }
    assert.equal(t.queue.length, 1);
    assert.equal(await t.run(t.queue[0]), 'done');
    assert.deepEqual(t.mails.map((m) => m.to[0]).sort(), ['sa-ar@example.org', 'sa-en@example.org']);
    const [ar, en] = ['sa-ar@example.org', 'sa-en@example.org'].map((to) => t.mails.find((m) => m.to[0] === to)!);
    assert.equal(en.subject, 'A child safety report needs review');
    assert.equal(ar.subject, 'بلاغ عن سلامة الأطفال ينتظر المراجعة');
    assert.deepEqual(adminLinks(en.html), ['/moderation?entity_type=video&entity_id=vid-synth-01']);
    assert.ok(/dir="rtl"/.test(ar.html));
    // A retried job sends nobody a second copy
    assert.equal(new Set(t.mails.map((m) => m.key)).size, 2);
    await t.run(t.queue[0], 2);
    assert.equal(new Set(t.mails.map((m) => m.key)).size, 2);
    const activity = (await t.db.prepare("SELECT body FROM error_group_activity WHERE kind = 'alert'").all()).results as Json[];
    assert.ok(activity.every((a) => !/@/.test(a.body)), 'no address on the Errors page');
  });

  it('every item is told of when new and when it comes back, not again while it is open', async () => {
    const t = setup();
    const key = (n: number) => `child-safety-report:video:v${n}`;
    await processIngestMessage(t.env as never, msg([ev(key(1)), ev(key(1)), ev(key(2))]));
    assert.equal(t.queue.length, 2, 'the second is in a group that exists');
    await processIngestMessage(t.env as never, msg([], [key(1)]));
    await processIngestMessage(t.env as never, msg([ev(key(1))]));
    assert.equal(t.queue.length, 3);
  });

  it('no generic alert, spike or live notice is about them, and others are still mailed to the error address', async () => {
    const t = setup();
    const sent: Json[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), new Response('{"id":"e"}'))) as never;
    try {
      const all = ['child-safety-report:video:v', 'child-safety-reports:2026-11-24T01', 'child-safety-evidence:post:p', 'child-safety-retention', 'csam:case-1', 'csam-contain:case-1', 'csam-webhook:abc'];
      for (const [n, key] of all.entries()) await processIngestMessage(t.env as never, msg([ev(key, { title: `Kind ${'abcdefg'[n]}` })]));
      for (let n = 0; n < 60; n++) await processIngestMessage(t.env as never, msg([ev(all[0], { title: 'Kind a' })]));
      assert.equal(sent.length, 0);
      assert.equal(t.queue.length, all.length);
      await processIngestMessage(t.env as never, msg([ev('contact-email:1', { title: 'Contact email not sent' })]));
    } finally {
      globalThis.fetch = real;
    }
    assert.deepEqual(sent.map((m) => m.to), [['errors@example.org']]);
    const out = await ingestErrorEvents(t.db as never, [ev('csam:case-2', { title: 'Another kind' })], { now: new Date(), environment: 'production' });
    assert.equal(out.created.length, 1);
    assert.deepEqual(errorLiveEvents(out, 0), [{ kind: 'changed', key: 'changed' }]);
  });

  it('a browser’s event is never one of them', async () => {
    const t = setup();
    await processIngestMessage(t.env as never, { ...(msg([ev('child-safety-report:video:v')]) as Json), trustedRetry: false } as never);
    assert.equal(t.queue.length, 0);
  });

  it('only in production, and a flood is bounded', async () => {
    const stage = setup({ ENVIRONMENT: 'stage' });
    await processIngestMessage(stage.env as never, msg([ev('csam:case-1')]));
    assert.equal(stage.queue.length, 0);
    const t = setup();
    await processIngestMessage(t.env as never, msg(Array.from({ length: SAFETY_MAIL_PER_HOUR + 5 }, (_, n) => ev(`csam:case-${n}`))));
    assert.equal(t.queue.length, SAFETY_MAIL_PER_HOUR);
  });

  it('somebody who cannot be reached is tried again, then said to have been missed; nobody else is mailed instead', async () => {
    const t = setup();
    await t.ready();
    t.contacts.usr_sa_ar = 503;
    await processIngestMessage(t.env as never, msg([ev('csam-contain:case-1')]));
    assert.equal(await t.run(t.queue[0]), 'retry');
    assert.equal(await t.run(t.queue[0], 6), 'failed');
    assert.deepEqual([...new Set(t.mails.map((m) => m.to[0]))], ['sa-en@example.org']);
    const [last] = (await t.db.prepare("SELECT body FROM error_group_activity WHERE kind = 'alert' ORDER BY rowid DESC").all()).results as Json[];
    assert.equal(last.body, 'Alert to super admins: 1 sent, 1 failed');
    // No super admin at all: nobody
    const none = setup();
    await processIngestMessage(none.env as never, msg([ev('csam:case-1')]));
    assert.equal(await none.run(none.queue[0]), 'done');
    assert.equal(none.mails.length, 0);
  });

  it('a queue that refuses does not lose it', async () => {
    const t = setup({ CONTACT_MAIL_QUEUE: { send: async () => { throw new Error('down'); } } });
    await t.ready();
    const real = globalThis.fetch;
    const sent: Json[] = [];
    globalThis.fetch = (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), new Response('{"id":"e"}'))) as never;
    try {
      await processIngestMessage(t.env as never, msg([ev('csam:case-1')]));
    } finally {
      globalThis.fetch = real;
    }
    assert.deepEqual(sent.map((m) => m.to[0]).sort(), ['sa-ar@example.org', 'sa-en@example.org']);
  });

  it('goes through the mail queue’s consumer', async () => {
    const t = setup();
    let acked = 0;
    await contactMailConsumer({ messages: [{ id: 'm', body: { v: 1, kind: 'safety_alert', id: 'a', groupId: 'eg_0000000000000000', topic: 'case', path: '/x' } as never, attempts: 1, ack: () => void acked++, retry: () => assert.fail('retried') }] }, t.env as never);
    assert.equal(acked, 1);
  });

  it('says what kind of thing needs them, and nothing of the thing', () => {
    assert.deepEqual(['child-safety-report:video:v', 'child-safety-reports:x', 'child-safety-evidence:post:p', 'child-safety-retention', 'csam:c', 'csam-freeze:c'].map(safetyTopic), ['report', 'report', 'record', 'retention', 'case', 'case']);
    for (const topic of ['report', 'record', 'retention', 'case'] as const) {
      for (const locale of ['en', 'ar'] as const) {
        const m = renderSafetyEmail({ to: 'sa@example.org', locale, topic, path: '/moderation/csam/case-1', adminUrl: 'https://admin.example.org/' });
        assert.ok(!/CSAM/.test(m.subject));
        assert.deepEqual(adminLinks(m.html), ['/moderation/csam/case-1']);
        assert.deepEqual(adminLinks(m.text), ['/moderation/csam/case-1']);
        if (locale === 'ar') assert.ok(/[؀-ۿ]/.test(m.subject) && !/فيديو/.test(m.text) && !/[0-9],|, /.test(m.subject));
      }
    }
  });
});
