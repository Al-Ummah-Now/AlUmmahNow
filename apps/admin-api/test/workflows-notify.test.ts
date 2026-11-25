/**
 * Approval workflow emails (wiki AUN-WORKFLOWS §9, WF-4): one language per email in the shared layout,
 * Eastern Arabic digits, a Review request link (never approve-by-email), one copy per recipient even
 * when the job is retried, the actor not emailed about their own step, and no email when the rule
 * turns email off.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WORKFLOW_ACTIONS, type WorkflowRequestView } from '@al-ummah/shared-types';
import { renderInboxNotification } from '../src/lib/contact-email';
import { processWorkflowNotifyJob, renderWorkflowEmail, fieldValue, arDigits, type WorkflowNotifyJob } from '../src/lib/workflows/notify';
import { clearWorkflowExecutors, proposeChange, registerWorkflowExecutor, ruleVersionStatement } from '../src/lib/workflows/engine';
import { createWorkflowDirectory } from '../src/lib/workflows/directory';
import type { WorkflowCtx } from '../src/lib/workflows/types';

const request: WorkflowRequestView = {
  id: 'wfr_1',
  type: 'support.fees.set',
  scope: '',
  domain: 'money',
  title: { en: 'Change the PayGood card fee (USD)', ar: 'تغيير رسم بطاقات PayGood (USD)' },
  target: { kind: 'fee', id: 'paygood:USD:card' },
  fields: [
    { key: 'bps', label: { en: 'Percentage', ar: 'النسبة' }, kind: 'bps', before: 290, after: 190 },
    { key: 'fixed', label: { en: 'Fixed fee', ar: 'الرسم الثابت' }, kind: 'money', currency: 'USD', before: 30, after: 30 },
    { key: 'methods', label: { en: 'Methods', ar: 'الطرق' }, kind: 'list', before: null, after: ['card', 'wallet'], enumLabels: { card: { en: 'Card', ar: 'بطاقة' }, wallet: { en: 'Wallet', ar: 'محفظة' } } },
  ],
  reason: 'Nonprofit rate approved by PayGood',
  proposedBy: 'fin1',
  proposedAt: '2026-11-23T12:00:00.000Z',
  expiresAt: '2026-11-30T12:00:00.000Z',
  status: 'pending',
  approvalsNeeded: 2,
  approvalsCount: 1,
  version: 2,
  appliedAt: null,
  steps: [],
};

/** Without the direction marks and isolates, which nobody sees. */
const plain = (text: string) => text.replace(/[\u2066-\u2069\u200e\u200f]/g, '');

