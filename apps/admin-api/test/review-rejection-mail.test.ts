/**
 * "Video not approved" email (AlUmmahNow#1279, wiki AUN-VIDEO-REVIEW): a reviewer's rejection queues
 * it after the undo window, it is sent in one language (the creator's saved one, else the
 * rejecting admin's), an undone rejection sends nothing, and a final failure is flagged with Retry.
 * Real reports schema (node:sqlite), fake api-videos, Resend stubbed. No AI.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { clearVideoReviewSettingsCache, type AccountEmailContact } from '@al-ummah/shared-types';
import reviewRouter from '../src/routers/review.router';
import { adminMiddleware } from '../src/middleware/auth';
import { contactMailConsumer } from '../src/lib/contact-mail-queue';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import {
  REJECTION_MAIL_DELAY_SECONDS,
  processRejectionMailJob,
  rejectionMailJob,
  renderRejectionEmail,
  type RejectionMailJob,
} from '../src/lib/review/rejection-mail';
import { sqliteD1 } from './d1-sqlite';
import { MemoryR2 } from './r2-fake';

const NOW = new Date().toISOString();

function setup(contact: Partial<AccountEmailContact> | null = { email: 'amina@example.org', displayName: 'Amina' }) {
  clearVideoReviewSettingsCache();
  const db = sqliteD1();
  const queued: Array<{ body: RejectionMailJob; delaySeconds?: number }> = [];
  const ingest: unknown[] = [];
  let queueDown = false;
  const env = {
    REPORTS_DB: db,
    global_settings: new MemoryR2(),
    channels: new MemoryR2(),
    videos: new MemoryR2(),
    INTERNAL_API_KEY: 'k',
    VIDEO_REVIEW_ALLOWED: 'true',
    ENVIRONMENT: 'production',
    RESEND_API_KEY: 'k',
    VIDEOS_WEB_URL: 'https://alummahnow.net',
    CONTACT_MAIL_QUEUE: {
      send: async (body: RejectionMailJob, opts?: { delaySeconds?: number }) => {
        if (queueDown) throw new Error('queue down');
        queued.push({ body, delaySeconds: opts?.delaySeconds });
      },
    },
    ERRORS_QUEUE: { send: async (body: unknown) => { ingest.push(body); } },
    VIDEOS: {
      async fetch(input: string) {
        const path = new URL(input).pathname;
        const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (path.startsWith('/internal/review/')) return json(200, { success: true });
        const m = path.match(/\/users\/([^/]+)\/account-email$/);
        if (m) {
          if (!contact) return json(404, { success: false, code: 'user_not_found', error: 'user_not_found' });
          return json(200, { success: true, result: { userId: m[1], email: null, displayName: '', accountEmail: true, locale: 'en', savedLocale: null, ...contact } });
        }
        return json(200, { success: true, result: {} });
      },
    },
  };
  env.videos.set('v1', { id: 'v1', title: 'Friday talk', userId: 'u1', channelId: 'ch1', review: { status: 'in_review' } });
  const row = { id: 'r1', subject_type: 'video', subject_id: 'v1', channel_id: 'ch1', owner_id: 'u1', status: 'in_review', mode: 'enforce', timing: 'pre', created_at: NOW, updated_at: NOW, sla_due_at: NOW, nsfw: 0, escalate: 0 };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO content_reviews (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...Object.values(row)).run();
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'rev1', roles: ['content_reviewer'], payload: {} } as never);
    await next();
  });
  app.use('/api/*', adminMiddleware as never);
  app.route('/api/review', reviewRouter as never);
  const decide = async (body: Record<string, unknown>) => {
    const res = await app.request('/api/review/r1/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env as never);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { db, env, queued, ingest, decide, setQueueDown: (v: boolean) => (queueDown = v) };
}

describe('video not approved: email', () => {
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

  function msg(body: RejectionMailJob, attempts = 1) {
    const m = { id: 'q1', body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
    return Object.assign(m, { ack: () => { m.acked = true; }, retry: (o?: { delaySeconds?: number }) => { m.retried = o ?? {}; } });
  }

  it('renders in one language with the reason Studio shows and the Studio link', () => {
    const en = renderRejectionEmail({ to: 'a@b.c', name: 'Amina', locale: 'en', videoId: 'v1', title: 'Friday talk', reasonCode: 'misleading_metadata', origin: 'https://alummahnow.net', environment: 'qa' });
    assert.equal(en.subject, '[qa] Your video was not approved');
    assert.match(en.text, /"Friday talk"/);
    assert.match(en.text, /Reason: a title, thumbnail or description that does not match the video/);
    assert.match(en.text, /https:\/\/alummahnow\.net\/en\/studio\/video\/v1\/edit/);
    assert.match(en.text, /appeal/i);
    assert.match(en.html, /dir="ltr"/);
    const ar = renderRejectionEmail({ to: 'a@b.c', name: 'أمينة', locale: 'ar', videoId: 'v1', title: 'خطبة', reasonCode: 'not-a-code', origin: 'https://alummahnow.net', environment: 'production' });
    assert.equal(ar.subject, 'لم تتم الموافقة على مرئيك');
    assert.match(ar.text, /السبب: /);
    assert.match(ar.text, /\/ar\/studio\/video\/v1\/edit/);
    assert.doesNotMatch(ar.text, /Reason|Assalamu|not approved/i, 'Arabic only, never bilingual');
    assert.doesNotMatch(ar.text, /فيديو/, 'the Arabic word for video is «مرئي»');
    assert.match(ar.html, /dir="rtl"/);
  });

  it('a rejection queues the email after the undo window, in the rejecting admin\'s language; approval queues nothing', async () => {
    const t = setup();
    assert.equal((await t.decide({ decision: 'reject', reasonCode: 'spam_scam', locale: 'ar' })).status, 200);
    assert.equal(t.queued.length, 1);
    assert.equal(t.queued[0].delaySeconds, REJECTION_MAIL_DELAY_SECONDS);
    assert.ok(REJECTION_MAIL_DELAY_SECONDS > 10 * 60, 'after the 10-minute undo window');
    assert.deepEqual({ ...t.queued[0].body, decidedAt: 'x' }, { v: 1, kind: 'review_rejected', reviewId: 'r1', decidedAt: 'x', adminLocale: 'ar' });
    const other = setup();
    await other.decide({ decision: 'approve' });
    assert.equal(other.queued.length, 0);
  });

  it('sends once, in the creator\'s saved language over the admin\'s, through the mail queue consumer', async () => {
    const t = setup({ email: 'amina@example.org', displayName: 'Amina', savedLocale: 'en', locale: 'en' });
    await t.decide({ decision: 'reject', reasonCode: 'copyright', locale: 'ar' });
    const m = msg(t.queued[0].body);
    await contactMailConsumer({ messages: [m] }, t.env as never);
    assert.ok(m.acked);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.to, ['amina@example.org']);
    assert.equal(sent[0].body.subject, 'Your video was not approved');
    assert.match(String(sent[0].body.text), /content you do not have the rights to share/);
    assert.equal(sent[0].key, `review-rejected-r1-${t.queued[0].body.decidedAt}`);
  });

  it('uses the admin\'s language when the creator never picked one', async () => {
    const t = setup({ email: 'amina@example.org', savedLocale: null, locale: 'en' });
    await t.decide({ decision: 'reject', reasonCode: 'hate', locale: 'ar' });
    assert.equal(await processRejectionMailJob(t.env as never, msg(t.queued[0].body)), 'done');
    assert.equal(sent[0].body.subject, 'لم تتم الموافقة على مرئيك');
  });

  it('sends nothing for an undone rejection, account emails off, no address or a deleted profile', async () => {
    const undone = setup();
    await undone.decide({ decision: 'reject', reasonCode: 'hate' });
    await undone.decide({ decision: 'undo' });
    assert.equal(await processRejectionMailJob(undone.env as never, msg(undone.queued[0].body)), 'done');
    for (const contact of [{ email: 'a@b.c', accountEmail: false }, { email: null }, null]) {
      const t = setup(contact);
      await t.decide({ decision: 'reject', reasonCode: 'hate' });
      assert.equal(await processRejectionMailJob(t.env as never, msg(t.queued[0].body)), 'done');
    }
    assert.equal(sent.length, 0);
  });

  it('retries a passing failure, then flags it on the Errors page; Retry queues it again', async () => {
    const t = setup();
    await t.decide({ decision: 'reject', reasonCode: 'hate', locale: 'ar' });
    const job = t.queued[0].body;
    respond = () => new Response('busy', { status: 503 });
    assert.equal(await processRejectionMailJob(t.env as never, msg(job, 1)), 'retry');
    assert.equal(await processRejectionMailJob(t.env as never, msg(job, 6)), 'failed');
    const flagged = JSON.stringify(t.ingest);
    assert.match(flagged, /review-rejection-email:r1/);
    assert.match(flagged, /"handler":"review-rejection-email"/);
    const retry = await BUILTIN_RETRIES['review-rejection-email'](t.env as never, { id: 'r1', decidedAt: job.decidedAt, locale: 'ar' }, 'a1');
    assert.deepEqual(retry, { ok: true, status: 'resolved', result: 'Queued again' });
    assert.equal(t.queued.length, 2);
    assert.deepEqual(t.queued[1].body, job, 'same job, same language');
    assert.equal(t.queued[1].delaySeconds, 0);
    const stale = await BUILTIN_RETRIES['review-rejection-email'](t.env as never, { id: 'r1', decidedAt: 'earlier', locale: 'en' }, 'a2');
    assert.equal(stale.status, 'resolved');
    assert.equal(t.queued.length, 2, 'a decision made again sends nothing');
  });

  it('flags the email when the queue refuses it; the rejection still stands', async () => {
    const t = setup();
    t.setQueueDown(true);
    assert.equal((await t.decide({ decision: 'reject', reasonCode: 'hate' })).status, 200);
    assert.match(JSON.stringify(t.ingest), /review-rejection-email:r1/);
    assert.equal((await t.db.prepare('SELECT status FROM content_reviews WHERE id = ?').bind('r1').first<{ status: string }>())?.status, 'rejected');
  });

  it('job shape', () => {
    assert.deepEqual(rejectionMailJob('r9', 't', 'en'), { v: 1, kind: 'review_rejected', reviewId: 'r9', decidedAt: 't', adminLocale: 'en' });
  });
});
