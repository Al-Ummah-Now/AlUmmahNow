import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_LIMITS,
  CONTACT_RATE_LIMITS,
  cleanPageUrl,
  hashIp,
  isLikelyBot,
  isSinkAddress,
  rateLimitsFor,
  safeEqual,
  validateContactInput,
} from '../src/lib/contact';
import { hasPermission, permissionsFor } from '../src/lib/roles';
import { renderAcknowledgement, renderInboxNotification, renderReply, sendContactEmail, quoteText } from '../src/lib/contact-email';
import {
  contactCounts,
  getContactMessage,
  getContactThread,
  listDeletedContactMessages,
  purgeContactMessages,
  requestContactPurge,
  restoreContactMessage,
  softDeleteContactMessage,
  insertContactMessage,
  insertContactNote,
  listContactMessages,
  listContactNotes,
  updateContactMessage,
} from '../src/lib/contact-store';
import { sqliteD1 } from './d1-sqlite';

const valid = { name: 'Amina', email: 'Amina@Example.org', topic: 'general', message: 'Assalamu alaikum, a question about playlists.', locale: 'ar', pageUrl: 'https://videos.alummahnow.net/ar/settings' };

describe('validateContactInput', () => {
  it('accepts a good message and normalises it', () => {
    const r = validateContactInput({ ...valid, name: '  Amina \n Y ', message: 'line one\r\nline two is here' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.name, 'Amina Y');
    assert.equal(r.value.email, 'amina@example.org');
    assert.equal(r.value.message, 'line one\nline two is here');
    assert.equal(r.value.locale, 'ar');
    assert.equal(r.value.pageUrl, 'https://videos.alummahnow.net/ar/settings');
  });

  it('reports every bad field', () => {
    const r = validateContactInput({ name: '', email: 'not-an-email', topic: 'sales', message: 'short' });
    assert.deepEqual(r, { ok: false, errors: { name: 'required', email: 'invalid', topic: 'invalid', message: 'tooShort' } });
  });

  it('enforces the length limits', () => {
    const r = validateContactInput({ ...valid, name: 'n'.repeat(CONTACT_LIMITS.nameMax + 1), message: 'm'.repeat(CONTACT_LIMITS.messageMax + 1) });
    assert.deepEqual(r, { ok: false, errors: { name: 'tooLong', message: 'tooLong' } });
    assert.equal(validateContactInput({ ...valid, message: 'm'.repeat(CONTACT_LIMITS.messageMax) }).ok, true);
  });

  it('uses the signed-in account email instead of the form email', () => {
    const r = validateContactInput({ ...valid, email: 'someone-else@example.org' }, 'Me@Account.org');
    assert.equal(r.ok && r.value.email, 'me@account.org');
  });

  it('falls back to English for an unknown locale and drops foreign page URLs', () => {
    const r = validateContactInput({ ...valid, locale: 'fr', pageUrl: 'https://evil.example/x' });
    assert.equal(r.ok && r.value.locale, 'en');
    assert.equal(r.ok && r.value.pageUrl, null);
  });
});

describe('cleanPageUrl', () => {
  it('keeps only http(s) URLs on our hosts', () => {
    assert.equal(cleanPageUrl('https://videos.qa.alummahnow.net/en/video/1'), 'https://videos.qa.alummahnow.net/en/video/1');
    assert.equal(cleanPageUrl('http://localhost:3001/en'), 'http://localhost:3001/en');
    assert.equal(cleanPageUrl('javascript:alert(1)'), null);
    assert.equal(cleanPageUrl('https://alummahnow.net.evil.example/'), null);
    assert.equal(cleanPageUrl(`https://videos.alummahnow.net/${'a'.repeat(3000)}`), null);
    assert.equal(cleanPageUrl(42), null);
  });
});

describe('isLikelyBot', () => {
  it('flags a filled honeypot and a too-fast or missing fill time', () => {
    assert.equal(isLikelyBot({ ...valid, website: 'http://spam', elapsedMs: 9000 }), true);
    assert.equal(isLikelyBot({ ...valid, elapsedMs: 800 }), true);
    assert.equal(isLikelyBot({ ...valid }), true);
    assert.equal(isLikelyBot({ ...valid, website: '', elapsedMs: 9000 }), false);
  });
});

describe('rate limits and sink addresses', () => {
  it('is strict in production and roomy elsewhere', () => {
    assert.deepEqual(rateLimitsFor('production'), CONTACT_RATE_LIMITS.strict);
    assert.deepEqual(rateLimitsFor('qa'), CONTACT_RATE_LIMITS.relaxed);
    assert.ok(CONTACT_RATE_LIMITS.strict.perIpHour <= 5);
  });

  it('sinks E2E addresses only outside production', () => {
    assert.equal(isSinkAddress('x@e2e.alummahnow.net', 'qa'), true);
    assert.equal(isSinkAddress('x@E2E.alummahnow.net', 'stage'), true);
    assert.equal(isSinkAddress('x@e2e.alummahnow.net', 'production'), false);
    assert.equal(isSinkAddress('x@example.org', 'qa'), false);
  });

  it('hashes IPs with a key and compares keys in constant time', async () => {
    const a = await hashIp('203.0.113.9', 'k1');
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, await hashIp('203.0.113.9', 'k1'));
    assert.notEqual(a, await hashIp('203.0.113.9', 'k2'));
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('contact permissions (RBAC)', () => {
  it('grants contact:read and contact:manage to admins and super admins only', () => {
    for (const roles of [['Admin'], ['Super Admin'], ['super_admin']]) {
      assert.equal(hasPermission(roles, 'contact:read'), true, String(roles));
      assert.equal(hasPermission(roles, 'contact:manage'), true, String(roles));
    }
    for (const roles of [['Moderator'], ['User'], [], undefined]) {
      assert.equal(hasPermission(roles, 'contact:read'), false, String(roles));
      assert.equal(hasPermission(roles, 'contact:manage'), false, String(roles));
    }
    assert.deepEqual(permissionsFor(['Admin']).filter((p) => !p.startsWith('auth_requests:')), ['contact:manage', 'contact:read', 'errors:manage', 'errors:read', 'media:manage', 'ops:read', 'settings:manage', 'status:manage', 'videos:format', 'videos:processing', 'videos:uploads']);
    assert.deepEqual(permissionsFor(['Moderator']), ['auth_requests:read']);
  });
});

const message = {
  id: 'm1',
  name: 'Amina',
  email: 'amina@example.org',
  topic: 'account' as const,
  message: 'I cannot sign in.\nPlease help <b>now</b>.',
  locale: 'ar' as const,
  page_url: null,
  user_id: 'usr_1',
  created_at: '2026-11-09T10:00:00.000Z',
};

describe('contact emails', () => {
  it('quotes the original message under a reply, in the message language', () => {
    const mail = renderReply(message, 'Try resetting your password.', { replyTo: 'support@alummahnow.net', environment: 'production' });
    assert.equal(mail.to, 'amina@example.org');
    assert.equal(mail.subject, 'رد: رسالتك إلى الأمة الآن');
    assert.equal(mail.replyTo, 'support@alummahnow.net');
    assert.ok(mail.text.startsWith('السلام عليكم Amina،\n\nTry resetting your password.'));
    assert.ok(mail.text.includes(quoteText(message.message)));
    assert.match(mail.html, /<html lang="ar" dir="rtl"/);
    assert.ok(mail.html.includes('&lt;b&gt;now&lt;/b&gt;'), 'escapes HTML from the sender');
    assert.equal(renderReply({ ...message, locale: 'en' }, 'Hi', {}).subject, 'Re: your message to Al Ummah Now');
  });

  it('tags subjects outside production', () => {
    assert.equal(renderAcknowledgement({ ...message, locale: 'en' }, { environment: 'qa' }).subject, '[qa] We received your message');
    assert.equal(renderAcknowledgement(message, { environment: 'production' }).subject, 'وصلتنا رسالتك');
  });

  it('notifies the inbox with a link to the admin message and Reply-To the sender', () => {
    const mail = renderInboxNotification(message, { to: 'support@alummahnow.net', adminUrl: 'https://admin.alummahnow.net/', environment: 'production' });
    assert.equal(mail.replyTo, 'amina@example.org');
    assert.equal(mail.subject, '[Contact] Account & sign-in: Amina');
    assert.match(mail.text, /^Open in the admin inbox:\nhttps:\/\/admin\.alummahnow\.net\/contact\/m1$/m);
  });

  it('sinks E2E addresses, skips without a key and reports Resend failures', async () => {
    const calls: RequestInit[] = [];
    const ok = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
    }) as unknown as typeof fetch;
    const mail = renderReply(message, 'Hi', {});
    assert.deepEqual(await sendContactEmail({ ENVIRONMENT: 'qa', RESEND_API_KEY: 'k' }, { ...mail, to: 'a@e2e.alummahnow.net' }, { fetchImpl: ok }), { status: 'sunk' });
    assert.deepEqual(await sendContactEmail({ ENVIRONMENT: 'production' }, mail, { fetchImpl: ok }), { status: 'failed', error: 'RESEND_API_KEY is not bound', retryable: false });
    assert.deepEqual(await sendContactEmail({ ENVIRONMENT: 'production', RESEND_API_KEY: { get: async () => 'k' } }, mail, { fetchImpl: ok, idempotencyKey: 'x' }), { status: 'sent', id: 're_1' });
    assert.equal(calls.length, 1);
    const sent = JSON.parse(String(calls[0].body));
    assert.deepEqual(sent.to, ['amina@example.org']);
    assert.equal(sent.from, 'Al Ummah Now <support@alummahnow.net>');
    assert.equal((calls[0].headers as Record<string, string>)['Idempotency-Key'], 'x');
    const bad = (async () => new Response('nope', { status: 422 })) as unknown as typeof fetch;
    assert.equal((await sendContactEmail({ RESEND_API_KEY: 'k' }, mail, { fetchImpl: bad })).retryable, false, '4xx is permanent');
    const down = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    assert.equal((await sendContactEmail({ RESEND_API_KEY: 'k' }, mail, { fetchImpl: down })).retryable, true, '5xx is retried');
    const offline = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    assert.equal((await sendContactEmail({ RESEND_API_KEY: 'k' }, mail, { fetchImpl: offline })).retryable, true);
  });
});

function newMessage(id: string, over: Partial<Parameters<typeof insertContactMessage>[1]> = {}) {
  return {
    id,
    name: 'Amina',
    email: 'amina@example.org',
    topic: 'general' as const,
    message: 'A message long enough.',
    locale: 'en' as const,
    pageUrl: null,
    userId: null,
    userAgent: 'test',
    ipHash: 'ip-a',
    now: new Date('2026-11-09T10:00:00.000Z'),
    ...over,
  };
}

describe('contact store (D1)', () => {
  // Every migration: 0019 adds the History columns to contact_messages with the other queues
  const limits = { perIpHour: 2, perIpDay: 3, perUserHour: 1, perUserDay: 5 };

  it('rate-limits per IP per hour and per day', async () => {
    const db = sqliteD1();
    assert.equal(await insertContactMessage(db, newMessage('a'), limits), true);
    assert.equal(await insertContactMessage(db, newMessage('b'), limits), true);
    assert.equal(await insertContactMessage(db, newMessage('c'), limits), false, 'third in an hour');
    assert.equal(await insertContactMessage(db, newMessage('c', { ipHash: 'ip-b' }), limits), true, 'other IPs are not affected');
    const later = new Date('2026-11-09T11:30:00.000Z');
    assert.equal(await insertContactMessage(db, newMessage('d', { now: later }), limits), true, 'a new hour');
    assert.equal(await insertContactMessage(db, newMessage('e', { now: new Date('2026-11-09T13:00:00.000Z') }), limits), false, 'day limit');
    assert.equal((await getContactMessage(db, 'c'))?.status, 'new');
    assert.equal(await getContactMessage(db, 'e'), null);
  });

  it('rate-limits per account across IPs', async () => {
    const db = sqliteD1();
    assert.equal(await insertContactMessage(db, newMessage('a', { userId: 'u1' }), limits), true);
    assert.equal(await insertContactMessage(db, newMessage('b', { userId: 'u1', ipHash: 'ip-z' }), limits), false);
    assert.equal(await insertContactMessage(db, newMessage('c', { userId: 'u2', ipHash: 'ip-z' }), limits), true);
  });

  it('lists with filters, search, pagination and counts; updates, notes and deletes', async () => {
    const db = sqliteD1();
    const roomy = { perIpHour: 99, perIpDay: 99, perUserHour: 99, perUserDay: 99 };
    await insertContactMessage(db, newMessage('m1', { topic: 'problem', message: 'The player 100% froze', now: new Date('2026-11-01T09:00:00Z') }), roomy);
    await insertContactMessage(db, newMessage('m2', { name: 'Bilal', email: 'bilal@example.org', now: new Date('2026-11-05T09:00:00Z') }), roomy);
    await insertContactMessage(db, newMessage('m3', { topic: 'partnership', now: new Date('2026-11-08T09:00:00Z') }), roomy);

    const all = await listContactMessages(db, { limit: 2, offset: 0 });
    assert.equal(all.total, 3);
    assert.deepEqual(all.messages.map((m) => m.id), ['m3', 'm2']);
    assert.ok(!('ip_hash' in all.messages[0]), 'the IP hash never leaves the database');
    assert.deepEqual((await listContactMessages(db, { limit: 20, offset: 2 })).messages.map((m) => m.id), ['m1']);
    assert.deepEqual((await listContactMessages(db, { topic: 'problem', limit: 20, offset: 0 })).messages.map((m) => m.id), ['m1']);
    assert.deepEqual((await listContactMessages(db, { q: 'bilal', limit: 20, offset: 0 })).messages.map((m) => m.id), ['m2']);
    assert.deepEqual((await listContactMessages(db, { q: '100%', limit: 20, offset: 0 })).messages.map((m) => m.id), ['m1'], '% is literal');
    assert.equal((await listContactMessages(db, { q: '_', limit: 20, offset: 0 })).total, 0, '_ is literal');
    assert.deepEqual((await listContactMessages(db, { from: '2026-11-02', to: '2026-11-05', limit: 20, offset: 0 })).messages.map((m) => m.id), ['m2']);

    assert.equal(await updateContactMessage(db, 'm2', { status: 'open', assignee: { id: 'adm', email: 'adm@x.org' } }, new Date()), true);
    assert.equal(await updateContactMessage(db, 'missing', { status: 'open' }, new Date()), false);
    assert.deepEqual((await listContactMessages(db, { assignee: 'me', viewerId: 'adm', limit: 20, offset: 0 })).messages.map((m) => m.id), ['m2']);
    assert.equal((await listContactMessages(db, { assignee: 'unassigned', limit: 20, offset: 0 })).total, 2);
    assert.deepEqual(await contactCounts(db), { new: 2, open: 1, replied: 0, closed: 0, spam: 0, send_failed: 0 });
    await updateContactMessage(db, 'm2', { assignee: null }, new Date());
    assert.equal((await getContactMessage(db, 'm2'))?.assignee_id, null);

    await insertContactNote(db, { id: 'n1', message_id: 'm2', kind: 'note', body: 'checking', author_id: 'adm', author_email: null, email_to: null, email_subject: null, email_status: null, email_id: null, created_at: '2026-11-09T10:00:00Z' });
    await insertContactNote(db, { id: 'n2', message_id: 'm2', kind: 'reply', body: 'done', author_id: 'adm', author_email: null, email_to: 'bilal@example.org', email_subject: 's', email_status: 'sunk', email_id: null, created_at: '2026-11-09T10:01:00Z' });
    assert.deepEqual((await listContactNotes(db, 'm2')).map((n) => n.id), ['n1', 'n2']);
    // One snapshot: the message and its notes come from the same batch
    const thread = await getContactThread(db, 'm2');
    assert.equal(thread?.message.id, 'm2');
    assert.deepEqual(thread?.notes.map((n) => n.id), ['n1', 'n2']);
    assert.equal(await getContactThread(db, 'missing'), null);

    // Delete is soft: hidden from the list, the counts and the detail; the thread stays until the purge
    const deletedAt = new Date('2026-11-10T08:00:00Z');
    assert.equal(await softDeleteContactMessage(db, 'm2', { actorId: 'adm', reason: 'spam', now: deletedAt }), true);
    assert.equal(await softDeleteContactMessage(db, 'm2', { actorId: 'adm', reason: null, now: deletedAt }), false);
    assert.equal(await getContactMessage(db, 'm2'), null);
    assert.equal((await listContactMessages(db, { limit: 20, offset: 0 })).total, 2);
    assert.equal((await listContactMessages(db, { q: 'bilal', limit: 20, offset: 0 })).total, 0);
    assert.deepEqual(await contactCounts(db), { new: 2, open: 0, replied: 0, closed: 0, spam: 0, send_failed: 0 });
    assert.equal(await updateContactMessage(db, 'm2', { status: 'closed' }, new Date()), false, 'a deleted message cannot be changed');
    assert.deepEqual((await listDeletedContactMessages(db)).map((r) => [r.id, r.deleted_by, r.delete_reason, r.purge_requested_at]), [['m2', 'adm', 'spam', null]]);
    assert.equal((await listContactNotes(db, 'm2')).length, 2);

    // Restore brings it back with its thread
    assert.equal(await restoreContactMessage(db, 'm2'), true);
    assert.equal(await restoreContactMessage(db, 'm2'), false);
    assert.equal((await getContactMessage(db, 'm2'))?.id, 'm2');
    assert.deepEqual(await listDeletedContactMessages(db), []);

    // The purge (cleanup only): not before 30 days unless queued; queuing alone deletes nothing
    await softDeleteContactMessage(db, 'm2', { actorId: 'adm', reason: null, now: deletedAt });
    assert.deepEqual(await purgeContactMessages(db, '2026-11-01T00:00:00.000Z', 10), []);
    assert.equal(await requestContactPurge(db, 'm1', { actorId: 'adm', now: deletedAt }), false, 'only a deleted message can be queued');
    assert.equal(await requestContactPurge(db, 'm2', { actorId: 'adm2', now: deletedAt }), true);
    assert.equal((await listDeletedContactMessages(db))[0].purge_requested_by, 'adm2');
    assert.equal((await listContactNotes(db, 'm2')).length, 2);
    assert.deepEqual(await purgeContactMessages(db, '2026-11-01T00:00:00.000Z', 10), ['m2']);
    assert.deepEqual(await listContactNotes(db, 'm2'), []);
    assert.deepEqual(await listDeletedContactMessages(db), []);
    assert.deepEqual(await purgeContactMessages(db, '2026-11-01T00:00:00.000Z', 10), [], 'idempotent');

    // 30 days after the delete it goes without being queued; live messages never do
    await softDeleteContactMessage(db, 'm3', { actorId: 'adm', reason: null, now: deletedAt });
    assert.deepEqual(await purgeContactMessages(db, '2026-12-10T08:00:00.000Z', 10), ['m3']);
    assert.equal((await getContactMessage(db, 'm1'))?.id, 'm1');
  });
});
