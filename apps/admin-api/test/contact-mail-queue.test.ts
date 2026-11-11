import { renderReply } from '../src/lib/contact-email';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ATTEMPTS, backoffSeconds, contactMailConsumer, processContactMailJob, type ContactMailJob } from '../src/lib/contact-mail-queue';
import { contactCounts, getContactMessage, insertContactMessage, insertContactNote, listContactMessages, listContactNotes, recordDelivery } from '../src/lib/contact-store';
import { sqliteD1 } from './d1-sqlite';

const roomy = { perIpHour: 99, perIpDay: 99, perUserHour: 99, perUserDay: 99 };
const realFetch = globalThis.fetch;
let calls: { url: string; body: Record<string, unknown>; key?: string }[] = [];
let respond: () => Response | Promise<Response> = () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 });

beforeEach(() => {
  calls = [];
  respond = () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)['Idempotency-Key'] });
    return respond();
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function setup(email = 'amina@example.org', environment = 'production') {
  const db = sqliteD1();
  await insertContactMessage(db, { id: 'm1', name: 'Amina', email, topic: 'general', message: 'A message long enough.', locale: 'ar', pageUrl: null, userId: null, userAgent: null, ipHash: 'ip', now: new Date('2026-11-09T10:00:00Z') }, roomy);
  const reports: Record<string, unknown>[] = [];
  const env = {
    REPORTS_DB: db,
    ENVIRONMENT: environment,
    RESEND_API_KEY: 'k',
    CONTACT_INBOX: 'support@alummahnow.net',
    ADMIN_WEB_URL: 'https://admin.alummahnow.net',
    ERRORS_DLQ: { send: async (b: Record<string, unknown>) => { reports.push(b); } },
  } as never;
  return { db, env, reports };
}

