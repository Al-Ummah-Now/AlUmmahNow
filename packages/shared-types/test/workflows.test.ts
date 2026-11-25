/**
 * Approval workflows (wiki AUN-WORKFLOWS §3–§8): the registry, rule validation and floors, who may
 * approve, the state machine, expiry and the bilingual messages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as w from '../src/workflows.ts';

const actor = (over: Partial<w.WorkflowActor> = {}): w.WorkflowActor => ({ userId: 'u-approver', roles: [], financePermissions: [], techStaff: false, owner: false, ...over });
const facts = (over: Partial<w.WorkflowRequestFacts> = {}): w.WorkflowRequestFacts => ({ proposedBy: 'u-proposer', subjectUserId: null, decidedBy: ['u-proposer'], approvedBy: [], ...over });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('every action type is registered once with a default rule that passes its own floor', () => {
  for (const type of w.WORKFLOW_ACTION_TYPES) {
    const def = w.WORKFLOW_ACTIONS[type];
    assert.equal(def.type, type);
    assert.ok(def.label.en && def.label.ar, `${type} needs en and ar labels`);
    assert.ok(!/[0-9]/.test(def.label.ar), `${type}: Arabic labels carry no Western digits`);
    const r = w.validateWorkflowRule(type, clone(def.defaultRule));
    assert.ok(r.ok, `${type}: ${JSON.stringify(!r.ok && r.problems)}`);
  }
  assert.ok(w.isWorkflowActionType('support.fees.set'));
  assert.ok(!w.isWorkflowActionType('support.fees.delete'));
});

test('money defaults: finance-list approvers, tech staff and owner excluded, step-up to propose and approve', () => {
  const fees = w.WORKFLOW_ACTIONS['support.fees.set'];
  assert.equal(fees.domain, 'money');
  assert.equal(fees.defaultRule.approvalsNeeded, 1);
  assert.deepEqual(fees.defaultRule.approvers, [{ kind: 'finance', permission: 'support:providers' }]);
  assert.ok(fees.defaultRule.exclusions.techStaff && fees.defaultRule.exclusions.owner);
  assert.equal(fees.defaultRule.stepUp, 'propose_and_approve');
  assert.ok(!('effectiveDate' in fees.defaultRule), 'WF-D6: no effective dates');
  assert.equal(w.WORKFLOW_ACTIONS['support.payoutBatch.approve'].defaultRule.expiryHours, 5 * 24);
});

test('floors: a money rule cannot drop the finance list, the exclusions, the step-up or its minimum', () => {
  const base = clone(w.WORKFLOW_ACTIONS['support.fees.set'].defaultRule);
  const bad = (patch: (r: w.WorkflowRuleConfig) => void) => {
    const r = clone(base);
    patch(r);
    const res = w.validateWorkflowRule('support.fees.set', r);
    assert.equal(res.ok, false);
    return res.ok ? [] : res.problems;
  };
  assert.deepEqual(bad((r) => (r.approvalsNeeded = 0)), ['below_floor_approvals']);
  assert.deepEqual(bad((r) => (r.approvers = [{ kind: 'role', role: 'super_admin' }])), ['below_floor_money_approvers']);
  assert.deepEqual(bad((r) => (r.exclusions.techStaff = false)), ['below_floor_money_exclusions']);
  assert.deepEqual(bad((r) => (r.exclusions.owner = false)), ['below_floor_money_exclusions']);
  assert.deepEqual(bad((r) => (r.stepUp = 'none')), ['below_floor_step_up']);
  assert.deepEqual(bad((r) => (r.exclusions.subject = false)), ['below_floor_subject']);
});

test('MEM-D24 raises the payout-batch floor through minApprovals', () => {
  const r = clone(w.WORKFLOW_ACTIONS['support.payoutBatch.approve'].defaultRule);
  r.approvalsNeeded = 0;
  assert.ok(w.validateWorkflowRule('support.payoutBatch.approve', r).ok, 'MEM-D24 = 1 person: no approver');
  const res = w.validateWorkflowRule('support.payoutBatch.approve', r, { minApprovals: 1 });
  assert.deepEqual(res.ok ? [] : res.problems, ['below_floor_approvals']);
});

test('rule changes and the finance list always need a second person', () => {
  for (const type of ['workflows.rule.set', 'support.financeList.add', 'support.techStaff.unmark'] as const) {
    const r = clone(w.WORKFLOW_ACTIONS[type].defaultRule);
    r.approvalsNeeded = 0;
    assert.equal(w.validateWorkflowRule(type, r).ok, false, type);
  }
});

test('platform actions may be direct, and may be raised to approvers', () => {
  const r = clone(w.WORKFLOW_ACTIONS['features.set'].defaultRule);
  assert.equal(r.approvalsNeeded, 0);
  r.approvalsNeeded = 2;
  r.approvers = [{ kind: 'people', userIds: ['a', 'b', 'a'] }];
  const res = w.validateWorkflowRule('features.set', r);
  assert.ok(res.ok);
  assert.deepEqual(res.ok && res.rule.approvers, [{ kind: 'people', userIds: ['a', 'b'] }], 'named people are de-duplicated');
});

test('shape and limits are checked', () => {
  const r = clone(w.WORKFLOW_ACTIONS['features.set'].defaultRule);
  assert.deepEqual(w.validateWorkflowRule('features.set', null), { ok: false, problems: ['invalid_shape'] });
  assert.deepEqual(w.validateWorkflowRule('nope' as w.WorkflowActionType, r), { ok: false, problems: ['invalid_shape'] });
  const check = (patch: (x: Record<string, unknown>) => void, problem: w.WorkflowRuleProblem) => {
    const x = clone(r) as unknown as Record<string, unknown>;
    patch(x);
    const res = w.validateWorkflowRule('features.set', x);
    assert.ok(!res.ok && res.problems.includes(problem), `${problem}: ${JSON.stringify(res)}`);
  };
  check((x) => (x.approvalsNeeded = 4), 'approvals_out_of_range');
  check((x) => (x.approvalsNeeded = 1.5), 'approvals_out_of_range');
  check((x) => (x.approvers = []), 'approvers_empty');
  check((x) => (x.approvers = [{ kind: 'role', role: 'moderator' }]), 'approvers_invalid');
  check((x) => (x.approvers = [{ kind: 'people', userIds: [] }]), 'approvers_invalid');
  check((x) => (x.approvers = [{ kind: 'finance', permission: 'billing:refund' }]), 'approvers_invalid');
  check((x) => (x.expiryHours = 0), 'expiry_out_of_range');
  check((x) => (x.expiryHours = 30 * 24 + 1), 'expiry_out_of_range');
  check((x) => (x.stepUp = 'always'), 'invalid_shape');
  check((x) => (x.notify = { email: 'yes', extra: [] }), 'invalid_shape');
});

test('approval: proposer, subject, tech staff, owner and non-approvers are blocked', () => {
  const rule = w.WORKFLOW_ACTIONS['support.fees.set'].defaultRule;
  const floor = w.WORKFLOW_ACTIONS['support.fees.set'].floor;
  const finance = actor({ financePermissions: ['support:providers'] });
  assert.deepEqual(w.workflowApprovalBlocks(rule, floor, facts(), finance), []);
  assert.ok(w.workflowApprovalBlocks(rule, floor, facts(), { ...finance, userId: 'u-proposer' }).includes('own_request'));
  assert.ok(w.workflowApprovalBlocks(rule, floor, facts({ subjectUserId: 'u-approver' }), finance).includes('subject'));
  assert.deepEqual(w.workflowApprovalBlocks(rule, floor, facts(), { ...finance, techStaff: true }), ['excluded_tech_staff']);
  assert.deepEqual(w.workflowApprovalBlocks(rule, floor, facts(), { ...finance, owner: true }), ['excluded_owner']);
  assert.deepEqual(w.workflowApprovalBlocks(rule, floor, facts(), actor({ financePermissions: ['support:payouts'] })), ['not_in_approver_set']);
  assert.deepEqual(w.workflowApprovalBlocks(rule, floor, facts(), actor({ roles: ['super_admin'] })), ['not_in_approver_set'], 'a super admin role alone is not enough for money');
  assert.deepEqual(w.workflowApprovalBlocks(rule, floor, facts({ approvedBy: ['u-approver'], decidedBy: ['u-proposer', 'u-approver'] }), finance), ['already_approved']);
});

test('money floor applies even when a stored rule were weaker', () => {
  const floor = w.WORKFLOW_ACTIONS['support.fees.set'].floor;
  const weak: w.WorkflowRuleConfig = { ...clone(w.WORKFLOW_ACTIONS['support.fees.set'].defaultRule), approvers: [{ kind: 'role', role: 'super_admin' }], exclusions: { subject: true, techStaff: false, owner: false, oneStepPerPerson: true } };
  const owner = actor({ roles: ['super_admin'], techStaff: true, owner: true });
  const blocks = w.workflowApprovalBlocks(weak, floor, facts(), owner);
  assert.ok(blocks.includes('excluded_tech_staff') && blocks.includes('excluded_owner') && blocks.includes('not_in_approver_set'));
});

test('one step per person, and roles and named people as approver sets', () => {
  const rule: w.WorkflowRuleConfig = { ...clone(w.WORKFLOW_ACTIONS['features.set'].defaultRule), approvalsNeeded: 1 };
  const floor = w.WORKFLOW_ACTIONS['features.set'].floor;
  const sa = actor({ roles: ['super_admin'] });
  assert.deepEqual(w.workflowApprovalBlocks(rule, floor, facts({ decidedBy: ['u-proposer', 'u-approver'] }), sa), ['one_step_per_person']);
  const off = { ...rule, exclusions: { ...rule.exclusions, oneStepPerPerson: false } };
  assert.deepEqual(w.workflowApprovalBlocks(off, floor, facts({ decidedBy: ['u-proposer', 'u-approver'] }), sa), []);
  const named = { ...rule, approvers: [{ kind: 'people' as const, userIds: ['u-approver'] }] };
  assert.deepEqual(w.workflowApprovalBlocks(named, floor, facts(), actor()), []);
  const admins = { ...rule, approvers: [{ kind: 'role' as const, role: 'admin' as const }] };
  assert.deepEqual(w.workflowApprovalBlocks(admins, floor, facts(), sa), [], 'super admins count as admins');
  assert.deepEqual(w.workflowApprovalBlocks(rule, floor, facts(), actor({ roles: ['admin'] })), ['not_in_approver_set'], 'admins are not super admins');
  assert.deepEqual(w.workflowApprovalBlocks(named, floor, facts(), actor({ userId: 'other', roles: ['super_admin'] })), ['not_in_approver_set']);
});

test('proposing money: tech staff and the owner never may', () => {
  const money = w.WORKFLOW_ACTIONS['support.fees.set'].floor;
  assert.deepEqual(w.workflowProposeBlocks(money, actor({ techStaff: true, owner: true })), ['excluded_tech_staff', 'excluded_owner']);
  assert.deepEqual(w.workflowProposeBlocks(w.WORKFLOW_ACTIONS['features.set'].floor, actor({ techStaff: true })), []);
});

test('state machine: closed states are final and the open set holds the lock', () => {
  for (const s of w.WORKFLOW_CLOSED_STATUSES) for (const t of w.WORKFLOW_STATUSES) assert.equal(w.canWorkflowTransition(s, t), false, `${s} → ${t}`);
  assert.ok(w.canWorkflowTransition('pending', 'approved'));
  assert.ok(w.canWorkflowTransition('pending', 'applying'), 'the last approval applies at once');
  assert.ok(w.canWorkflowTransition('failed', 'applying'), 'Retry');
  assert.ok(!w.canWorkflowTransition('applying', 'withdrawn'));
  assert.ok(!(w.WORKFLOW_STATUSES as readonly string[]).includes('scheduled'), 'WF-D6: nothing is scheduled');
  assert.equal(new Set([...w.WORKFLOW_OPEN_STATUSES, ...w.WORKFLOW_CLOSED_STATUSES]).size, w.WORKFLOW_STATUSES.length);
  assert.equal(w.workflowOpenKey('support.fees.set', 'fee', 'paygood:USD:card'), 'support.fees.set:fee:paygood:USD:card');
});

test('expiry (WF-D10 defaults)', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  assert.equal(w.workflowExpiresAt(now, w.WORKFLOW_ACTIONS['support.fees.set'].defaultRule).toISOString(), '2026-11-30T12:00:00.000Z');
  assert.equal(w.WORKFLOW_ACTIONS['support.payoutBatch.approve'].defaultRule.expiryHours, 5 * 24);
  assert.equal(w.WORKFLOW_ACTIONS['support.emergencyStop.lift'].defaultRule.expiryHours, 24);
});

test('diff fields: secrets never carry a value; unchanged fields are detected', () => {
  const s = w.workflowSecretField('apiKey', { en: 'API key', ar: 'مفتاح الواجهة البرمجية' }, true);
  assert.deepEqual([s.before, s.after], ['set', 'replaced']);
  assert.ok(w.workflowFieldChanged(s));
  assert.ok(!w.workflowFieldChanged({ key: 'bps', label: { en: 'Rate', ar: 'النسبة' }, kind: 'bps', before: 290, after: 290 }));
  assert.ok(w.workflowFieldChanged({ key: 'bps', label: { en: 'Rate', ar: 'النسبة' }, kind: 'bps', before: 290, after: 190 }));
});

test('messages exist in English and Arabic, with Arabic commas only and no Western digits', () => {
  const all = [...Object.values(w.WORKFLOW_ERROR_MESSAGES), ...Object.values(w.WORKFLOW_BLOCK_MESSAGES), ...Object.values(w.WORKFLOW_STATUS_LABELS), ...Object.values(w.WORKFLOW_DOMAIN_LABELS)];
  for (const m of all) {
    assert.ok(m.en && m.ar);
    assert.ok(!m.ar.includes(','), m.ar);
    assert.ok(!/[0-9]/.test(m.ar), m.ar);
    assert.ok(!/فيديو/.test(m.ar), m.ar);
  }
  for (const code of w.WORKFLOW_ERROR_CODES) assert.ok(w.WORKFLOW_ERROR_MESSAGES[code]);
});

test('finance approver sets name only real money permissions, the same list as support.ts', async () => {
  const support = await import('../src/support.ts');
  assert.deepEqual([...w.WORKFLOW_FINANCE_PERMISSIONS], [...support.FINANCE_ONLY_SUPPORT_PERMISSIONS]);
  const r = clone(w.WORKFLOW_ACTIONS['support.fees.set'].defaultRule) as unknown as Record<string, unknown>;
  r.approvers = [{ kind: 'finance', permission: 'support:read' }];
  const res = w.validateWorkflowRule('support.fees.set', r);
  assert.ok(!res.ok && res.problems.includes('approvers_invalid'), 'support:read is not a money permission');
});

test('creatorSupport is a feature switch like any other: direct, no money floor (owner 2026-11-24, WF-D9 superseded); money rule changes keep theirs', () => {
  assert.ok(!w.workflowFloorFor('features.set', 'creatorSupport').money);
  assert.equal(w.workflowFloorFor('features.set', 'creatorSupport').minApprovals, 0);
  assert.equal(w.workflowDefaultRuleFor('features.set', 'creatorSupport').approvalsNeeded, 0);
  assert.deepEqual(w.workflowDefaultRuleFor('features.set', 'creatorSupport'), w.WORKFLOW_ACTIONS['features.set'].defaultRule);
  assert.equal(w.WORKFLOW_SEEDED_SCOPES['features.set'], undefined);
  // admins may still give it approvers, like any switch
  const supers = { ...clone(w.workflowDefaultRuleFor('features.set', 'creatorSupport')), approvalsNeeded: 1, approvers: [{ kind: 'role' as const, role: 'super_admin' as const }] };
  assert.ok(w.validateWorkflowRule('features.set', supers, { scope: 'creatorSupport' }).ok);
  assert.ok(w.workflowFloorFor('workflows.rule.set', w.WORKFLOW_RULE_CHANGE_MONEY_SCOPE).money);
  assert.ok(w.isMoneyRule('support.fees.set', ''));
  assert.ok(!w.isMoneyRule('features.set', 'creatorSupport'));
});

test('the finance list and tech-staff marks are people actions decided by super admins, with their own floor', () => {
  for (const type of ['support.financeList.add', 'support.techStaff.unmark'] as const) {
    const def = w.WORKFLOW_ACTIONS[type];
    assert.equal(def.domain, 'people');
    assert.equal(def.floor.money, false);
    assert.equal(def.floor.minApprovals, 1);
    assert.deepEqual(def.defaultRule.approvers, [{ kind: 'role', role: 'super_admin' }]);
  }
});

test('a short diff shows what changes and the people it is about, whose ids are listed once', () => {
  const f = (kind: 'person' | 'count', before: unknown, after: unknown) => ({ key: 'k', label: { en: 'K', ar: 'ك' }, kind, before, after });
  assert.ok(w.workflowFieldShown(f('person', 'u1', 'u1')));
  assert.ok(!w.workflowFieldShown(f('count', 1, 1)));
  assert.ok(w.workflowFieldShown(f('count', 1, 2)));
  const fields = [f('person', 'u1', 'u1'), f('person', null, ['u1', 'u2', 'u3']), f('count', 'x', 'y')];
  assert.deepEqual(w.workflowFieldPeople(fields), ['u1', 'u2', 'u3']);
  assert.deepEqual(w.workflowFieldPeople(fields, 2), ['u1', 'u2']);
});

test('every domain but money is open; a domain nobody named is not', () => {
  assert.deepEqual([...w.WORKFLOW_OPEN_DOMAINS], w.WORKFLOW_DOMAINS.filter((d) => d !== 'money'));
  for (const d of w.WORKFLOW_DOMAINS) assert.equal(w.workflowDomainVisible(d, false), d !== 'money');
  for (const d of ['', 'finance', 'MONEY']) assert.equal(w.workflowDomainVisible(d, false), false);
  for (const d of [...w.WORKFLOW_DOMAINS, 'finance']) assert.equal(w.workflowDomainVisible(d, true), true);
});
