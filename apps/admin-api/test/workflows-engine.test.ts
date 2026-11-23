/**
 * The approval workflow engine (wiki AUN-WORKFLOWS §5, §7): direct and governed changes, floors and
 * exclusions, one open request per target, stale checks, expiry and scheduled apply, exactly-once
 * apply under races, append-only steps and rules, and that every query uses an index.
 * Real SQL: the search migrations on node:sqlite, and this app's migrations for the staff list.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WorkflowActionType, WorkflowActor, WorkflowRuleConfig } from '@al-ummah/shared-types';
import { WORKFLOW_ACTIONS } from '@al-ummah/shared-types';
import {
  approveRequest,
  clearWorkflowExecutors,
  commentOnRequest,
  getRequestView,
  listRequests,
  proposeChange,
  registerWorkflowExecutor,
  rejectRequest,
  retryRequest,
  ruleInForce,
  ruleVersionStatement,
  runDueWorkflows,
  waitingCount,
  withdrawRequest,
  WorkflowError,
} from '../src/lib/workflows/engine';
import { createWorkflowDirectory } from '../src/lib/workflows/directory';
import type { WorkflowCtx, WorkflowEvent } from '../src/lib/workflows/types';
import { sqliteD1 } from './d1-sqlite';

function searchD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  raw.exec('CREATE TABLE wf_test_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
    const info = stmt.run(...params);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    first: async () => (exec(sql, args).results as unknown[])[0] ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _run: () => exec(sql, args),
    sql,
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
    raw,
  };
}

const T0 = new Date('2026-11-23T12:00:00Z');
let clock = T0;
let search: ReturnType<typeof searchD1>;
let reports: D1Database;
let events: WorkflowEvent[];
let failNextApply = false;

const ctx = (over: Partial<WorkflowCtx> = {}): WorkflowCtx => ({
  db: search as unknown as D1Database,
  directory: createWorkflowDirectory({ searchDb: search as unknown as D1Database, reportsDb: reports, ownerIds: new Set(['owner']) }),
  now: () => clock,
  steppedUp: true,
  onEvent: async (e) => {
    events.push(e);
  },
  ...over,
});
const actor = (userId: string, roles: string[] = []): Promise<WorkflowActor> => ctx().directory.actor(userId, roles);

const value = (key: string) => (search.raw.prepare('SELECT value FROM wf_test_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
const applySteps = (id: string) => (search.raw.prepare("SELECT COUNT(*) AS n FROM workflow_steps WHERE request_id = ? AND kind = 'apply'").get(id) as { n: number }).n;

function settingExecutor(type: WorkflowActionType, can: (a: WorkflowActor) => boolean = () => true) {
  registerWorkflowExecutor<{ key: string; value: string }, { key: string }>({
    type,
    scope: (p) => p.key,
    target: (p) => ({ kind: 'setting', id: p.key }),
    canPropose: async (_c, a) => can(a),
    validate: async (_c, input) => {
      const i = input as { key?: unknown; value?: unknown };
      if (typeof i?.key !== 'string' || typeof i?.value !== 'string') throw new WorkflowError(400, 'invalid_request');
      return { key: i.key, value: i.value };
    },
    describe: async (_c, p) => ({
      title: { en: `Change ${p.key}`, ar: `تغيير ${p.key}` },
      fields: [{ key: p.key, label: { en: p.key, ar: p.key }, kind: 'text', before: value(p.key), after: p.value }],
      baseVersion: value(p.key) ?? '',
      subjectUserId: p.key === 'about-u-sa2' ? 'u-sa2' : null,
    }),
    currentVersion: async (_c, p) => value(p.key) ?? '',
    applyStatements: async (c, p) => {
      if (failNextApply) {
        failNextApply = false;
        throw new Error('vendor down');
      }
      return { statements: [c.db.prepare('INSERT INTO wf_test_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(p.key, p.value)], result: { key: p.key } };
    },
  });
}

async function setRule(type: WorkflowActionType, scope: string, patch: Partial<WorkflowRuleConfig>, version = 1) {
  const config = { ...JSON.parse(JSON.stringify(WORKFLOW_ACTIONS[type].defaultRule)), ...patch } as WorkflowRuleConfig;
  await ruleVersionStatement(ctx(), { type, scope, version, config, requestId: null, by: 'seed' }).run();
}

function staff(userId: string, role: 'super_admin' | 'admin') {
  return reports.prepare("INSERT INTO admin_staff (user_id, role, name, email, active, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')").bind(userId, role, userId).run();
}

function finance(userId: string, perms: string[]) {
  search.raw.prepare("INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at) VALUES (?, ?, 'x', 'y', '2026-11-01T00:00:00Z')").run(userId, JSON.stringify(perms));
}

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof WorkflowError && e.code === code, `expected ${code}`);
}

beforeEach(async () => {
  clock = T0;
  search = searchD1();
  reports = sqliteD1();
  events = [];
  failNextApply = false;
  clearWorkflowExecutors();
  settingExecutor('features.set');
  settingExecutor('support.fees.set', (a) => a.financePermissions.includes('support:providers'));
  await staff('u-sa1', 'super_admin');
  await staff('u-sa2', 'super_admin');
  await staff('u-admin', 'admin');
  await staff('owner', 'super_admin');
  search.raw.exec("INSERT INTO support_tech_staff (user_id, marked_by, marked_at) VALUES ('owner', 'u-sa1', '2026-11-01T00:00:00Z')");
  finance('u-fin1', ['support:providers', 'support:payouts']);
  finance('u-fin2', ['support:providers']);
  finance('u-fin3', ['support:payouts']);
});

describe('direct rules', () => {
  it('apply at once, with a request, a diff and propose + apply steps', async () => {
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'uploads', value: 'on' }, reason: 'Launch' });
    assert.equal(out.status, 'applied');
    assert.equal(value('uploads'), 'on');
    const view = await getRequestView(ctx(), out.status === 'applied' ? out.requestId : '');
    assert.equal(view.status, 'applied');
    assert.deepEqual(view.steps.map((s) => s.kind), ['propose', 'apply']);
    assert.deepEqual(view.fields[0], { key: 'uploads', label: { en: 'uploads', ar: 'uploads' }, kind: 'text', before: null, after: 'on' });
    assert.equal(search.raw.prepare('SELECT open_key FROM workflow_requests').get()!.open_key, null, 'the lock is released');
  });

  it('a future effective date schedules it; the cron applies it on the day', async () => {
    await setRule('features.set', 'banner', { effectiveDate: { allowed: true, maxDaysAhead: 30 } });
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'banner', value: 'eid' }, reason: 'Eid', effectiveAt: '2026-11-25T00:00:00Z' });
    assert.equal(out.status, 'scheduled');
    assert.equal(value('banner'), null);
    clock = new Date('2026-11-24T23:59:00Z');
    assert.deepEqual(await runDueWorkflows(ctx()), { expired: 0, applied: 0, failed: 0 });
    clock = new Date('2026-11-25T00:00:00Z');
    assert.deepEqual(await runDueWorkflows(ctx()), { expired: 0, applied: 1, failed: 0 });
    assert.equal(value('banner'), 'eid');
  });

  it('refuses an effective date the rule does not allow', async () => {
    await rejects(proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'x', value: '1' }, reason: 'r', effectiveAt: '2026-12-01T00:00:00Z' }), 'effective_date_not_allowed');
  });
});

describe('governed rules', () => {
  beforeEach(() => setRule('features.set', 'live', { approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }], stepUp: 'approve' }));

  it('wait for a second super admin; the proposer cannot approve; the change applies on approval', async () => {
    const sa1 = await actor('u-sa1', ['super_admin']);
    const out = await proposeChange(ctx(), sa1, { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'Ready' });
    assert.equal(out.status, 'pending_approval');
    const id = out.status === 'pending_approval' ? out.request.id : '';
    assert.equal(value('live'), null, 'nothing changes before approval');
    assert.deepEqual(out.status === 'pending_approval' && out.request.can, { approve: false, reject: false, withdraw: true, blocks: ['own_request', 'one_step_per_person'] });
    await rejects(approveRequest(ctx(), sa1, id, {}), 'approval_not_allowed');
    await rejects(approveRequest(ctx(), await actor('u-admin', ['admin']), id, {}), 'approval_not_allowed');

    assert.equal(await waitingCount(ctx(), 'u-sa2'), 1);
    assert.equal(await waitingCount(ctx(), 'u-sa1'), 0, 'not in the proposer’s inbox');
    assert.equal(await waitingCount(ctx(), 'owner'), 1, 'the owner may approve platform changes');
    const view = await approveRequest(ctx(), await actor('u-sa2', ['super_admin']), id, { version: 1, note: 'ok' });
    assert.equal(view.status, 'applied');
    assert.equal(value('live'), 'on');
    assert.deepEqual(view.steps.map((s) => [s.kind, s.actor]), [['propose', 'u-sa1'], ['approve', 'u-sa2'], ['apply', 'system']]);
    assert.equal(await waitingCount(ctx(), 'u-sa2'), 0);
    assert.deepEqual(events.map((e) => e.kind), ['proposed', 'approved', 'applied']);
    assert.ok(events[0].recipients.includes('u-sa2') && !events[0].recipients.includes('u-admin'));
  });

  it('one open request per target', async () => {
    const sa1 = await actor('u-sa1', ['super_admin']);
    const first = await proposeChange(ctx(), sa1, { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    await assert.rejects(
      proposeChange(ctx(), await actor('u-sa2', ['super_admin']), { type: 'features.set', payload: { key: 'live', value: 'off' }, reason: 'b' }),
      (e: unknown) => e instanceof WorkflowError && e.code === 'change_pending' && e.extra.requestId === (first.status === 'pending_approval' ? first.request.id : ''),
    );
  });

  it('reject needs a reason and closes it; the proposer can propose again', async () => {
    const sa1 = await actor('u-sa1', ['super_admin']);
    const out = await proposeChange(ctx(), sa1, { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    const sa2 = await actor('u-sa2', ['super_admin']);
    await rejects(rejectRequest(ctx(), sa2, id, { reason: '  ' }), 'invalid_request');
    const view = await rejectRequest(ctx(), sa2, id, { reason: 'Not this week' });
    assert.equal(view.status, 'rejected');
    await rejects(approveRequest(ctx(), sa2, id, {}), 'request_closed');
    assert.equal((await proposeChange(ctx(), sa1, { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'again' })).status, 'pending_approval');
  });

  it('only the proposer withdraws', async () => {
    const sa1 = await actor('u-sa1', ['super_admin']);
    const out = await proposeChange(ctx(), sa1, { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    await rejects(withdrawRequest(ctx(), await actor('u-sa2', ['super_admin']), id, {}), 'approval_not_allowed');
    assert.equal((await withdrawRequest(ctx(), sa1, id, { version: 1 })).status, 'withdrawn');
  });

  it('a change made meanwhile makes the request stale', async () => {
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    search.raw.exec("INSERT INTO wf_test_settings (key, value) VALUES ('live', 'off')");
    await rejects(approveRequest(ctx(), await actor('u-sa2', ['super_admin']), id, {}), 'request_stale');
    assert.equal((await getRequestView(ctx(), id)).status, 'stale');
    assert.equal(value('live'), 'off');
  });

  it('the person a change is about never approves it', async () => {
    await setRule('features.set', 'about-u-sa2', { approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }] });
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'about-u-sa2', value: '1' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    await rejects(approveRequest(ctx(), await actor('u-sa2', ['super_admin']), id, {}), 'approval_not_allowed');
    assert.equal(await waitingCount(ctx(), 'u-sa2'), 0);
  });

  it('expires on time', async () => {
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    clock = new Date(T0.getTime() + 7 * 24 * 3600_000);
    assert.equal((await runDueWorkflows(ctx())).expired, 1);
    assert.equal((await getRequestView(ctx(), id)).status, 'expired');
    assert.equal(await waitingCount(ctx(), 'u-sa2'), 0);
  });

  it('two approvers racing for the last approval: one applies, once', async () => {
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    const results = await Promise.allSettled([approveRequest(ctx(), await actor('u-sa2', ['super_admin']), id, {}), approveRequest(ctx(), await actor('owner', ['super_admin']), id, {})]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(lost.reason instanceof WorkflowError && ['version_conflict', 'request_closed'].includes(lost.reason.code));
    assert.equal(applySteps(id), 1);
    assert.equal((await getRequestView(ctx(), id)).approvalsCount, 1);
  });

  it('a failed apply can be retried', async () => {
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    failNextApply = true;
    assert.equal((await approveRequest(ctx(), await actor('u-sa2', ['super_admin']), id, {})).status, 'failed');
    assert.equal(value('live'), null);
    const view = await retryRequest(ctx(), await actor('u-sa2', ['super_admin']), id);
    assert.equal(view.status, 'applied');
    assert.equal(value('live'), 'on');
    assert.deepEqual(view.steps.map((s) => s.kind), ['propose', 'approve', 'fail', 'retry', 'apply']);
  });

  it('comments are steps and do not count as deciding', async () => {
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    const sa2 = await actor('u-sa2', ['super_admin']);
    await commentOnRequest(ctx(), sa2, id, { note: 'Is the encoder ready?' });
    assert.equal((await approveRequest(ctx(), sa2, id, {})).status, 'applied');
  });

  it('step-up is required to approve when the rule says', async () => {
    const out = await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'live', value: 'on' }, reason: 'a' });
    const id = out.status === 'pending_approval' ? out.request.id : '';
    await rejects(approveRequest(ctx({ steppedUp: false }), await actor('u-sa2', ['super_admin']), id, {}), 'approval_not_allowed');
  });
});

describe('money', () => {
  it('fees: finance list proposes with step-up, a second finance member approves; tech staff and plain super admins cannot', async () => {
    await rejects(proposeChange(ctx(), await actor('owner', ['super_admin']), { type: 'support.fees.set', payload: { key: 'fee', value: '290' }, reason: 'a' }), 'propose_not_allowed');
    await rejects(proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'support.fees.set', payload: { key: 'fee', value: '290' }, reason: 'a' }), 'propose_not_allowed');
    await rejects(proposeChange(ctx({ steppedUp: false }), await actor('u-fin1'), { type: 'support.fees.set', payload: { key: 'fee', value: '290' }, reason: 'a' }), 'propose_not_allowed');
    const out = await proposeChange(ctx(), await actor('u-fin1'), { type: 'support.fees.set', payload: { key: 'fee', value: '290' }, reason: 'PayGood terms' });
    assert.equal(out.status, 'pending_approval');
    const id = out.status === 'pending_approval' ? out.request.id : '';
    assert.equal(await waitingCount(ctx(), 'u-fin2'), 1);
    assert.equal(await waitingCount(ctx(), 'u-fin3'), 0, 'lacks support:providers');
    assert.equal(await waitingCount(ctx(), 'owner'), 0);
    assert.equal(await waitingCount(ctx(), 'u-sa2'), 0);
    await rejects(approveRequest(ctx(), await actor('u-sa2', ['super_admin']), id, {}), 'approval_not_allowed');
    await rejects(approveRequest(ctx(), await actor('owner', ['super_admin']), id, {}), 'approval_not_allowed');
    assert.equal((await approveRequest(ctx(), await actor('u-fin2'), id, {})).status, 'applied');
    assert.equal(value('fee'), '290');
  });

  it('a stored money rule weaker than the floor is raised to it', async () => {
    await setRule('support.fees.set', '', { approvalsNeeded: 0, approvers: [{ kind: 'role', role: 'super_admin' }], exclusions: { subject: true, techStaff: false, owner: false, oneStepPerPerson: true } });
    const out = await proposeChange(ctx(), await actor('u-fin1'), { type: 'support.fees.set', payload: { key: 'fee', value: '190' }, reason: 'a' });
    assert.equal(out.status, 'pending_approval', 'still needs a finance approver');
    assert.equal(value('fee'), null);
  });
});

describe('rules and storage', () => {
  it('the rule in force is the newest version for the scope, then the default scope, then the seed', async () => {
    assert.equal((await ruleInForce(ctx(), 'features.set', 'x')).config.approvalsNeeded, 0);
    assert.equal((await ruleInForce(ctx(), 'features.set', 'creatorSupport')).config.approvalsNeeded, 1, 'WF-D9 seed');
    await setRule('features.set', '', { approvalsNeeded: 1 });
    assert.equal((await ruleInForce(ctx(), 'features.set', 'x')).config.approvalsNeeded, 1);
    await setRule('features.set', 'x', { approvalsNeeded: 2 }, 1);
    await setRule('features.set', 'x', { approvalsNeeded: 3 }, 2);
    assert.equal((await ruleInForce(ctx(), 'features.set', 'x')).config.approvalsNeeded, 3);
  });

  it('steps and rules are append-only', async () => {
    await proposeChange(ctx(), await actor('u-sa1', ['super_admin']), { type: 'features.set', payload: { key: 'a', value: '1' }, reason: 'r' });
    await setRule('features.set', 'a', {});
    assert.throws(() => search.raw.exec("UPDATE workflow_steps SET actor = 'x'"), /append-only/);
    assert.throws(() => search.raw.exec('DELETE FROM workflow_steps'), /append-only/);
    assert.throws(() => search.raw.exec("UPDATE workflow_rules SET config = '{}'"), /append-only/);
    assert.throws(() => search.raw.exec('DELETE FROM workflow_rules'), /append-only/);
  });

  it('lists: waiting, mine, open and history, paged', async () => {
    await setRule('features.set', '', { approvalsNeeded: 1, approvers: [{ kind: 'role', role: 'super_admin' }] });
    const sa1 = await actor('u-sa1', ['super_admin']);
    for (let i = 0; i < 3; i++) {
      clock = new Date(T0.getTime() + i * 1000);
      await proposeChange(ctx(), sa1, { type: 'features.set', payload: { key: `k${i}`, value: '1' }, reason: 'r' });
    }
    const page1 = await listRequests(ctx(), 'u-sa2', { view: 'waiting', limit: 2 });
    assert.deepEqual(page1.items.map((i) => i.title.en), ['Change k2', 'Change k1']);
    const page2 = await listRequests(ctx(), 'u-sa2', { view: 'waiting', limit: 2, cursor: page1.next });
    assert.deepEqual(page2.items.map((i) => i.title.en), ['Change k0']);
    assert.equal(page2.next, null);
    assert.equal((await listRequests(ctx(), 'u-sa1', { view: 'mine' })).items.length, 3);
    assert.equal((await listRequests(ctx(), 'u-sa1', { view: 'open' })).items.length, 3);
    assert.equal((await listRequests(ctx(), 'u-sa1', { view: 'history', type: 'features.set' })).items.length, 3);
  });

  it('every engine query uses an index (no table scans)', () => {
    const queries = [
      "SELECT id FROM workflow_rules WHERE action_type = 'a' AND scope = '' ORDER BY version DESC LIMIT 1",
      "SELECT id FROM workflow_requests WHERE id = 'x'",
      "SELECT id FROM workflow_requests WHERE open_key = 'x'",
      "SELECT seq FROM workflow_steps WHERE request_id = 'x' ORDER BY seq",
      "SELECT COALESCE(MAX(seq), 0) + 1 FROM workflow_steps WHERE request_id = 'x'",
      "SELECT id FROM workflow_requests WHERE status = 'pending' AND expires_at <= 'x' ORDER BY expires_at LIMIT 50",
      "SELECT id FROM workflow_requests WHERE status = 'scheduled' AND apply_at <= 'x' ORDER BY apply_at LIMIT 50",
      "SELECT r.id FROM workflow_inbox i JOIN workflow_requests r ON r.id = i.request_id WHERE i.user_id = 'u' ORDER BY r.proposed_at DESC, r.id DESC LIMIT 51",
      "SELECT r.id FROM workflow_requests r WHERE r.proposed_by = 'u' ORDER BY r.proposed_at DESC, r.id DESC LIMIT 51",
      "SELECT r.id FROM workflow_requests r WHERE r.status IN ('pending', 'scheduled') ORDER BY r.proposed_at DESC, r.id DESC LIMIT 51",
      "SELECT r.id FROM workflow_requests r WHERE r.action_type = 'a' ORDER BY r.proposed_at DESC, r.id DESC LIMIT 51",
      "SELECT r.id FROM workflow_requests r WHERE 1 = 1 ORDER BY r.proposed_at DESC, r.id DESC LIMIT 51",
      "SELECT COUNT(*) FROM workflow_inbox WHERE user_id = 'u'",
      "SELECT user_id FROM workflow_inbox WHERE request_id = 'x'",
      "DELETE FROM workflow_inbox WHERE request_id = 'x'",
      "SELECT roles FROM support_finance_members WHERE user_id = 'u' AND removed_at IS NULL AND approved_by IS NOT NULL",
      'SELECT user_id FROM support_finance_members WHERE removed_at IS NULL AND approved_by IS NOT NULL LIMIT 200',
    ];
    for (const q of queries) {
      const plan = (search.raw.prepare(`EXPLAIN QUERY PLAN ${q}`).all() as { detail: string }[]).map((r) => r.detail);
      const scans = plan.filter((d) => /^SCAN /.test(d) && !/USING (COVERING )?INDEX|USING PRIMARY KEY/.test(d));
      assert.deepEqual(scans, [], `${q}\n${plan.join('\n')}`);
    }
  });
});