function msg(body: ContactMailJob, attempts = 1) {
  const m = { id: 'q1', body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
  return Object.assign(m, { ack: () => { m.acked = true; }, retry: (o?: { delaySeconds?: number }) => { m.retried = o ?? {}; } });
}

describe('contact mail queue', () => {
  it('backs off exponentially, capped', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 10].map(backoffSeconds), [30, 60, 120, 240, 480, 900, 900]);
  });

  it('sends the acknowledgement and the inbox notification, with idempotency keys', async () => {
    const { db, env } = await setup();
    const ack = msg({ v: 1, kind: 'ack', messageId: 'm1' });
    const notify = msg({ v: 1, kind: 'notify', messageId: 'm1' });
    await contactMailConsumer({ messages: [ack, notify] }, env);
    assert.ok(ack.acked && notify.acked);
    assert.deepEqual(calls.map((c) => [c.body.to, c.key]), [
      [['amina@example.org'], 'contact-ack-m1'],
      [['support@alummahnow.net'], 'contact-notify-m1'],
    ]);
    const row = await getContactMessage(db, 'm1');
    assert.equal(row?.ack_status, 'sent');
    assert.equal(row?.notify_status, 'sent');
  });

  it('is idempotent: an email already sent is not sent again', async () => {
    const { env } = await setup();
    await processContactMailJob(env, msg({ v: 1, kind: 'ack', messageId: 'm1' }));
    assert.equal(await processContactMailJob(env, msg({ v: 1, kind: 'ack', messageId: 'm1' })), 'done');
    assert.equal(calls.length, 1);
  });

  it('sinks test addresses outside production without calling Resend', async () => {
    const { db, env } = await setup('x@e2e.alummahnow.net', 'qa');
    await contactMailConsumer({ messages: [msg({ v: 1, kind: 'ack', messageId: 'm1' }), msg({ v: 1, kind: 'notify', messageId: 'm1' })] }, env);
    assert.equal(calls.length, 0);
    const row = await getContactMessage(db, 'm1');
    assert.deepEqual([row?.ack_status, row?.notify_status], ['sunk', 'sunk']);
  });

  it('retries a 5xx with backoff, then flags the message and reports to the DLQ on the last attempt', async () => {
    const { db, env, reports } = await setup();
    respond = () => new Response('busy', { status: 503 });
    const first = msg({ v: 1, kind: 'ack', messageId: 'm1' }, 1);
    await contactMailConsumer({ messages: [first] }, env);
    assert.deepEqual(first.retried, { delaySeconds: 30 });
    assert.equal((await getContactMessage(db, 'm1'))?.ack_status, 'queued');

    const last = msg({ v: 1, kind: 'ack', messageId: 'm1' }, MAX_ATTEMPTS);
    await contactMailConsumer({ messages: [last] }, env);
    assert.ok(last.acked);
    const row = await getContactMessage(db, 'm1');
    assert.equal(row?.ack_status, 'failed');
    assert.ok(row?.send_failed_at);
    assert.match(row?.delivery_error ?? '', /Resend 503/);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].type, 'contact_mail');
    assert.match(String(reports[0].failureReason), /ack email for message m1 failed after 6 attempt/);
    assert.equal((await contactCounts(db)).send_failed, 1);
    assert.deepEqual((await listContactMessages(db, { status: 'send_failed', limit: 10, offset: 0 })).messages.map((m) => m.id), ['m1']);
  });

  it('fails a permanent error (4xx) at once', async () => {
    const { db, env, reports } = await setup();
    respond = () => new Response('invalid to', { status: 422 });
    const m = msg({ v: 1, kind: 'ack', messageId: 'm1' }, 1);
    await contactMailConsumer({ messages: [m] }, env);
    assert.ok(m.acked && !m.retried);
    assert.equal((await getContactMessage(db, 'm1'))?.ack_status, 'failed');
    assert.equal(reports.length, 1);
  });

  it('sends a reply, marks the message replied, and a retried failure clears the flag', async () => {
    const { db, env } = await setup();
    await insertContactNote(db, { id: 'n1', message_id: 'm1', kind: 'reply', body: 'Try again please.', author_id: 'adm', author_email: null, email_to: 'amina@example.org', email_subject: 's', email_status: 'queued', email_id: null, created_at: '2026-11-09T11:00:00Z' });
    respond = () => new Response('nope', { status: 400 });
    await processContactMailJob(env, msg({ v: 1, kind: 'reply', messageId: 'm1', noteId: 'n1' }));
    assert.ok((await getContactMessage(db, 'm1'))?.send_failed_at);
    assert.equal((await listContactNotes(db, 'm1'))[0].email_error?.startsWith('Resend 400'), true);

    // Retry: queued again (flag cleared), then sent
    await recordDelivery(db, { messageId: 'm1', kind: 'reply', noteId: 'n1', status: 'queued', now: new Date() });
    assert.equal((await getContactMessage(db, 'm1'))?.send_failed_at, null);
    respond = () => new Response(JSON.stringify({ id: 're_9' }), { status: 200 });
    assert.equal(await processContactMailJob(env, msg({ v: 1, kind: 'reply', messageId: 'm1', noteId: 'n1' })), 'done');
    const note = (await listContactNotes(db, 'm1'))[0];
    assert.deepEqual([note.email_status, note.email_id, note.email_error], ['sent', 're_9', null]);
    assert.equal((await getContactMessage(db, 'm1'))?.status, 'replied');
    assert.equal(calls.at(-1)?.key, 'contact-reply-n1');
    assert.match(String(calls.at(-1)?.body.text), /> A message long enough\./);
  });

  it('sends a reply in the language the admin picked, which the stored subject keeps for retries', async () => {
    const { db, env } = await setup();
    const message = (await getContactMessage(db, 'm1'))!;
    const picked = message.locale === 'ar' ? 'en' : 'ar';
    const subject = renderReply(message as never, 'x', { locale: picked, environment: env.ENVIRONMENT }).subject;
    await insertContactNote(db, { id: 'n2', message_id: 'm1', kind: 'reply', body: 'Hello', author_id: 'adm', author_email: null, email_to: 'amina@example.org', email_subject: subject, email_status: 'queued', email_id: null, created_at: '2026-11-09T11:00:00Z' });
    assert.equal(await processContactMailJob(env, msg({ v: 1, kind: 'reply', messageId: 'm1', noteId: 'n2' })), 'done');
    assert.match(String(calls.at(-1)?.body.html), new RegExp(`<html lang="${picked}"`));
    assert.equal(calls.at(-1)?.body.subject, subject);
  });

  it('drops jobs for deleted messages and malformed jobs', async () => {
    const { env, reports } = await setup();
    assert.equal(await processContactMailJob(env, msg({ v: 1, kind: 'ack', messageId: 'gone' })), 'done');
    assert.equal(await processContactMailJob(env, msg({ v: 2 as 1, kind: 'ack', messageId: 'm1' })), 'done');
    // No contact email (the error tables are migrated too, so the reported failure may send its error alert)
    assert.equal(calls.filter((c) => !c.key?.startsWith('error-alert-')).length, 0);
    assert.equal(reports.length, 1);
  });
});
