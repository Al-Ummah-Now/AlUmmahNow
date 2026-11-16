/**
 * The tier-change email (wiki AUN-TIER-REQUESTS "Telling the user";
 * lib/tier-change-mail.ts): one language at send time, old → new tier and what
 * it now allows, sent once, failures flagged on the Errors page with Retry.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountEmailContact, PublicTier, TierChange } from '@al-ummah/shared-types';
import { contactMailConsumer, MAX_ATTEMPTS } from '../src/lib/contact-mail-queue';
import { processTierChangeMailJob, renderTierChangeEmail, tierAllowsFacts, type TierChangeMailJob } from '../src/lib/tier-change-mail';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import { sqliteD1 } from './d1-sqlite';

const CREATOR = {
  id: 'creator',
  name: 'Creator',
  nameAr: 'صانع محتوى',
  uploads: true,
  uploadsPerDay: 20,
  channels: true,
  maxChannels: 3,
  captionMinutesMonth: 120,
  unlimited: false,
} as unknown as PublicTier;

const CHANGE: TierChange = {
  id: 'tch_1',
  userId: 'usr_1',
  reason: 'admin',
  fromTierId: 'member',
  fromTierName: 'Free',
  fromTierNameAr: 'مجاني',
  toTierId: 'creator',
  toTierName: 'Creator',
  toTierNameAr: 'صانع محتوى',
  toTier: CREATOR,
  createdAt: '2026-11-15T10:00:00.000Z',
  emailStatus: 'queued',
};

function setup(contact: Partial<AccountEmailContact> | null = { email: 'yusuf@example.org', displayName: 'Yusuf' }, change: TierChange | null = { ...CHANGE }) {
  const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const mail: unknown[] = [];
  const ingest: unknown[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'internal-key',
    ENVIRONMENT: 'production',
    RESEND_API_KEY: 'k',
    VIDEOS_WEB_URL: 'https://alummahnow.net',
    CONTACT_MAIL_QUEUE: { send: async (body: unknown) => void mail.push(body) },
    ERRORS_QUEUE: { send: async (body: unknown) => void ingest.push(body) },
    VIDEOS: {
      async fetch(input: string, init: RequestInit = {}) {
        const path = new URL(input).pathname.replace('/internal/admin', '');
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        calls.push({ method: init.method ?? 'GET', path, body });
        if (path === '/tier-changes/tch_1') return change ? answer(200, { success: true, result: { change } }) : answer(404, { success: false, code: 'not_found' });
        if (path === '/tier-changes/tch_1/delivery') {
          if (change && typeof body?.emailStatus === 'string') change.emailStatus = body.emailStatus;
          return answer(200, { success: true, result: { recorded: true } });
        }
        if (/^\/users\/[^/]+\/account-email$/.test(path)) {
          if (!contact) return answer(404, { success: false, code: 'user_not_found' });
          return answer(200, { success: true, result: { userId: 'usr_1', email: null, displayName: '', accountEmail: true, locale: 'en', savedLocale: null, ...contact } });
        }
        return answer(404, { success: false });
      },
    },
  };
  return { env, calls, mail, ingest, change };
}

function msg(attempts = 1) {
  const body: TierChangeMailJob = { v: 1, kind: 'tier_changed', changeId: 'tch_1' };
  const m = { id: 'q1', body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
  return Object.assign(m, { ack: () => void (m.acked = true), retry: (o?: { delaySeconds?: number }) => void (m.retried = o ?? {}) });
}

describe('tier-change email', () => {
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

  it('renders old → new, why, and what the tier now allows, in English and in Arabic (RTL, Arabic digits), linking to /upgrade', () => {
    const en = renderTierChangeEmail({ to: 'a@b.c', name: 'Yusuf', locale: 'en', change: CHANGE, origin: 'https://alummahnow.net', environment: 'qa' });
    assert.equal(en.subject, '[qa] Your tier is now Creator');
    assert.match(en.text, /changed from Free to Creator\. Our team changed it\./);
    assert.match(en.text, /Up to 20 videos a day/);
    assert.match(en.text, /https:\/\/alummahnow\.net\/en\/upgrade/);
    const ar = renderTierChangeEmail({ to: 'a@b.c', name: 'يوسف', locale: 'ar', change: { ...CHANGE, reason: 'subscription' }, origin: 'https://alummahnow.net' });
    assert.equal(ar.subject, 'أصبحت فئتك صانع محتوى');
    assert.match(ar.text, /من مجاني إلى صانع محتوى\. غيّرها اشتراكك\./);
    assert.match(ar.text, /حتى ٢٠ مرئي يوميًا/);
    assert.match(ar.html, /dir="rtl"/);
    assert.doesNotMatch(en.text, /[؀-ۿ]/, 'one language per email');
  });

  it('a step down lists what the new tier allows (no uploads)', () => {
    const rows = tierAllowsFacts({ ...CREATOR, uploads: false, channels: false, captionMinutesMonth: 0 } as PublicTier, 'en');
    assert.deepEqual(rows.slice(0, 2), [['Uploads', 'No'], ['Channels', 'No']]);
  });

  it('sends once, in the saved language, through the contact mail consumer, and records it', async () => {
    const s = setup({ email: 'yusuf@example.org', displayName: 'Yusuf', locale: 'ar' });
    const m = msg();
    await contactMailConsumer({ messages: [m] }, s.env as never);
    assert.ok(m.acked);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.to, ['yusuf@example.org']);
    assert.match(String(sent[0].body.subject), /أصبحت فئتك/);
    assert.equal(sent[0].key, 'tier-change-tch_1');
    assert.equal(s.change?.emailStatus, 'sent');
    assert.equal(await processTierChangeMailJob(s.env as never, msg()), 'done');
    assert.equal(sent.length, 1, 'a duplicate message sends nothing');
  });

  it('"Email me about my account" off, no address, or the change gone: nothing sent, recorded', async () => {
    const off = setup({ email: 'yusuf@example.org', accountEmail: false });
    assert.equal(await processTierChangeMailJob(off.env as never, msg()), 'done');
    assert.equal(off.change?.emailStatus, 'disabled');
    const none = setup(null);
    assert.equal(await processTierChangeMailJob(none.env as never, msg()), 'done');
    assert.equal(none.change?.emailStatus, 'no_address');
    const gone = setup(undefined, null);
    assert.equal(await processTierChangeMailJob(gone.env as never, msg()), 'done');
    assert.equal(sent.length, 0);
  });

  it('retries a passing failure; on the last attempt records it and flags the Errors page; Retry queues it again', async () => {
    const s = setup();
    respond = () => new Response('busy', { status: 503 });
    assert.equal(await processTierChangeMailJob(s.env as never, msg(1)), 'retry');
    assert.equal(await processTierChangeMailJob(s.env as never, msg(MAX_ATTEMPTS)), 'failed');
    assert.equal(s.change?.emailStatus, 'failed');
    assert.ok(s.ingest.length >= 1, 'the Errors page gets a needs-action item');
    assert.match(JSON.stringify(s.ingest), /tier-change-delivery/);
    const retry = await BUILTIN_RETRIES['tier-change-delivery'](s.env as never, { id: 'tch_1' }, 'a1');
    assert.equal(retry.ok, true);
    assert.deepEqual(s.mail, [{ v: 1, kind: 'tier_changed', changeId: 'tch_1' }]);
  });
});
