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

describe('rendering', () => {
  it('English: subject, intro, changed fields only, the review link and no approve link', () => {
    const e = renderWorkflowEmail({ to: 'a@example.org', locale: 'en', event: 'proposed', request, actorName: 'Amina', names: new Map(), adminUrl: 'https://admin.qa.alummahnow.net/', environment: 'qa' });
    assert.equal(e.subject, '[qa] Approval needed: Change the PayGood card fee (USD)');
    assert.match(e.text, /Amina asked for this change/);
    assert.match(e.text, /Percentage/);
    assert.match(e.text, /2\.9% → 1\.9%/);
    assert.doesNotMatch(e.text, /Fixed fee/, 'unchanged fields are left out');
    assert.match(e.text, /Card, Wallet/);
    assert.match(e.text, /Approvals: 1 of 2/);
    assert.match(e.text, /https:\/\/admin\.qa\.alummahnow\.net\/approvals\/wfr_1/);
    assert.doesNotMatch(e.text + e.html, /\/approve\b/, 'never approve from the email (WF-D5)');
  });

  it('Arabic: Eastern Arabic digits, Arabic comma, right arrow order, no Latin digits in the prose', () => {
    const e = renderWorkflowEmail({ to: 'b@example.org', locale: 'ar', event: 'proposed', request, actorName: 'أمينة', names: new Map(), adminUrl: 'https://admin.alummahnow.net' });
    assert.match(e.subject, /^موافقة مطلوبة: /);
    assert.match(e.text, /الموافقات: ١ من ٢/);
    assert.match(e.text, /٪٢٫٩ ← ٪١٫٩/);
    assert.match(e.text, /بطاقة، محفظة/);
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
  let sent: { to: string; key: string | null; subject: string }[];
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

  const contacts: Record<string, { email: string; locale: 'en' | 'ar'; displayName: string }> = {
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
        if (!sent.some((s) => s.key === key)) sent.push({ to: Array.isArray(body.to) ? body.to[0] : body.to, key, subject: body.subject });
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
  it('percent and bps show % and ٪', () => {
    assert.equal(fieldValue(f('percent'), 2.9, 'en', new Map()), '2.9%');
    assert.equal(fieldValue(f('percent'), 2.9, 'ar', new Map()), '٪٢٫٩');
    assert.equal(fieldValue(f('bps'), 290, 'en', new Map()), '2.9%');
  });
});
