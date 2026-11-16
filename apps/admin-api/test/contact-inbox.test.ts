/**
 * Contact inbox, migration 0030: read/unread, "in progress", the bot verdict,
 * automatic spam, the assignee roster and bulk changes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { contactSubmit } from '../src/endpoints/contact/ContactSubmit';
import { contentSpamReason, initialSpamReason } from '../src/lib/contact';
import {
  contactCounts,
  getContactMessage,
  getContactStaff,
  insertContactMessage,
  insertContactNote,
  recordDelivery,
  listContactMessages,
  listContactNotes,
  listContactStaff,
  touchContactStaff,
  updateContactMessage,
  updateContactMessages,
} from '../src/lib/contact-store';
import { sqliteD1 } from './d1-sqlite';

const ALL = readdirSync(join(process.cwd(), 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const roomy = { perIpHour: 99, perIpDay: 99, perUserHour: 99, perUserDay: 99 };
const msg = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: 'Aisha',
  email: 'aisha@example.org',
  topic: 'general' as const,
  message: 'Assalamu alaikum, the player stops on my phone.',
  locale: 'en' as const,
  pageUrl: null,
  userId: null,
  userAgent: null,
  ipHash: `ip-${id}`,
  now: new Date('2026-11-10T09:00:00Z'),
  ...extra,
});

/** The production spam message of 2026-11-15 (a9e643af…), verbatim. */
const PROD_SPAM = `"Hello there,

I'd love to discuss how we can grow your online visibility.

We help businesses rank higher on Google while also increasing their presence on AI-powered search platforms like ChatGPT, Gemini, Claude, and Perplexity.

If interested, kindly provide me your name, phone number, and email.

Cheers,
James Washington | Founder & Project Head


Note: Web platform expertise across Squarespace, Shopify, Wix, WordPress, GoDaddy etc."`;

describe('migration 0030 on a database with data', () => {
  it('copies rows, maps statuses and keeps notes (foreign keys on)', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { readFileSync } = await import('node:fs');
    const sql = new DatabaseSync(':memory:');
    sql.exec('PRAGMA foreign_keys = ON');
    for (const f of ALL.filter((f) => f < '0030')) sql.exec(readFileSync(join(process.cwd(), 'migrations', f), 'utf8'));
    const ins = sql.prepare(
      `INSERT INTO contact_messages (id, status, topic, name, email, message, locale, ip_hash, created_at, updated_at) VALUES (?, ?, 'general', 'N', 'n@x.org', 'hello there', 'en', 'h', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z')`,
    );
    ins.run('a', 'new');
    ins.run('b', 'replied');
    ins.run('c', 'spam');
    sql.prepare(`INSERT INTO contact_notes (id, message_id, kind, body, author_id, created_at) VALUES (?, ?, ?, ?, 'adm', '2026-11-02T00:00:00Z')`).run('n1', 'b', 'reply', 'thanks');
    sql.prepare(`INSERT INTO contact_notes (id, message_id, kind, body, author_id, created_at) VALUES (?, ?, ?, ?, 'adm', '2026-11-02T00:01:00Z')`).run('n2', 'b', 'note', 'internal');

    for (const f of ALL.filter((f) => f >= '0030')) sql.exec(readFileSync(join(process.cwd(), 'migrations', f), 'utf8'));

    const rows = sql.prepare('SELECT id, status, read_at, spam_reason, bot_verdict FROM contact_messages ORDER BY id').all();
    assert.deepEqual(
      rows.map((r) => ({ ...r })),
      [
        { id: 'a', status: 'open', read_at: null, spam_reason: null, bot_verdict: null },
        { id: 'b', status: 'replied', read_at: '2026-11-02T00:00:00Z', spam_reason: null, bot_verdict: null },
        { id: 'c', status: 'spam', read_at: '2026-11-02T00:00:00Z', spam_reason: 'admin', bot_verdict: null },
      ],
    );
    assert.deepEqual(sql.prepare('SELECT id, message_id FROM contact_notes ORDER BY id').all().map((r) => ({ ...r })), [
      { id: 'n1', message_id: 'b' },
      { id: 'n2', message_id: 'b' },
    ]);
    // The notes still reference the (renamed) messages table: the cascade works on the new tables
    assert.match(String((sql.prepare("SELECT sql FROM sqlite_master WHERE name = 'contact_notes'").get() as { sql: string }).sql), /REFERENCES "?contact_messages"?\(id\)/);
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    sql.exec("DELETE FROM contact_messages WHERE id = 'b'");
    assert.equal((sql.prepare('SELECT COUNT(*) AS n FROM contact_notes').get() as { n: number }).n, 0, 'ON DELETE CASCADE still applies');
    // 'in_progress' is allowed now, 'new' is not
    sql.exec("UPDATE contact_messages SET status = 'in_progress' WHERE id = 'a'");
    assert.throws(() => sql.exec("UPDATE contact_messages SET status = 'new' WHERE id = 'a'"), /CHECK/);
  });
});

