import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { contactSubmit } from '../src/endpoints/contact/ContactSubmit';
import { getContactMessage, listContactMessages } from '../src/lib/contact-store';
import { sqliteD1 } from './d1-sqlite';

function setup(environment = 'qa') {
  const db = sqliteD1(['0008_contact_messages.sql']);
  const env = { INTERNAL_API_KEY: 'internal-key', REPORTS_DB: db, ENVIRONMENT: environment, CONTACT_INBOX: 'support@alummahnow.net' };
  const app = new Hono();
  app.post('/internal/contact', (c) => contactSubmit(c as never));
  const post = (body: unknown, headers: Record<string, string> = { 'X-API-Key': 'internal-key' }) =>
    app.request('/internal/contact', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Client-IP': '198.51.100.7', ...headers } }, env);
  return { db, post };
}

const form = { name: 'Test', email: 'contact-test@e2e.alummahnow.net', topic: 'problem', message: 'Something is broken on the watch page.', locale: 'en', website: '', elapsedMs: 8000 };

describe('POST /internal/contact', () => {
  it('needs the internal API key', async () => {
    const { post } = setup();
    assert.equal((await post(form, {})).status, 401);
    assert.equal((await post(form, { 'X-API-Key': 'wrong' })).status, 401);
  });

  it('stores a valid message and records sunk deliveries for a test address', async () => {
    const { db, post } = setup();
    const res = await post(form);
    assert.equal(res.status, 201);
    const { result } = (await res.json()) as { result: { id: string } };
    const row = await getContactMessage(db, result.id);
    assert.equal(row?.status, 'new');
    assert.equal(row?.email, 'contact-test@e2e.alummahnow.net');
    assert.equal(row?.user_id, null);
    assert.equal(row?.notify_status, 'sunk');
    assert.equal(row?.ack_status, 'sunk');
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
