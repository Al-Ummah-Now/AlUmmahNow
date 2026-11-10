import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { contactSubmit } from '../src/endpoints/contact/ContactSubmit';
import { getContactMessage, listContactMessages } from '../src/lib/contact-store';
import { sqliteD1 } from './d1-sqlite';

function setup(environment = 'qa') {
  const db = sqliteD1(['0008_contact_messages.sql', '0010_contact_mail_failures.sql']);
  const queued: unknown[] = [];
  const reports: unknown[] = [];
  const queue = { failing: false };
  const env = {
    INTERNAL_API_KEY: 'internal-key',
    REPORTS_DB: db,
    ENVIRONMENT: environment,
    CONTACT_INBOX: 'support@alummahnow.net',
    CONTACT_MAIL_QUEUE: { sendBatch: async (batch: { body: unknown }[]) => { if (queue.failing) throw new Error('queue down'); queued.push(...batch.map((b) => b.body)); } },
    ERRORS_DLQ: { send: async (body: unknown) => { reports.push(body); } },
  };
  const app = new Hono();
  app.post('/internal/contact', (c) => contactSubmit(c as never));
  const post = (body: unknown, headers: Record<string, string> = { 'X-API-Key': 'internal-key' }) =>
    app.request('/internal/contact', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Client-IP': '198.51.100.7', ...headers } }, env);
  return { db, post, queued, reports, queue };
}

const form = { name: 'Test', email: 'contact-test@e2e.alummahnow.net', topic: 'problem', message: 'Something is broken on the watch page.', locale: 'en', website: '', elapsedMs: 8000 };

describe('POST /internal/contact', () => {
  it('needs the internal API key', async () => {
    const { post } = setup();
    assert.equal((await post(form, {})).status, 401);
    assert.equal((await post(form, { 'X-API-Key': 'wrong' })).status, 401);
  });

  it('stores a valid message and queues the notification and acknowledgement (never sends on the request)', async () => {
    const { db, post, queued } = setup();
    const res = await post(form);
    assert.equal(res.status, 201);
    const { result } = (await res.json()) as { result: { id: string } };
    const row = await getContactMessage(db, result.id);
    assert.equal(row?.status, 'new');
    assert.equal(row?.email, 'contact-test@e2e.alummahnow.net');
    assert.equal(row?.user_id, null);
    assert.equal(row?.notify_status, 'queued');
    assert.equal(row?.ack_status, 'queued');
    assert.deepEqual(queued, [
      { v: 1, kind: 'notify', messageId: result.id },
      { v: 1, kind: 'ack', messageId: result.id },
    ]);
  });

  it('flags the message and reports it when the mail cannot be queued', async () => {
    const { db, post, reports, queue } = setup();
    queue.failing = true;
    const res = await post(form);
    assert.equal(res.status, 201, 'the visitor still gets an answer');
    const { result } = (await res.json()) as { result: { id: string } };
    const row = await getContactMessage(db, result.id);
    assert.equal(row?.notify_status, 'failed');
    assert.equal(row?.ack_status, 'failed');
    assert.ok(row?.send_failed_at);
    assert.equal(reports.length, 2);
  });

  it('answers bots like people but stores nothing', async () => {
    const { db, post } = setup();
    assert.equal((await post({ ...form, website: 'http://spam.example' })).status, 201);
    assert.equal((await post({ ...form, elapsedMs: 200 })).status, 201);
    assert.equal((await listContactMessages(db, { limit: 10, offset: 0 })).total, 0);
  });

  it('returns field errors', async () => {
    const { post } = setup();
    const res = await post({ ...form, email: 'nope', message: '' });
    assert.equal(res.status, 400);
    assert.deepEqual(((await res.json()) as { errors: unknown }).errors, { email: 'invalid', message: 'required' });
  });

  it('rejects an invalid user token instead of treating the sender as signed out', async () => {
    const { post } = setup();
    assert.equal((await post(form, { 'X-API-Key': 'internal-key', Authorization: 'Bearer not.a.token' })).status, 401);
  });

  it('rate-limits one IP in production', async () => {
    const { post } = setup('production');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post({ ...form, email: `p${i}@example.org` })).status);
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
  });
});