describe('spam rules', () => {
  it('files the production SEO pitch as spam (content)', () => {
    assert.equal(contentSpamReason(PROD_SPAM), 'content');
    assert.equal(initialSpamReason('off', PROD_SPAM), 'content');
  });

  it('leaves normal messages alone, in English and Arabic, even with one marker or a link', () => {
    for (const text of [
      'Assalamu alaikum, the player stops on my phone after a minute.',
      'How do I improve SEO for my channel page? Thanks.',
      'I want to grow your platform with my lectures, how do I become a creator?',
      'السلام عليكم، المرئي لا يعمل على هاتفي منذ أمس.',
      'أريد التواصل بخصوص شراكة لقناتنا: https://example.org/about',
      'See https://a.example and https://b.example for the two broken pages.',
    ]) {
      assert.equal(contentSpamReason(text), null, text);
      assert.equal(initialSpamReason('pass', text), null, text);
    }
  });

  it('three links or more is spam', () => {
    assert.equal(contentSpamReason('buy https://a.x https://b.x https://c.x now'), 'content');
  });

  it('a failed or missing Turnstile check (monitor mode lets it through) is spam; error, off and bypass are no judgement', () => {
    const text = 'Assalamu alaikum, the player stops on my phone.';
    assert.equal(initialSpamReason('fail', text), 'turnstile');
    assert.equal(initialSpamReason('missing', text), 'turnstile');
    for (const v of ['pass', 'error', 'off', 'bypass'] as const) assert.equal(initialSpamReason(v, text), null, v);
  });
});

