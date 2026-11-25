/**
 * The emails of a channel move (wiki AUN-CHANNEL-CLAIM CC-7c; lib/channel-move-mail.ts): one language
 * at send time, what each owner reads, sent once, failures on the Errors page with Retry.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountEmailContact, ChannelMoveMail, ChannelMoveMailEvent, ChannelMoveMailJob } from '@al-ummah/shared-types';
import { contactMailConsumer, MAX_ATTEMPTS } from '../src/lib/contact-mail-queue';
import { processChannelMoveMailJob, renderChannelMoveEmail } from '../src/lib/channel-move-mail';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import { sqliteD1 } from './d1-sqlite';

const CHANNEL = { id: 'ch_1', name: 'Morning Adhkar (Daily)', nameLocalized: { ar: 'أذكار الصباح' } };
const OTHER = { name: 'Bilal Ahmed', nameLocalized: { ar: 'بلال أحمد' } };
const MAILS: Record<string, ChannelMoveMail> = {
  offered: { event: 'offered', recipientId: 'usr_1', channel: CHANNEL, other: OTHER, reason: null, keptAsAdmin: false, offer: { id: 'off_1', expiresAt: '2026-12-01T12:00:00.000Z', keepContactEmail: true } },
  moved_in: { event: 'moved_in', recipientId: 'usr_1', channel: CHANNEL, other: OTHER, reason: null, keptAsAdmin: false, offer: null },
  moved_in_team: { event: 'moved_in', recipientId: 'usr_1', channel: CHANNEL, other: null, reason: null, keptAsAdmin: false, offer: null },
  moved_out: { event: 'moved_out', recipientId: 'usr_1', channel: CHANNEL, other: OTHER, reason: null, keptAsAdmin: false, offer: null },
  moved_out_team: { event: 'moved_out', recipientId: 'usr_1', channel: CHANNEL, other: null, reason: 'Asked by email <b>', keptAsAdmin: true, offer: null },
};
const render = (which: keyof typeof MAILS, locale: 'en' | 'ar', over: Partial<ChannelMoveMail> = {}) => {
  return renderChannelMoveEmail({ to: 'a@example.com', name: locale === 'ar' ? 'يوسف' : 'Yusuf', locale, mail: { ...MAILS[which], ...over }, origin: 'https://alummahnow.net' });
};

function setup(which: keyof typeof MAILS | null, contact: Partial<AccountEmailContact> | null = {}) {
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const queued: unknown[] = [];
  const ingest: unknown[] = [];
  const paths: string[] = [];
  const states: string[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'internal-key',
    ENVIRONMENT: 'production',
    RESEND_API_KEY: 'k',
    VIDEOS_WEB_URL: 'https://alummahnow.net',
    CONTACT_MAIL_QUEUE: { send: async (body: unknown) => void queued.push(body) },
    ERRORS_QUEUE: { send: async (body: unknown) => void ingest.push(body) },
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const path = new URL(input).pathname.replace('/internal/admin', '');
        if (path.endsWith('/delivery')) {
          states.push(`${path.split('/')[2]} ${(JSON.parse(String(init?.body)) as { status: string }).status}`);
          return answer(200, { success: true, result: { recorded: true } });
        }
        paths.push(path);
        if (path.startsWith('/channel-move-mails/')) return which ? answer(200, { success: true, result: MAILS[which] }) : answer(404, { success: false, code: 'nothing_to_send' });
        if (path === '/users/usr_1/account-email') return contact ? answer(200, { success: true, result: { userId: 'usr_1', email: 'yusuf@example.org', displayName: 'Yusuf', accountEmail: true, locale: 'en', savedLocale: null, ...contact } }) : answer(404, { success: false, code: 'user_not_found' });
        return answer(404, { success: false });
      },
    },
  };
  return { env, queued, ingest, paths, states };
}

function msg(event: ChannelMoveMailEvent, attempts = 1) {
  const body: ChannelMoveMailJob = { v: 1, kind: 'channel_move', event, id: 'id_1' };
  const m = { id: 'q1', body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
  return Object.assign(m, { ack: () => void (m.acked = true), retry: (o?: { delaySeconds?: number }) => void (m.retried = o ?? {}) });
}

describe('channel move emails', () => {
  const realFetch = globalThis.fetch;
  let sent: { body: Record<string, unknown>; key?: string }[] = [];
  let respond: () => Response;
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

  it('an offer: who, what accepting means, until when, and the offer’s page', () => {
    const en = render('offered', 'en');
    assert.equal(en.subject, 'Bilal Ahmed offered you Morning Adhkar (Daily)');
    for (const part of [/wants to hand Morning Adhkar \(Daily\) over to you/, /you become the owner of the channel, its videos, playlists and posts\. Its public contact email stays\./, /open until 1 December 2026\./, /https:\/\/alummahnow\.net\/en\/channel-moves\/off_1/, /Nothing changes unless you accept/, /settings#notifications/]) assert.match(en.text, part);
    assert.doesNotMatch(render('offered', 'en', { offer: { ...MAILS.offered.offer!, keepContactEmail: false } }).text, /contact email/);
    const ar = render('offered', 'ar');
    assert.equal(ar.subject, 'عرض من بلال أحمد لنقل القناة أذكار الصباح إليك');
    assert.match(ar.text, /العرض مفتوح حتى ١ ديسمبر ٢٠٢٦/);
    assert.match(ar.text, /\/ar\/channel-moves\/off_1/);
  });

  it('a move by its owner: each is told, by name', () => {
    assert.equal(render('moved_in', 'en').subject, 'You are now the owner of Morning Adhkar (Daily)');
    assert.match(render('moved_in', 'en').text, /The move from Bilal Ahmed is done[\s\S]*\/en\/channels\/ch_1/);
    assert.match(render('moved_out', 'en').text, /Bilal Ahmed accepted your offer, and Morning Adhkar \(Daily\) is now theirs\.[\s\S]*no longer have access[\s\S]*\/en\/contact/);
    assert.match(render('moved_out', 'ar').text, /قُبل عرضك، وانتقلت ملكية القناة أذكار الصباح إلى بلال أحمد\./);
  });

  it('a move by the team: the reason as written to the previous owner, escaped, and whether they stay on the team; nobody is named', () => {
    const out = render('moved_out_team', 'en');
    assert.match(out.text, /The Al Ummah Now team moved Morning Adhkar \(Daily\) to another account\.[\s\S]*Asked by email <b>[\s\S]*stay on its team as a channel admin/);
    assert.ok(out.html.includes('Asked by email &lt;b&gt;'));
    assert.match(render('moved_in_team', 'en').text, /The Al Ummah Now team moved Morning Adhkar \(Daily\) to your account/);
    for (const which of ['moved_out_team', 'moved_in_team'] as const) assert.doesNotMatch(render(which, 'en').text, /Bilal|Someone/);
  });

  it('one language, Arabic digits and direction; a person without a name is “Someone”', () => {
    for (const which of Object.keys(MAILS) as Array<keyof typeof MAILS>) {
      const en = render(which, 'en');
      assert.doesNotMatch(en.text.replace(/Asked by email <b>/, ''), /[؀-ۿ]/, String(which));
      assert.match(en.html, /dir="ltr"/);
      const ar = render(which, 'ar');
      assert.match(ar.html, /dir="rtl"/);
      assert.doesNotMatch(ar.text.replace(/https?:\S+/g, '').replace(/Asked by email <b>/, ''), /[A-Za-z0-9]/, String(which));
      // Names carry no direction controls: the layout takes them from every string
      for (const email of [en, ar]) assert.doesNotMatch(email.subject + email.text, /[\u202a-\u202e\u2066-\u2069]/);
    }
    assert.match(render('offered', 'en', { other: { name: null } }).text, /Someone wants to hand/);
    assert.match(render('offered', 'ar', { other: { name: null } }).text, /عرض من أحد الأشخاص/);
    assert.match(render('offered', 'en', { channel: { id: 'ch_1', name: null } }).text, /hand a channel over/);
    assert.equal(render('moved_out', 'en', { channel: { id: 'ch_1', name: '\u202emy corner\u2069' } }).subject, 'My corner moved to another account');
    const unnamed = { channel: { id: 'ch_1', name: null } };
    assert.equal(render('moved_in', 'en', unnamed).subject, 'You are now the owner of a channel');
    assert.equal(render('moved_in', 'ar', unnamed).subject, 'انتقلت ملكية قناة إليك');
    assert.equal(render('moved_out', 'en', unnamed).subject, 'Your channel moved to another account');
    assert.equal(render('moved_out', 'ar', unnamed).subject, 'نُقلت قناتك إلى حساب آخر');
  });

  it('sends once through the consumer, in the saved language, reading what it says when it is sent', async () => {
    const s = setup('offered', { locale: 'ar', savedLocale: 'ar' });
    const m = msg('offered');
    await contactMailConsumer({ messages: [m] }, s.env as never);
    assert.ok(m.acked);
    assert.deepEqual(s.paths, ['/channel-move-mails/offered/id_1', '/users/usr_1/account-email']);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.to, ['yusuf@example.org']);
    assert.match(String(sent[0].body.subject), /عرض من بلال أحمد/);
    assert.equal(sent[0].key, 'channel-move-offered-id_1');
    assert.deepEqual(s.states, ['offered sent'], 'kept, so a later Retry sends nothing');
  });

  it('nothing to send any more, no profile or no address: nothing sent; "about my account" off stops the offer and never a move', async () => {
    assert.equal(await processChannelMoveMailJob(setup(null).env as never, msg('offered')), 'done');
    assert.equal(await processChannelMoveMailJob(setup('moved_in', null).env as never, msg('moved_in')), 'done');
    const [noAddress, off] = [setup('moved_in', { email: null }), setup('offered', { accountEmail: false })];
    assert.equal(await processChannelMoveMailJob(noAddress.env as never, msg('moved_in')), 'done');
    assert.equal(await processChannelMoveMailJob(off.env as never, msg('offered')), 'done');
    assert.deepEqual([noAddress.states, off.states], [['moved_in no_address'], ['offered disabled']]);
    assert.equal(sent.length, 0);
    for (const event of ['moved_in', 'moved_out'] as const) assert.equal(await processChannelMoveMailJob(setup(event, { accountEmail: false }).env as never, msg(event)), 'done');
    assert.equal(sent.length, 2);
    assert.equal(await processChannelMoveMailJob(setup('offered').env as never, { ...msg('offered'), body: { v: 2 } as never }), 'done', 'malformed: dropped');
  });

  it('retries a passing failure; on the last attempt flags the Errors page; Retry queues it again', async () => {
    const s = setup('moved_out');
    respond = () => new Response('busy', { status: 503 });
    assert.equal(await processChannelMoveMailJob(s.env as never, msg('moved_out', 1)), 'retry');
    assert.equal(s.ingest.length, 0);
    assert.equal(await processChannelMoveMailJob(s.env as never, msg('moved_out', MAX_ATTEMPTS)), 'failed');
    assert.deepEqual(s.states, ['moved_out failed']);
    assert.match(JSON.stringify(s.ingest), /channel-move-mail/);
    assert.ok(!JSON.stringify(s.ingest).includes('yusuf@example.org'), 'no address on the Errors page');
    const down = setup('moved_out');
    down.env.VIDEOS.fetch = async () => new Response('x', { status: 500 });
    assert.equal(await processChannelMoveMailJob(down.env as never, msg('moved_out', 1)), 'retry');
    const retry = await BUILTIN_RETRIES['channel-move-mail'](s.env as never, { event: 'moved_out', id: 'id_1' }, 'a1');
    assert.equal(retry.ok, true);
    assert.deepEqual(s.queued, [{ v: 1, kind: 'channel_move', event: 'moved_out', id: 'id_1' }]);
    assert.equal((await BUILTIN_RETRIES['channel-move-mail'](s.env as never, { event: 'other', id: 'x' }, 'a1')).ok, false);
  });
});