describe('rendering', () => {
  it('English: subject, intro, changed fields only, the review link and no approve link', () => {
    const e = renderWorkflowEmail({ to: 'a@example.org', locale: 'en', event: 'proposed', request, actorName: 'Amina', names: new Map(), adminUrl: 'https://admin.qa.alummahnow.net/', environment: 'qa' });
    assert.equal(e.subject, '[qa] Approval needed: Change the PayGood card fee (USD)');
    assert.match(e.text, /Amina asked for this change/);
    assert.match(e.text, /Percentage/);
    assert.match(plain(e.text), /2\.9% → 1\.9%/);
    assert.doesNotMatch(e.text, /Fixed fee/, 'unchanged fields are left out');
    assert.match(plain(e.text), /Card, Wallet/);
    assert.match(e.text, /Approvals: 1 of 2/);
    assert.match(e.text, /https:\/\/admin\.qa\.alummahnow\.net\/approvals\/wfr_1/);
    assert.doesNotMatch(e.text + e.html, /\/approve\b/, 'never approve from the email (WF-D5)');
  });

  it('Arabic: Eastern Arabic digits, Arabic comma, right arrow order, no Latin digits in the prose', () => {
    const e = renderWorkflowEmail({ to: 'b@example.org', locale: 'ar', event: 'proposed', request, actorName: 'أمينة', names: new Map(), adminUrl: 'https://admin.alummahnow.net' });
    assert.match(e.subject, /^موافقة مطلوبة: /);
    assert.match(e.text, /الموافقات: ١ من ٢/);
    assert.match(plain(e.text), /٪٢٫٩ ← ٪١٫٩/);
    assert.match(plain(e.text), /بطاقة، محفظة/);
    const prose = e.text.split('\n').filter((l) => !/https?:\/\//.test(l) && !/PayGood|USD/.test(l));
    for (const line of prose) assert.doesNotMatch(line, /[0-9]/, line);
  });

  it('rejections quote the reason; secrets never show a value', () => {
    const rejected = { ...request, status: 'rejected' as const, steps: [{ seq: 2, actor: 'fin2', kind: 'reject' as const, note: 'Wrong currency', stepUp: true, at: '' }] };
    const e = renderWorkflowEmail({ to: 'a@example.org', locale: 'en', event: 'rejected', request: rejected, actorName: 'Bilal', names: new Map() });
    assert.match(e.text, /Wrong currency/);
    assert.equal(fieldValue({ key: 'k', label: { en: 'Key', ar: 'المفتاح' }, kind: 'secret', before: 'set', after: 'replaced' }, 'replaced', 'en', new Map()), 'Replaced');
    assert.equal(arDigits('2026-11-23'), '٢٠٢٦-١١-٢٣');
  });
});

describe('delivery', () => {
  let raw: DatabaseSync;
  let sent: { to: string; key: string | null; subject: string; text: string }[];
  const realFetch = globalThis.fetch;

  function searchD1() {
    raw = new DatabaseSync(':memory:');
    const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
    const exec = (sql: string, args: unknown[]) => {
      const stmt = raw.prepare(sql);
      const params = args.map((a) => (a === undefined ? null : a)) as never[];
      if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
      return { results: [], success: true, meta: { changes: Number(stmt.run(...params).changes) } };
    };
    const statement = (sql: string, args: unknown[] = []) => ({
      bind: (...v: unknown[]) => statement(sql, v),
      first: async () => (exec(sql, args).results as unknown[])[0] ?? null,
      all: async () => exec(sql, args),
      run: async () => exec(sql, args),
      _run: () => exec(sql, args),
    });
    return {
      prepare: (sql: string) => statement(sql),
      batch: async (stmts: { _run: () => unknown }[]) => {
        raw.exec('BEGIN');
        try {
          const out = stmts.map((s) => s._run());
          raw.exec('COMMIT');
          return out;
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      },
    };
  }

  const contacts: Record<string, { email: string | null; locale: 'en' | 'ar'; displayName: string }> = {
    sa1: { email: 'sa1@example.org', locale: 'en', displayName: 'Sara' },
    sa2: { email: 'sa2@example.org', locale: 'ar', displayName: 'سالم' },
  };

  beforeEach(() => {
    sent = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://api.resend.com/')) {
        const body = JSON.parse(String(init?.body));
        const key = new Headers(init?.headers).get('Idempotency-Key');
        if (!sent.some((s) => s.key === key)) sent.push({ to: Array.isArray(body.to) ? body.to[0] : body.to, key, subject: body.subject, text: body.text });
        return Response.json({ id: 'em_1' });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    clearWorkflowExecutors();
  });

  async function setup(email: boolean) {
    const search = searchD1();
    const env = {
      SEARCH_DB: search,
      RESEND_API_KEY: 're_test',
      ENVIRONMENT: 'production',
      ADMIN_WEB_URL: 'https://admin.alummahnow.net',
      INTERNAL_API_KEY: 'k',
      VIDEOS: {
        async fetch(input: string) {
          const id = decodeURIComponent(new URL(input).pathname.split('/').at(-2) ?? '');
          const c = contacts[id];
          return c ? Response.json({ success: true, result: { ...c, accountEmail: true } }) : Response.json({ success: false, code: 'not_found' }, { status: 404 });
        },
      },
    };
    registerWorkflowExecutor<{ key: string }, null>({
      type: 'features.set',
      target: (p) => ({ kind: 'setting', id: p.key }),
      canPropose: async () => true,
      validate: async (_c, i) => i as { key: string },
      describe: async () => ({ title: { en: 'Switch uploads off', ar: 'إيقاف الرفع' }, fields: [{ key: 'on', label: { en: 'On', ar: 'يعمل' }, kind: 'bool', before: true, after: false }], baseVersion: '1' }),
      currentVersion: async () => '1',
      applyStatements: async () => ({ statements: [], result: null }),
    });
    const ctx: WorkflowCtx = { db: search as never, directory: createWorkflowDirectory({ searchDb: search as never }), now: () => new Date('2026-11-23T12:00:00Z'), steppedUp: true };
    const config = { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS['features.set'].defaultRule)), approvalsNeeded: 1, approvers: [{ kind: 'people', userIds: ['sa2'] }], notify: { email, extra: [] } };
    await ruleVersionStatement(ctx, { type: 'features.set', scope: '', version: 1, config, requestId: null, by: 'seed' }).run();
    const out = await proposeChange(ctx, await ctx.directory.actor('sa1', ['super_admin']), { type: 'features.set', payload: { key: 'uploads' }, reason: 'Incident' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    return { env, id };
  }

  const msg = (body: WorkflowNotifyJob) => ({ id: 'm1', body, attempts: 1, ack() {}, retry() {} });

  it('emails each recipient once, in their language, never the actor; a retried job sends no second copy', async () => {
    const { env, id } = await setup(true);
    const job: WorkflowNotifyJob = { v: 1, kind: 'workflow_notify', requestId: id, event: 'proposed', actor: 'sa1', recipients: ['sa1', 'sa2'] };
    assert.equal(await processWorkflowNotifyJob(env as never, msg(job)), 'done');
    assert.equal(await processWorkflowNotifyJob(env as never, msg(job)), 'done');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'sa2@example.org');
    assert.equal(sent[0].subject, 'موافقة مطلوبة: إيقاف الرفع');
    assert.ok(sent[0].key?.startsWith(`workflow-${id}-proposed-sa1-sa2`));
  });

  it('a person whose account is gone shows as a deleted account, in the email\'s language', async () => {
    const { env, id } = await setup(true);
    const fields = [{ key: 'p', label: { en: 'People also told by email', ar: 'أشخاص يُبلَّغون أيضًا بالبريد' }, kind: 'person', before: null, after: ['gone', 'sa1'] }];
    raw.prepare('UPDATE workflow_requests SET diff = ?').run(JSON.stringify({ title: { en: 'T', ar: 'ع' }, fields }));
    const deliver = async (recipient: string, actor: string) => {
      await processWorkflowNotifyJob(env as never, msg({ v: 1, kind: 'workflow_notify', requestId: id, event: 'proposed', actor, recipients: [recipient] }));
      return plain(sent.at(-1)!.text);
    };
    assert.match(await deliver('sa2', 'sa1'), /أشخاص يُبلَّغون أيضًا بالبريد: حساب محذوف، Sara/);
    assert.match(await deliver('sa1', 'sa2'), /People also told by email: Deleted account, Sara/);
    // A lookup that failed is not a deleted account
    const fetcher = env.VIDEOS.fetch;
    env.VIDEOS.fetch = async (input: string) => (input.includes('/gone/') ? Response.json({ success: false, code: 'unavailable' }, { status: 503 }) : fetcher(input));
    raw.prepare("UPDATE workflow_requests SET id = 'wfr_again'").run();
    await processWorkflowNotifyJob(env as never, msg({ v: 1, kind: 'workflow_notify', requestId: 'wfr_again', event: 'proposed', actor: 'sa2', recipients: ['sa1'] }));
    assert.match(plain(sent.at(-1)!.text), /People also told by email: Someone, Sara/);
  });

  it('a recipient without an account email gets none; an unreadable account retries the job', async () => {
    const { env, id } = await setup(true);
    const job: WorkflowNotifyJob = { v: 1, kind: 'workflow_notify', requestId: id, event: 'proposed', actor: 'sa1', recipients: ['sa2'] };
    const before = contacts.sa2.email;
    contacts.sa2.email = null;
    try {
      assert.equal(await processWorkflowNotifyJob(env as never, msg(job)), 'done');
      assert.equal(sent.length, 0);
    } finally {
      contacts.sa2.email = before;
    }
    const down = { ...env, VIDEOS: { fetch: async () => Response.json({ success: false, code: 'auth_unavailable' }, { status: 503 }) } };
    assert.equal(await processWorkflowNotifyJob(down as never, msg(job)), 'retry');
    assert.equal(sent.length, 0);
  });

  it('no email when the rule turns email off', async () => {
    const { env, id } = await setup(false);
    assert.equal(await processWorkflowNotifyJob(env as never, msg({ v: 1, kind: 'workflow_notify', requestId: id, event: 'proposed', actor: 'sa1', recipients: ['sa2'] })), 'done');
    assert.equal(sent.length, 0);
  });
});

describe('review fixes (#1832)', () => {
  const f = (kind: 'money' | 'percent' | 'bps', currency?: string) => ({ key: 'k', label: { en: 'K', ar: 'ك' }, kind, currency, before: null, after: null });
  it('money uses the currency exponent', () => {
    assert.equal(fieldValue(f('money', 'USD'), 1234, 'en', new Map()), '12.34 USD');
    assert.equal(fieldValue(f('money', 'JPY'), 500, 'en', new Map()), '500 JPY');
    assert.equal(fieldValue(f('money', 'KWD'), 1500, 'en', new Map()), '1.500 KWD');
    assert.equal(fieldValue(f('money', 'KWD'), 1500, 'ar', new Map()), '١٫٥٠٠ KWD');
  });
  it('a transient D1 error retries the job instead of dropping it', async () => {
    const broken = { prepare() { throw new Error('D1_ERROR: network connection lost'); } };
    const job: WorkflowNotifyJob = { v: 1, kind: 'workflow_notify', requestId: 'wfr_x', event: 'proposed', actor: 'a', recipients: ['b'] };
    assert.equal(await processWorkflowNotifyJob({ SEARCH_DB: broken } as never, { id: 'm', body: job, attempts: 1, ack() {}, retry() {} }), 'retry');
  });
  it('people: a list names five and counts the rest, and the person a change is about always shows', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const names = new Map(ids.map((id) => [id, `Name ${id}`]));
    const people = { key: 'users', label: { en: 'Creators', ar: 'صنّاع المحتوى' }, kind: 'person' as const, before: null, after: ids };
    const one = (n: string) => `\u2068${n}\u2069`;
    assert.equal(fieldValue(people, ['a', 'z'], 'ar', new Map([['a', 'Yusuf Rahman'], ['z', 'عائشة']])), `${one('Yusuf Rahman')}، ${one('عائشة')}`, 'mixed directions: each name isolated');
    assert.equal(fieldValue(people, ids, 'en', names), `${['a', 'b', 'c', 'd', 'e'].map((x) => one(`Name ${x}`)).join(', ')} and 2 more`);
    assert.match(fieldValue(people, ids, 'ar', names), /و٢ غيرهم$/);
    const about = { key: 'user', label: { en: 'Creator', ar: 'صانع المحتوى' }, kind: 'person' as const, before: 'a', after: 'a' };
    const e = renderWorkflowEmail({ to: 'a@example.org', locale: 'en', event: 'proposed', request: { ...request, fields: [about, people] }, actorName: 'Amina', names });
    assert.match(plain(e.text), /Creator: *Name a\n/);
    assert.match(plain(e.text), /Creators: *Name a, Name b/);
    assert.doesNotMatch(e.text, /→/, 'nothing to compare');
  });
  it('every row keeps the email\'s direction in HTML, whatever is in it (the cells are dir="auto")', () => {
    const names = new Map([['a', 'Yusuf Rahman'], ['b', 'عائشة'], ['c', 'Bilal Ahmed']]);
    const f = (key: string, kind: 'person' | 'bps' | 'text', before: unknown, after: unknown) => ({ key, label: { en: key, ar: key }, kind, before, after });
    const fields = [f('latinList', 'person', null, ['a', 'c']), f('mixedList', 'person', null, ['b', 'a']), f('arabicFirst', 'person', 'b', 'a'), f('latinFirst', 'person', 'a', 'b'), f('same', 'person', 'a', 'a'), f('numbers', 'bps', 290, 190), f('words', 'text', 'Creator', 'عالِم'), f('changedList', 'person', ['a', 'b'], ['c', 'a'])];
    for (const [locale, mark, open, arrow] of [['ar', '\u200f', '\u2067', ' ← '], ['en', '\u200e', '\u2066', ' → ']] as const) {
      const e = renderWorkflowEmail({ to: 'a@example.org', locale, event: 'proposed', request: { ...request, fields }, actorName: 'Amina', names });
      const cells = [...e.html.matchAll(/<td class="t"[^>]*dir="auto"[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
      assert.equal(cells.length, fields.length);
      const row = (x: string) => `${mark}${open}${x}\u2069`;
      // A strong mark for dir="auto", then an isolate that needs no dir at all; every isolate closed
      // The plain text carries the same rows, each under its label in the email's language
      for (const [i, cell] of cells.entries()) assert.ok(e.text.includes(`${fields[i].label[locale]}: ${cell}`), `${locale} text: ${cell}`);
      for (const cell of cells) {
        assert.ok(cell.startsWith(mark + open) && cell.endsWith('\u2069'), `${locale}: ${cell}`);
        assert.equal(cell.match(/[\u2066-\u2068]/g)!.length, cell.match(/\u2069/g)!.length);
      }
      const iso = (x: string) => `\u2068${x}\u2069`;
      const comma = locale === 'ar' ? '، ' : ', ';
      assert.equal(cells[0], row(`${iso('Yusuf Rahman')}${comma}${iso('Bilal Ahmed')}`));
      assert.equal(cells[1], row(`${iso('عائشة')}${comma}${iso('Yusuf Rahman')}`));
      assert.equal(cells[2], row(`${iso('عائشة')}${arrow}${iso('Yusuf Rahman')}`));
      assert.equal(cells[3], row(`${iso('Yusuf Rahman')}${arrow}${iso('عائشة')}`));
      assert.equal(cells[4], row(iso('Yusuf Rahman')));
      assert.equal(cells[6], row(`${iso('Creator')}${arrow}${iso('عالِم')}`));
      const list = (...x: string[]) => `${open}${x.map(iso).join(comma)}\u2069`;
      assert.equal(cells[7], row(`${list('Yusuf Rahman', 'عائشة')}${arrow}${list('Bilal Ahmed', 'Yusuf Rahman')}`), 'a changed list keeps the email\'s direction on both sides');
    }
  });
  it('percent and bps show % and ٪', () => {
    assert.equal(fieldValue(f('percent'), 2.9, 'en', new Map()), '2.9%');
    assert.equal(fieldValue(f('percent'), 2.9, 'ar', new Map()), '٪٢٫٩');
    assert.equal(fieldValue(f('bps'), 290, 'en', new Map()), '2.9%');
  });
});

describe('the other email with a value of several parts', () => {
  it('a Contact us notice keeps the sender before the address, whatever the name\'s language', () => {
    const m = { id: 'm1', name: 'عائشة محمد', email: 'aisha@example.com', topic: 'other', message: 'السلام عليكم', locale: 'ar', created_at: '2026-11-24T12:00:00.000Z', user_id: null, page_url: null };
    const e = renderInboxNotification(m as never, { to: 'support@example.com' });
    const from = [...e.html.matchAll(/<td class="t"[^>]*dir="auto"[^>]*>([^<]*)<\/td>/g)][0][1];
    const iso = (x: string) => `\u2068${x}\u2069`;
    assert.equal(from, `\u200e\u2066${iso('عائشة محمد')} &lt;\u2066aisha@example.com\u2069&gt;\u2069`);
    assert.ok(e.text.includes(`From: \u200e\u2066${iso('عائشة محمد')} <\u2066aisha@example.com\u2069>\u2069`), e.text);
  });

  it('a name or an address never ends its isolate or reorders the row', () => {
    const bad = ['\u2069\u2069\u202e', '\u202b', '\u202d', '\u2067', '\u2069\n\u202e', '\u2069\u2029\u202e'];
    for (const c of bad) {
      const m = { id: 'm1', name: `Amina${c} x`, email: `a${c}b@example.com`, topic: 'other', message: 'hi there', locale: 'en', created_at: '2026-11-24T12:00:00.000Z', user_id: null, page_url: null };
      const e = renderInboxNotification(m as never, { to: 'support@example.com' });
      const from = [...e.html.matchAll(/<td class="t"[^>]*dir="auto"[^>]*>([^<]*)<\/td>/g)][0][1];
      const line = e.text.split('\n').find((l) => l.startsWith('From: '))!;
      for (const row of [from, line.slice('From: '.length)]) {
        assert.equal(row.match(/[\u2066-\u2068]/g)!.length, 3, JSON.stringify(row));
        assert.equal(row.match(/\u2069/g)!.length, 3);
        assert.doesNotMatch(row, /[\u202a-\u202e\u2028\u2029\n]/);
        assert.ok(row.startsWith('\u200e\u2066') && row.endsWith('\u2069'));
      }
      assert.doesNotMatch(e.subject, /[\u202a-\u202e\u2066-\u2069]/);
      // A person's or a tier's name in an approval email, the same
      const names = new Map([['a', `Yusuf${c}`], ['b', `Bilal${c}`]]);
      const fields = [{ key: 'k', label: { en: 'k', ar: 'k' }, kind: 'person' as const, before: null, after: ['a', 'b'] }, { key: 'l', label: { en: 'l', ar: 'l' }, kind: 'person' as const, before: 'a', after: 'a' }, { key: 'm', label: { en: 'm', ar: 'm' }, kind: 'text' as const, before: `x${c}`, after: `y${c}` }];
      const w = renderWorkflowEmail({ to: 'a@example.org', locale: 'ar', event: 'proposed', request: { ...request, fields }, actorName: 'A', names });
      for (const [, cell] of w.html.matchAll(/<td class="t"[^>]*dir="auto"[^>]*>([^<]*)<\/td>/g)) {
        assert.equal(cell.match(/[\u2066-\u2068]/g)!.length, cell.match(/\u2069/g)!.length, JSON.stringify(cell));
        assert.doesNotMatch(cell, /[\u202a-\u202e]/);
        // Never closed before its end: the row's own isolate is the last to close
        let depth = 0;
        for (const ch of cell.slice(1, -1)) { if (/[\u2066-\u2068]/.test(ch)) depth++; if (ch === '\u2069') depth--; assert.ok(depth > 0); }
      }
    }
  });
});