describe('POST /internal/contact: verdict and automatic spam', () => {
  function setup(extra: Record<string, unknown> = {}) {
    const db = sqliteD1();
    const queued: unknown[] = [];
    const env = {
      INTERNAL_API_KEY: 'internal-key',
      REPORTS_DB: db,
      ENVIRONMENT: 'qa',
      CONTACT_INBOX: 'support@alummahnow.net',
      CONTACT_MAIL_QUEUE: { sendBatch: async (batch: { body: unknown }[]) => void queued.push(...batch.map((b) => b.body)) },
      ERRORS_DLQ: { send: async () => undefined },
      ...extra,
    };
    const app = new Hono();
    app.post('/internal/contact', (c) => contactSubmit(c as never));
    const post = (body: unknown) =>
      app.request('/internal/contact', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-API-Key': 'internal-key', 'X-Client-IP': '198.51.100.9' } }, env);
    return { db, post, queued };
  }
  const form = { name: 'James', email: 'james@example.com', topic: 'content', message: PROD_SPAM, locale: 'en', website: '', elapsedMs: 8000 };

  it('a sales pitch is stored as spam with its verdict, and no email goes out (no acknowledgement to the sender)', async () => {
    const { db, post, queued } = setup({ TURNSTILE_MODE: 'off' });
    const res = await post(form);
    assert.equal(res.status, 201, 'the sender sees a normal success');
    const { result } = (await res.json()) as { result: { id: string } };
    const row = await getContactMessage(db, result.id);
    assert.equal(row?.status, 'spam');
    assert.equal(row?.spam_reason, 'content');
    assert.equal(row?.bot_verdict, 'off');
    assert.equal(row?.notify_status, 'skipped');
    assert.equal(row?.ack_status, 'skipped');
    assert.deepEqual(queued, []);
    assert.equal((await contactCounts(db)).unread, 0, 'spam never counts as unread');
  });

  it('monitor mode: a missing token is let through, recorded and filed as spam', async () => {
    const { db, post, queued } = setup({ TURNSTILE_MODE: 'monitor', TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' });
    const res = await post({ ...form, message: 'Assalamu alaikum, the player stops on my phone.' });
    assert.equal(res.status, 201);
    const { result } = (await res.json()) as { result: { id: string } };
    const row = await getContactMessage(db, result.id);
    assert.equal(row?.bot_verdict, 'missing');
    assert.equal(row?.status, 'spam');
    assert.equal(row?.spam_reason, 'turnstile');
    assert.deepEqual(queued, []);
  });

  it('a passed check and a normal message: open, unread, verdict pass, both emails queued', async () => {
    const { db, post, queued } = setup({ TURNSTILE_MODE: 'enforce', TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' });
    const res = await post({ ...form, message: 'Assalamu alaikum, the player stops on my phone.', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' });
    assert.equal(res.status, 201);
    const { result } = (await res.json()) as { result: { id: string } };
    const row = await getContactMessage(db, result.id);
    assert.equal(row?.status, 'open');
    assert.equal(row?.read_at, null);
    assert.equal(row?.bot_verdict, 'pass');
    assert.equal(queued.length, 2);
    assert.equal((await contactCounts(db)).unread, 1);
  });
});

describe('contact store: read/unread, in progress, roster, bulk', () => {
  it('read keeps the first read time, unread clears it; the unread count and filter follow', async () => {
    const db = sqliteD1();
    await insertContactMessage(db, msg('m1'), roomy);
    await insertContactMessage(db, msg('m2'), roomy);
    assert.equal((await contactCounts(db)).unread, 2);
    assert.equal(await updateContactMessage(db, 'm1', { read: true }, new Date('2026-11-11T00:00:00Z')), true);
    await updateContactMessage(db, 'm1', { read: true }, new Date('2026-11-12T00:00:00Z'));
    assert.equal((await getContactMessage(db, 'm1'))?.read_at, '2026-11-11T00:00:00.000Z', 'the first read time stays');
    assert.equal((await contactCounts(db)).unread, 1);
    assert.deepEqual((await listContactMessages(db, { read: 'unread', limit: 20, offset: 0 })).messages.map((m) => m.id), ['m2']);
    assert.deepEqual((await listContactMessages(db, { read: 'read', limit: 20, offset: 0 })).messages.map((m) => m.id), ['m1']);
    await updateContactMessage(db, 'm1', { read: false }, new Date());
    assert.equal((await contactCounts(db)).unread, 2);
  });

  it('in progress is a status; spam records why and leaving spam clears it', async () => {
    const db = sqliteD1();
    await insertContactMessage(db, msg('m1'), roomy);
    await updateContactMessage(db, 'm1', { status: 'in_progress' }, new Date());
    assert.equal((await contactCounts(db)).in_progress, 1);
    await updateContactMessage(db, 'm1', { status: 'spam' }, new Date());
    assert.equal((await getContactMessage(db, 'm1'))?.spam_reason, 'admin');
    await updateContactMessage(db, 'm1', { status: 'open' }, new Date());
    assert.equal((await getContactMessage(db, 'm1'))?.spam_reason, null);
  });

  it('a list filtered by an assignee id', async () => {
    const db = sqliteD1();
    await insertContactMessage(db, msg('m1'), roomy);
    await insertContactMessage(db, msg('m2'), roomy);
    await updateContactMessage(db, 'm2', { assignee: { id: 'usr_b', email: 'b@x.org' } }, new Date());
    assert.deepEqual((await listContactMessages(db, { assignee: 'usr_b', limit: 20, offset: 0 })).messages.map((m) => m.id), ['m2']);
  });

  it('bulk changes are idempotent and report missing ids', async () => {
    const db = sqliteD1();
    await insertContactMessage(db, msg('m1'), roomy);
    await insertContactMessage(db, msg('m2'), roomy);
    const first = await updateContactMessages(db, ['m1', 'm2', 'm1', 'gone'], { status: 'closed' }, new Date());
    assert.deepEqual(first, { ok: ['m1', 'm2'], missing: ['gone'] });
    const again = await updateContactMessages(db, ['m1', 'm2'], { status: 'closed' }, new Date());
    assert.deepEqual(again.ok, ['m1', 'm2']);
    assert.equal((await contactCounts(db)).closed, 2);
  });

  it('the roster writes at most once a day per admin and finds by email', async () => {
    const db = sqliteD1();
    await touchContactStaff(db, { id: 'usr_a', email: 'amina@alummahnow.net' }, new Date('2026-11-10T09:00:00Z'));
    await touchContactStaff(db, { id: 'usr_a', email: 'amina@alummahnow.net' }, new Date('2026-11-10T15:00:00Z'));
    assert.equal((await getContactStaff(db, 'usr_a'))?.last_seen_at, '2026-11-10T09:00:00.000Z', 'not rewritten within a day');
    await touchContactStaff(db, { id: 'usr_a', email: 'amina@alummahnow.net' }, new Date('2026-11-11T10:00:00Z'));
    assert.equal((await getContactStaff(db, 'usr_a'))?.last_seen_at, '2026-11-11T10:00:00.000Z');
    await touchContactStaff(db, { id: 'usr_b', email: 'bilal@alummahnow.net' }, new Date('2026-11-11T11:00:00Z'));
    const now = new Date('2026-11-12T00:00:00Z');
    assert.deepEqual((await listContactStaff(db, 'bil', 20, now)).map((r) => r.user_id), ['usr_b']);
    assert.deepEqual((await listContactStaff(db, '', 20, now)).map((r) => r.user_id), ['usr_b', 'usr_a']);
    assert.deepEqual(await listContactStaff(db, '', 20, new Date('2027-11-12T00:00:00Z')), [], 'not seen in 180 days');
    assert.equal(await getContactStaff(db, 'usr_x'), null);
  });

  it('a delivered reply marks the message replied and read', async () => {
    const db = sqliteD1();
    await insertContactMessage(db, msg('m1'), roomy);
    await insertContactNote(db, { id: 'r1', message_id: 'm1', kind: 'reply', body: 'done', author_id: 'adm', author_email: null, email_to: 'aisha@example.org', email_subject: 's', email_status: 'queued', email_id: null, created_at: '2026-11-10T10:00:00Z' });
    await recordDelivery(db, { messageId: 'm1', kind: 'reply', noteId: 'r1', status: 'sent', now: new Date('2026-11-10T10:01:00Z') });
    const row = await getContactMessage(db, 'm1');
    assert.equal(row?.status, 'replied');
    assert.equal(row?.read_at, '2026-11-10T10:01:00.000Z');
    assert.equal((await listContactNotes(db, 'm1')).length, 1);
  });
});

describe('contact endpoints: assign, bulk, restore, roster', () => {
  async function appFor() {
    const { default: contactRouter } = await import('../src/routers/contact.router');
    const db = sqliteD1();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const user = c.req.header('x-test-user') ?? 'usr_a';
      c.set('auth' as never, { userId: user, email: `${user}@alummahnow.net`, roles: (c.req.header('x-test-roles') ?? 'admin').split(',') } as never);
      await next();
    });
    app.route('/api/contact', contactRouter as never);
    const env = { REPORTS_DB: db };
    const request = (path: string, init: { method?: string; body?: unknown; user?: string; roles?: string } = {}) =>
      app.request(
        path,
        { method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body), headers: { 'content-type': 'application/json', 'x-test-user': init.user ?? 'usr_a', 'x-test-roles': init.roles ?? 'admin' } },
        env,
      );
    return { db, request };
  }

  it('assigns only to admins on the roster; "me" and null always work', async () => {
    const { db, request } = await appFor();
    await insertContactMessage(db, msg('m1'), roomy);
    const patch = (body: unknown, user = 'usr_a') => request('/api/contact/messages/m1', { method: 'PATCH', body, user });
    assert.equal((await patch({ assignee: 'usr_b' })).status, 400, 'usr_b never used the inbox');
    // usr_b opens the inbox: on the roster
    assert.equal((await request('/api/contact/messages', { user: 'usr_b' })).status, 200);
    const staff = (await (await request('/api/contact/staff?q=usr_b')).json()) as { result: { items: { id: string; label: string }[] } };
    assert.deepEqual(staff.result.items.map((i) => [i.id, i.label]), [['usr_b', 'usr_b@alummahnow.net']]);
    assert.equal((await patch({ assignee: 'usr_b' })).status, 200);
    assert.equal((await getContactMessage(db, 'm1'))?.assignee_email, 'usr_b@alummahnow.net');
    assert.equal((await patch({ assignee: 'me' })).status, 200);
    assert.equal((await getContactMessage(db, 'm1'))?.assignee_id, 'usr_a');
    assert.equal((await patch({ assignee: null })).status, 200);
    assert.equal((await getContactMessage(db, 'm1'))?.assignee_id, null);
    // A moderator is never put on the roster and cannot change messages
    assert.equal((await request('/api/contact/messages', { user: 'usr_m', roles: 'moderator' })).status, 403);
    assert.equal(await getContactStaff(db, 'usr_m'), null);
  });

  it('read/unread and in progress through PATCH', async () => {
    const { db, request } = await appFor();
    await insertContactMessage(db, msg('m1'), roomy);
    assert.equal((await request('/api/contact/messages/m1', { method: 'PATCH', body: { read: true } })).status, 200);
    assert.notEqual((await getContactMessage(db, 'm1'))?.read_at, null);
    assert.equal((await request('/api/contact/messages/m1', { method: 'PATCH', body: { status: 'in_progress' } })).status, 200);
    assert.equal((await request('/api/contact/messages/m1', { method: 'PATCH', body: { status: 'new' } })).status, 400, "'new' is no longer a status");
    const counts = (await (await request('/api/contact/counts')).json()) as { result: Record<string, number> };
    assert.equal(counts.result.unread, 0);
    assert.equal(counts.result.in_progress, 1);
  });

  it('bulk: one change for many ids, idempotent; delete is soft and restore undoes it', async () => {
    const { db, request } = await appFor();
    await insertContactMessage(db, msg('m1'), roomy);
    await insertContactMessage(db, msg('m2'), roomy);
    const bulk = (body: unknown) => request('/api/contact/messages/bulk', { method: 'POST', body });
    assert.equal((await bulk({ ids: ['m1'], read: true, status: 'closed' })).status, 400, 'exactly one change');
    const read = (await (await bulk({ ids: ['m1', 'm2', 'zz'], read: true })).json()) as { result: { ok: string[]; missing: string[] } };
    assert.deepEqual(read.result, { ok: ['m1', 'm2'], missing: ['zz'] });
    assert.equal((await contactCounts(db)).unread, 0);
    const del = (await (await bulk({ ids: ['m1', 'm2'], delete: true })).json()) as { result: { ok: string[] } };
    assert.deepEqual(del.result.ok, ['m1', 'm2']);
    assert.equal((await listContactMessages(db, { limit: 20, offset: 0 })).total, 0);
    const again = (await (await bulk({ ids: ['m1'], delete: true })).json()) as { result: { ok: string[]; missing: string[] } };
    assert.deepEqual(again.result, { ok: [], missing: ['m1'] }, 'deleting twice changes nothing');
    const undo = (await (await request('/api/contact/messages/restore', { method: 'POST', body: { ids: ['m1', 'm2'] } })).json()) as { result: { ok: string[] } };
    assert.deepEqual(undo.result.ok, ['m1', 'm2']);
    assert.equal((await listContactMessages(db, { limit: 20, offset: 0 })).total, 2);
  });
});
