/**
 * Approval workflows (wiki AUN-WORKFLOWS, decision O44): one admin-configurable approval system for
 * sensitive admin changes. A change request is proposed, approved by the people its rule names (or
 * rejected, withdrawn, expired or made stale), and only then applied.
 *
 * This module is pure: the action-type registry, the rule format with its floors (rules the admin page
 * can't lower, §4.3), who may approve (§4.1), the request state machine (§5), the diff field format
 * (§6), and the error codes with server-written English and Arabic messages (§8). The engine lives in
 * admin-api (lib/workflows); the tables in the search D1.
 */
import type { SupportPermission } from './support';

/**
 * The money permissions a finance-list approver set may name. Same list as FINANCE_ONLY_SUPPORT_PERMISSIONS
 * in ./support (kept here without a runtime import; a test checks they match).
 */
export const WORKFLOW_FINANCE_PERMISSIONS: readonly SupportPermission[] = Object.freeze(['support:refund', 'support:disputes', 'support:payouts', 'support:ledger', 'support:providers'] as SupportPermission[]);

export type WorkflowLocalized = { en: string; ar: string };

// ---------------------------------------------------------------------------------------------------
// Domains and action types (§3)
// ---------------------------------------------------------------------------------------------------

export const WORKFLOW_DOMAINS = ['money', 'platform', 'people', 'governance'] as const;
export type WorkflowDomain = (typeof WORKFLOW_DOMAINS)[number];

export const WORKFLOW_DOMAIN_LABELS: Readonly<Record<WorkflowDomain, WorkflowLocalized>> = Object.freeze({
  money: { en: 'Money', ar: 'المال' },
  platform: { en: 'Platform', ar: 'المنصّة' },
  people: { en: 'People', ar: 'الأشخاص' },
  governance: { en: 'Approval rules', ar: 'قواعد الموافقة' },
});

export const WORKFLOW_ACTION_TYPES = [
  'support.fees.set',
  'support.payoutBatch.approve',
  'support.ledger.adjust',
  'support.financeList.add',
  'support.techStaff.unmark',
  'support.policy.set',
  'support.emergencyStop.lift',
  'workflows.rule.set',
  'features.set',
  'tiers.change',
  'channels.transfer',
  'channels.claim.approve',
  'credentials.create',
  'credentials.rotate',
] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export const isWorkflowActionType = (v: unknown): v is WorkflowActionType => typeof v === 'string' && (WORKFLOW_ACTION_TYPES as readonly string[]).includes(v);

export const WORKFLOW_ROLES = ['super_admin', 'admin'] as const;
export type WorkflowRole = (typeof WORKFLOW_ROLES)[number];

/** Who may approve: a role, the finance list (optionally only those holding one money permission), or named accounts. */
export type WorkflowApproverSet =
  | { kind: 'role'; role: WorkflowRole }
  | { kind: 'finance'; permission?: SupportPermission }
  | { kind: 'people'; userIds: string[] };

export const WORKFLOW_STEP_UP = ['none', 'approve', 'propose_and_approve'] as const;
export type WorkflowStepUp = (typeof WORKFLOW_STEP_UP)[number];

export interface WorkflowRuleConfig {
  /** Different people besides the proposer who must approve (0 = direct: proposing applies it). */
  approvalsNeeded: number;
  approvers: WorkflowApproverSet[];
  exclusions: {
    /** The person the change is about can't approve it (floor: always on). */
    subject: boolean;
    techStaff: boolean;
    owner: boolean;
    /** One step per person on a request: whoever proposed, approved or rejected can't take another deciding step. */
    oneStepPerPerson: boolean;
  };
  stepUp: WorkflowStepUp;
  /** Hours a pending request stays open (1 hour – 30 days). */
  expiryHours: number;
  effectiveDate: { allowed: boolean; maxDaysAhead: number };
  notify: { email: boolean; extra: WorkflowApproverSet[] };
}

export interface WorkflowFloor {
  /** Lowest `approvalsNeeded` a rule may have. */
  minApprovals: number;
  /** Tech staff and the owner are always excluded, and approvers come only from the finance list. */
  money: boolean;
  /** Step-up can't be lowered below this. */
  minStepUp: WorkflowStepUp;
}

export interface WorkflowActionDefinition {
  type: WorkflowActionType;
  domain: WorkflowDomain;
  label: WorkflowLocalized;
  /** Rules may be set per scope (for example one per feature switch); '' is the default scope. */
  scoped: boolean;
  floor: WorkflowFloor;
  defaultRule: WorkflowRuleConfig;
}

const DAY = 24;

const rule = (over: Partial<WorkflowRuleConfig> & Pick<WorkflowRuleConfig, 'approvalsNeeded' | 'approvers'>): WorkflowRuleConfig => ({
  exclusions: { subject: true, techStaff: false, owner: false, oneStepPerPerson: true },
  stepUp: 'approve',
  expiryHours: 7 * DAY,
  effectiveDate: { allowed: false, maxDaysAhead: 0 },
  notify: { email: true, extra: [] },
  ...over,
});

const moneyRule = (approvalsNeeded: number, permission: SupportPermission | undefined, over: Partial<WorkflowRuleConfig> = {}): WorkflowRuleConfig =>
  rule({
    approvalsNeeded,
    approvers: [permission ? { kind: 'finance', permission } : { kind: 'finance' }],
    exclusions: { subject: true, techStaff: true, owner: true, oneStepPerPerson: true },
    stepUp: 'propose_and_approve',
    ...over,
  });

const SUPER_ADMINS: WorkflowApproverSet[] = [{ kind: 'role', role: 'super_admin' }];
const MONEY_FLOOR = (minApprovals: number): WorkflowFloor => ({ minApprovals, money: true, minStepUp: 'approve' });
const OPEN_FLOOR: WorkflowFloor = { minApprovals: 0, money: false, minStepUp: 'none' };

const def = (d: WorkflowActionDefinition) => Object.freeze(d);

/** The registry (§3). Default rules are what a fresh database is seeded with. */
export const WORKFLOW_ACTIONS: Readonly<Record<WorkflowActionType, WorkflowActionDefinition>> = Object.freeze({
  'support.fees.set': def({
    type: 'support.fees.set',
    domain: 'money',
    label: { en: 'Change a creator-support fee', ar: 'تغيير رسم من رسوم دعم صنّاع المحتوى' },
    scoped: false,
    floor: MONEY_FLOOR(1),
    defaultRule: moneyRule(1, 'support:providers', { effectiveDate: { allowed: true, maxDaysAhead: 90 } }),
  }),
  'support.payoutBatch.approve': def({
    type: 'support.payoutBatch.approve',
    domain: 'money',
    label: { en: 'Approve a payout batch', ar: 'اعتماد دفعة تحويلات' },
    scoped: false,
    // MEM-D24: 1 person in all (the preparer) → 0 approvers; 2 → 1. The engine raises this floor to the
    // MEM-D24 answer (WF-D3); without an answer the seeded rule asks for one approver.
    floor: MONEY_FLOOR(0),
    defaultRule: moneyRule(1, 'support:payouts', { expiryHours: 5 * DAY }),
  }),
  'support.ledger.adjust': def({
    type: 'support.ledger.adjust',
    domain: 'money',
    label: { en: 'Post a ledger adjustment', ar: 'تسجيل تسوية في السجل المالي' },
    scoped: false,
    floor: MONEY_FLOOR(0),
    defaultRule: moneyRule(1, 'support:ledger'),
  }),
  'support.financeList.add': def({
    type: 'support.financeList.add',
    // About who holds money permissions, decided by super admins (not the finance list): people domain
    domain: 'people',
    label: { en: 'Add someone to the finance list', ar: 'إضافة شخص إلى قائمة المالية' },
    scoped: false,
    floor: { minApprovals: 1, money: false, minStepUp: 'approve' },
    defaultRule: rule({ approvalsNeeded: 1, approvers: SUPER_ADMINS, exclusions: { subject: true, techStaff: false, owner: false, oneStepPerPerson: true }, stepUp: 'propose_and_approve' }),
  }),
  'support.techStaff.unmark': def({
    type: 'support.techStaff.unmark',
    // About who holds money permissions, decided by super admins (not the finance list): people domain
    domain: 'people',
    label: { en: 'Remove a tech-staff mark', ar: 'إزالة علامة الفريق التقني' },
    scoped: false,
    floor: { minApprovals: 1, money: false, minStepUp: 'approve' },
    defaultRule: rule({ approvalsNeeded: 1, approvers: SUPER_ADMINS, stepUp: 'propose_and_approve' }),
  }),
  'support.policy.set': def({
    type: 'support.policy.set',
    domain: 'money',
    label: { en: 'Change creator-support settings', ar: 'تغيير إعدادات دعم صنّاع المحتوى' },
    scoped: false,
    floor: MONEY_FLOOR(0),
    defaultRule: moneyRule(1, 'support:providers', { effectiveDate: { allowed: true, maxDaysAhead: 90 } }),
  }),
  'support.emergencyStop.lift': def({
    type: 'support.emergencyStop.lift',
    domain: 'money',
    label: { en: 'Lift the creator-support emergency stop', ar: 'رفع الإيقاف الطارئ لدعم صنّاع المحتوى' },
    scoped: false,
    floor: MONEY_FLOOR(0),
    defaultRule: moneyRule(1, undefined, { expiryHours: DAY }),
  }),
  'workflows.rule.set': def({
    type: 'workflows.rule.set',
    domain: 'governance',
    label: { en: 'Change an approval rule', ar: 'تغيير قاعدة موافقة' },
    // Scoped by the domain of the rule being changed: 'money' rule changes are approved by the finance list.
    scoped: true,
    floor: { minApprovals: 1, money: false, minStepUp: 'approve' },
    defaultRule: rule({ approvalsNeeded: 1, approvers: SUPER_ADMINS }),
  }),
  'features.set': def({
    type: 'features.set',
    domain: 'platform',
    label: { en: 'Switch a feature on or off', ar: 'تشغيل ميزة أو إيقافها' },
    scoped: true,
    floor: OPEN_FLOOR,
    defaultRule: rule({ approvalsNeeded: 0, approvers: SUPER_ADMINS, stepUp: 'none' }),
  }),
  'tiers.change': def({
    type: 'tiers.change',
    domain: 'platform',
    label: { en: 'Change a creator tier', ar: 'تغيير مستوى صانع محتوى' },
    scoped: true,
    floor: OPEN_FLOOR,
    defaultRule: rule({ approvalsNeeded: 0, approvers: SUPER_ADMINS, stepUp: 'none' }),
  }),
  'channels.transfer': def({
    type: 'channels.transfer',
    domain: 'people',
    label: { en: 'Move a channel to another account', ar: 'نقل قناة إلى حساب آخر' },
    scoped: false,
    floor: OPEN_FLOOR,
    defaultRule: rule({ approvalsNeeded: 0, approvers: SUPER_ADMINS, stepUp: 'none' }),
  }),
  'channels.claim.approve': def({
    type: 'channels.claim.approve',
    domain: 'people',
    label: { en: 'Approve a channel claim', ar: 'الموافقة على مطالبة بقناة' },
    scoped: false,
    floor: OPEN_FLOOR,
    defaultRule: rule({ approvalsNeeded: 0, approvers: SUPER_ADMINS, stepUp: 'none' }),
  }),
  'credentials.create': def({
    type: 'credentials.create',
    domain: 'platform',
    label: { en: 'Create a platform credential', ar: 'إنشاء بيانات اعتماد للمنصّة' },
    scoped: false,
    floor: OPEN_FLOOR,
    defaultRule: rule({ approvalsNeeded: 0, approvers: SUPER_ADMINS, stepUp: 'propose_and_approve' }),
  }),
  'credentials.rotate': def({
    type: 'credentials.rotate',
    domain: 'platform',
    label: { en: 'Rotate a platform credential', ar: 'تجديد بيانات اعتماد للمنصّة' },
    scoped: false,
    floor: OPEN_FLOOR,
    defaultRule: rule({ approvalsNeeded: 0, approvers: SUPER_ADMINS, stepUp: 'propose_and_approve' }),
  }),
});

/** Rule changes for money actions are scoped 'money' and approved by the finance list (§4.3). */
export const WORKFLOW_RULE_CHANGE_MONEY_SCOPE = 'money';
export const WORKFLOW_MONEY_RULE_CHANGE_DEFAULT: WorkflowRuleConfig = moneyRule(1, undefined);

/** WF-D9: switching creator support on is a money action; its features.set scope is seeded with this rule. */
export const WORKFLOW_CREATOR_SUPPORT_SWITCH_RULE: WorkflowRuleConfig = moneyRule(1, undefined, { stepUp: 'approve' });

/** Scopes with their own seeded rule and floor (shown on the rules page even before anyone edits them). */
export const WORKFLOW_SEEDED_SCOPES: Readonly<Partial<Record<WorkflowActionType, readonly string[]>>> = Object.freeze({
  'features.set': ['creatorSupport'],
  'workflows.rule.set': [WORKFLOW_RULE_CHANGE_MONEY_SCOPE],
});

/**
 * The floor for an action in a scope. Two scopes carry the money floor although their action doesn't:
 * the creatorSupport switch (turning it on starts taking money, WF-D9) and changes to money rules
 * (rule-change scope 'money'), so neither can be lowered or approved by tech staff or the owner.
 */
export function workflowFloorFor(type: WorkflowActionType, scope: string): WorkflowFloor {
  if (type === 'features.set' && scope === 'creatorSupport') return MONEY_FLOOR(1);
  if (type === 'workflows.rule.set' && scope === WORKFLOW_RULE_CHANGE_MONEY_SCOPE) return MONEY_FLOOR(1);
  return WORKFLOW_ACTIONS[type].floor;
}

/** The default rule for a scope with no stored version. */
export function workflowDefaultRuleFor(type: WorkflowActionType, scope: string): WorkflowRuleConfig {
  if (type === 'features.set' && scope === 'creatorSupport') return WORKFLOW_CREATOR_SUPPORT_SWITCH_RULE;
  if (type === 'workflows.rule.set' && scope === WORKFLOW_RULE_CHANGE_MONEY_SCOPE) return WORKFLOW_MONEY_RULE_CHANGE_DEFAULT;
  return WORKFLOW_ACTIONS[type].defaultRule;
}

/** Whether a rule (action + scope) is a money rule: changes to it are approved by the finance list. */
export const isMoneyRule = (type: WorkflowActionType, scope: string) => workflowFloorFor(type, scope).money;

// ---------------------------------------------------------------------------------------------------
// Rule validation and floors (§4.1, §4.3)
// ---------------------------------------------------------------------------------------------------

export const WORKFLOW_LIMITS = Object.freeze({
  maxApprovals: 3,
  minExpiryHours: 1,
  maxExpiryHours: 30 * DAY,
  maxEffectiveDaysAhead: 90,
  maxNamedPeople: 20,
  maxUserIdLength: 100,
  maxReasonLength: 1000,
  maxNoteLength: 1000,
  scopeMaxLength: 64,
});

const STEP_UP_RANK: Record<WorkflowStepUp, number> = { none: 0, approve: 1, propose_and_approve: 2 };
export const stepUpAtLeast = (a: WorkflowStepUp, b: WorkflowStepUp) => STEP_UP_RANK[a] >= STEP_UP_RANK[b];

export type WorkflowRuleProblem =
  | 'invalid_shape'
  | 'approvals_out_of_range'
  | 'approvers_empty'
  | 'approvers_invalid'
  | 'expiry_out_of_range'
  | 'effective_out_of_range'
  | 'below_floor_approvals'
  | 'below_floor_step_up'
  | 'below_floor_money_approvers'
  | 'below_floor_money_exclusions'
  | 'below_floor_subject';

export type WorkflowRuleResult = { ok: true; rule: WorkflowRuleConfig } | { ok: false; problems: WorkflowRuleProblem[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function cleanApproverSet(v: unknown): WorkflowApproverSet | null {
  if (!isObj(v)) return null;
  if (v.kind === 'role') return (WORKFLOW_ROLES as readonly unknown[]).includes(v.role) ? { kind: 'role', role: v.role as WorkflowRole } : null;
  if (v.kind === 'finance') {
    if (v.permission === undefined || v.permission === null) return { kind: 'finance' };
    return typeof v.permission === 'string' && (WORKFLOW_FINANCE_PERMISSIONS as readonly string[]).includes(v.permission) ? { kind: 'finance', permission: v.permission as SupportPermission } : null;
  }
  if (v.kind === 'people') {
    if (!Array.isArray(v.userIds) || !v.userIds.length || v.userIds.length > WORKFLOW_LIMITS.maxNamedPeople) return null;
    const ids = [...new Set(v.userIds)];
    if (!ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= WORKFLOW_LIMITS.maxUserIdLength)) return null;
    return { kind: 'people', userIds: ids as string[] };
  }
  return null;
}

/**
 * Validates a rule from the rules page against its shape, the limits and the action's floor.
 * `minApprovals` raises the floor for this call (payout batches and ledger adjustments: MEM-D24, WF-D3).
 */
export function validateWorkflowRule(type: WorkflowActionType, input: unknown, opts: { minApprovals?: number; scope?: string } = {}): WorkflowRuleResult {
  const action = WORKFLOW_ACTIONS[type];
  if (!action || !isObj(input)) return { ok: false, problems: ['invalid_shape'] };
  const problems = new Set<WorkflowRuleProblem>();
  const ex = isObj(input.exclusions) ? input.exclusions : null;
  const eff = isObj(input.effectiveDate) ? input.effectiveDate : null;
  const notify = isObj(input.notify) ? input.notify : null;
  if (!ex || !eff || !notify || !Array.isArray(input.approvers) || typeof input.stepUp !== 'string') return { ok: false, problems: ['invalid_shape'] };

  const approvalsNeeded = input.approvalsNeeded;
  if (!isInt(approvalsNeeded) || approvalsNeeded < 0 || approvalsNeeded > WORKFLOW_LIMITS.maxApprovals) problems.add('approvals_out_of_range');

  const approvers = input.approvers.map(cleanApproverSet);
  if (approvers.some((a) => a === null)) problems.add('approvers_invalid');
  if (!approvers.length) problems.add('approvers_empty');
  const extra = Array.isArray(notify.extra) ? notify.extra.map(cleanApproverSet) : [null];
  if (extra.some((a) => a === null)) problems.add('approvers_invalid');

  if (!(WORKFLOW_STEP_UP as readonly string[]).includes(input.stepUp)) problems.add('invalid_shape');
  const expiryHours = input.expiryHours;
  if (!isInt(expiryHours) || expiryHours < WORKFLOW_LIMITS.minExpiryHours || expiryHours > WORKFLOW_LIMITS.maxExpiryHours) problems.add('expiry_out_of_range');
  if (typeof eff.allowed !== 'boolean' || !isInt(eff.maxDaysAhead) || eff.maxDaysAhead < 0 || eff.maxDaysAhead > WORKFLOW_LIMITS.maxEffectiveDaysAhead) problems.add('effective_out_of_range');
  for (const k of ['subject', 'techStaff', 'owner', 'oneStepPerPerson'] as const) if (typeof ex[k] !== 'boolean') problems.add('invalid_shape');
  if (typeof notify.email !== 'boolean') problems.add('invalid_shape');
  if (problems.size) return { ok: false, problems: [...problems] };

  const candidate: WorkflowRuleConfig = {
    approvalsNeeded: approvalsNeeded as number,
    approvers: approvers as WorkflowApproverSet[],
    exclusions: { subject: ex.subject as boolean, techStaff: ex.techStaff as boolean, owner: ex.owner as boolean, oneStepPerPerson: ex.oneStepPerPerson as boolean },
    stepUp: input.stepUp as WorkflowStepUp,
    expiryHours: expiryHours as number,
    effectiveDate: { allowed: eff.allowed as boolean, maxDaysAhead: eff.maxDaysAhead as number },
    notify: { email: notify.email as boolean, extra: extra as WorkflowApproverSet[] },
  };
  const floorProblems = checkWorkflowFloor(workflowFloorFor(type, opts.scope ?? ''), candidate, opts.minApprovals);
  return floorProblems.length ? { ok: false, problems: floorProblems } : { ok: true, rule: candidate };
}

/** The floor check alone (§4.3); the engine runs it again on the rule in force when a request is approved. */
export function checkWorkflowFloor(floor: WorkflowFloor, r: WorkflowRuleConfig, minApprovals?: number): WorkflowRuleProblem[] {
  const out: WorkflowRuleProblem[] = [];
  if (r.approvalsNeeded < Math.max(floor.minApprovals, minApprovals ?? 0)) out.push('below_floor_approvals');
  if (!stepUpAtLeast(r.stepUp, floor.minStepUp)) out.push('below_floor_step_up');
  if (!r.exclusions.subject) out.push('below_floor_subject');
  if (floor.money) {
    if (!r.approvers.every((a) => a.kind === 'finance')) out.push('below_floor_money_approvers');
    if (!r.exclusions.techStaff || !r.exclusions.owner) out.push('below_floor_money_exclusions');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Who may approve (§4.1, §4.2)
// ---------------------------------------------------------------------------------------------------

/** What the engine knows about the person acting. */
export interface WorkflowActor {
  userId: string;
  roles: readonly string[];
  /** Money permissions held through an approved, current finance-list entry (empty when not on it). */
  financePermissions: readonly SupportPermission[];
  techStaff: boolean;
  owner: boolean;
}

/** What the engine knows about the request when someone tries to approve or reject it. */
export interface WorkflowRequestFacts {
  proposedBy: string;
  subjectUserId?: string | null;
  /** Everyone who has taken a deciding step (propose, approve, reject), in order. */
  decidedBy: readonly string[];
  approvedBy: readonly string[];
}

export type WorkflowApprovalBlock =
  | 'own_request'
  | 'subject'
  | 'excluded_tech_staff'
  | 'excluded_owner'
  | 'not_in_approver_set'
  | 'one_step_per_person'
  | 'already_approved';

export function inApproverSet(sets: readonly WorkflowApproverSet[], actor: WorkflowActor): boolean {
  return sets.some((s) => {
    // 'admin' means admins and super admins; 'super_admin' means super admins only
    if (s.kind === 'role') return actor.roles.includes(s.role) || (s.role === 'admin' && actor.roles.includes('super_admin'));
    if (s.kind === 'finance') return actor.financePermissions.length > 0 && (!s.permission || actor.financePermissions.includes(s.permission));
    return s.userIds.includes(actor.userId);
  });
}

/**
 * Why `actor` may not approve or reject this request under `rule` (empty: they may). The domain's floor
 * applies even when a stored rule were somehow weaker: money always excludes tech staff and the owner.
 */
export function workflowApprovalBlocks(rule: WorkflowRuleConfig, floor: WorkflowFloor, req: WorkflowRequestFacts, actor: WorkflowActor): WorkflowApprovalBlock[] {
  const out: WorkflowApprovalBlock[] = [];
  if (actor.userId === req.proposedBy) out.push('own_request');
  if (req.subjectUserId && actor.userId === req.subjectUserId) out.push('subject');
  if ((rule.exclusions.techStaff || floor.money) && actor.techStaff) out.push('excluded_tech_staff');
  if ((rule.exclusions.owner || floor.money) && actor.owner) out.push('excluded_owner');
  const sets = floor.money ? rule.approvers.filter((a) => a.kind === 'finance') : rule.approvers;
  if (!inApproverSet(sets, actor)) out.push('not_in_approver_set');
  if (req.approvedBy.includes(actor.userId)) out.push('already_approved');
  else if (rule.exclusions.oneStepPerPerson && req.decidedBy.includes(actor.userId)) out.push('one_step_per_person');
  return out;
}

/** Proposing a money action: tech staff and the owner never may (the feature's own permission check runs too). */
export function workflowProposeBlocks(floor: WorkflowFloor, actor: WorkflowActor): ('excluded_tech_staff' | 'excluded_owner')[] {
  if (!floor.money) return [];
  const out: ('excluded_tech_staff' | 'excluded_owner')[] = [];
  if (actor.techStaff) out.push('excluded_tech_staff');
  if (actor.owner) out.push('excluded_owner');
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Requests: states and steps (§5)
// ---------------------------------------------------------------------------------------------------

export const WORKFLOW_STATUSES = ['pending', 'approved', 'scheduled', 'applying', 'applied', 'failed', 'rejected', 'withdrawn', 'expired', 'stale'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/** A request in one of these holds the target's lock (one open request per target). */
export const WORKFLOW_OPEN_STATUSES: readonly WorkflowStatus[] = Object.freeze(['pending', 'approved', 'scheduled', 'applying', 'failed']);
export const WORKFLOW_CLOSED_STATUSES: readonly WorkflowStatus[] = Object.freeze(['applied', 'rejected', 'withdrawn', 'expired', 'stale']);
export const isWorkflowOpen = (s: WorkflowStatus) => WORKFLOW_OPEN_STATUSES.includes(s);

const TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = Object.freeze({
  pending: ['approved', 'scheduled', 'applying', 'rejected', 'withdrawn', 'expired', 'stale'],
  approved: ['scheduled', 'applying', 'stale'],
  scheduled: ['applying', 'withdrawn', 'stale'],
  applying: ['applied', 'failed', 'stale'],
  failed: ['applying', 'withdrawn', 'stale'],
  applied: [],
  rejected: [],
  withdrawn: [],
  expired: [],
  stale: [],
});
export const canWorkflowTransition = (from: WorkflowStatus, to: WorkflowStatus) => TRANSITIONS[from].includes(to);

export const WORKFLOW_STEP_KINDS = ['propose', 'approve', 'reject', 'withdraw', 'comment', 'apply', 'fail', 'expire', 'stale', 'retry'] as const;
export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];
/** Steps that count toward "one step per person". */
export const WORKFLOW_DECIDING_STEPS: readonly WorkflowStepKind[] = Object.freeze(['propose', 'approve', 'reject']);

/** Hours → expiry instant. */
export const workflowExpiresAt = (proposedAt: Date, rule: WorkflowRuleConfig) => new Date(proposedAt.getTime() + rule.expiryHours * 3_600_000);

/** Checks a proposed effective date against the rule: null when fine, else the error code. */
export function workflowEffectiveDateProblem(rule: WorkflowRuleConfig, effectiveAt: Date | null, now: Date): null | 'effective_date_not_allowed' {
  if (!effectiveAt) return null;
  if (!rule.effectiveDate.allowed) return 'effective_date_not_allowed';
  if (Number.isNaN(effectiveAt.getTime())) return 'effective_date_not_allowed';
  const max = now.getTime() + rule.effectiveDate.maxDaysAhead * 86_400_000;
  return effectiveAt.getTime() > max ? 'effective_date_not_allowed' : null;
}

/** WF-D6: approved after the chosen date → it applies at approval time. */
export const workflowApplyAt = (effectiveAt: Date | null, approvedAt: Date) => (effectiveAt && effectiveAt.getTime() > approvedAt.getTime() ? effectiveAt : approvedAt);

/** The lock key while a request is open. */
export const workflowOpenKey = (type: WorkflowActionType, targetKind: string, targetId: string) => `${type}:${targetKind}:${targetId}`;

// ---------------------------------------------------------------------------------------------------
// The diff (§6)
// ---------------------------------------------------------------------------------------------------

export const WORKFLOW_FIELD_KINDS = ['text', 'money', 'percent', 'bps', 'count', 'bool', 'date', 'person', 'list', 'enum', 'secret'] as const;
export type WorkflowFieldKind = (typeof WORKFLOW_FIELD_KINDS)[number];

export interface WorkflowField {
  key: string;
  label: WorkflowLocalized;
  kind: WorkflowFieldKind;
  /** null when the field is new */
  before: unknown;
  /** null when the field is removed */
  after: unknown;
  currency?: string;
  enumLabels?: Record<string, WorkflowLocalized>;
}

/** A secret never appears in a diff: only whether it was replaced. */
export const workflowSecretField = (key: string, label: WorkflowLocalized, hadValue: boolean): WorkflowField => ({ key, label, kind: 'secret', before: hadValue ? 'set' : null, after: 'replaced' });

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const workflowFieldChanged = (f: WorkflowField) => f.kind === 'secret' || !same(f.before, f.after);

// ---------------------------------------------------------------------------------------------------
// API shapes (§8)
// ---------------------------------------------------------------------------------------------------

export interface WorkflowRequestView {
  id: string;
  type: WorkflowActionType;
  scope: string;
  domain: WorkflowDomain;
  title: WorkflowLocalized;
  target: { kind: string; id: string };
  fields: WorkflowField[];
  reason: string;
  proposedBy: string;
  proposedAt: string;
  effectiveAt: string | null;
  expiresAt: string;
  status: WorkflowStatus;
  approvalsNeeded: number;
  approvalsCount: number;
  version: number;
  appliedAt: string | null;
  steps: { seq: number; actor: string; kind: WorkflowStepKind; note: string | null; stepUp: boolean; at: string }[];
  can?: { approve: boolean; reject: boolean; withdraw: boolean; blocks: WorkflowApprovalBlock[] };
}

/** What a governed route answers: applied at once (direct rule) or waiting for approval. */
export type WorkflowProposeResult<R = unknown> = { status: 'applied'; requestId: string; result: R } | { status: 'pending_approval'; request: WorkflowRequestView };

// ---------------------------------------------------------------------------------------------------
// Errors (§8), server-written in both languages
// ---------------------------------------------------------------------------------------------------

export const WORKFLOW_ERROR_CODES = [
  'change_pending',
  'approval_not_allowed',
  'propose_not_allowed',
  'request_closed',
  'request_stale',
  'version_conflict',
  'rule_below_floor',
  'rule_invalid',
  'effective_date_not_allowed',
  'nobody_can_approve',
] as const;
export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

export const WORKFLOW_ERROR_MESSAGES: Readonly<Record<WorkflowErrorCode, WorkflowLocalized>> = Object.freeze({
  change_pending: { en: 'A change to this is already waiting for approval.', ar: 'هناك تغيير على هذا ينتظر الموافقة بالفعل.' },
  approval_not_allowed: { en: 'You can’t approve or reject this request.', ar: 'لا يمكنك الموافقة على هذا الطلب أو رفضه.' },
  propose_not_allowed: { en: 'You can’t propose this change.', ar: 'لا يمكنك اقتراح هذا التغيير.' },
  request_closed: { en: 'This request is already closed.', ar: 'هذا الطلب مُغلق بالفعل.' },
  request_stale: { en: 'This changed since the request was made. Propose it again with the current values.', ar: 'تغيّر هذا منذ تقديم الطلب. اقترحه مرة أخرى بالقيم الحالية.' },
  version_conflict: { en: 'Someone else acted on this request a moment ago. It has been refreshed.', ar: 'تصرّف شخص آخر في هذا الطلب قبل لحظات. جرى تحديثه.' },
  rule_below_floor: { en: 'This rule can’t be set lower than its minimum.', ar: 'لا يمكن ضبط هذه القاعدة أقل من حدّها الأدنى.' },
  rule_invalid: { en: 'Check the rule’s values.', ar: 'راجِع قيم القاعدة.' },
  effective_date_not_allowed: { en: 'That date isn’t allowed for this change.', ar: 'هذا التاريخ غير مسموح به لهذا التغيير.' },
  nobody_can_approve: { en: 'Nobody can approve this yet.', ar: 'لا أحد يستطيع الموافقة على هذا بعد.' },
});

export const WORKFLOW_BLOCK_MESSAGES: Readonly<Record<WorkflowApprovalBlock | 'excluded_tech_staff' | 'excluded_owner', WorkflowLocalized>> = Object.freeze({
  own_request: { en: 'You proposed this request.', ar: 'أنت من اقترح هذا الطلب.' },
  subject: { en: 'This change is about you.', ar: 'هذا التغيير يخصّك.' },
  excluded_tech_staff: { en: 'Tech staff can’t approve money changes.', ar: 'لا يمكن للفريق التقني الموافقة على التغييرات المالية.' },
  excluded_owner: { en: 'The platform owner can’t approve money changes.', ar: 'لا يمكن لمالك المنصّة الموافقة على التغييرات المالية.' },
  not_in_approver_set: { en: 'You aren’t one of the approvers this rule names.', ar: 'لستَ من الموافِقين الذين تحدّدهم هذه القاعدة.' },
  one_step_per_person: { en: 'You already took a step on this request.', ar: 'سبق أن اتخذتَ خطوة في هذا الطلب.' },
  already_approved: { en: 'You already approved this request.', ar: 'سبق أن وافقتَ على هذا الطلب.' },
});

export const WORKFLOW_STATUS_LABELS: Readonly<Record<WorkflowStatus, WorkflowLocalized>> = Object.freeze({
  pending: { en: 'Waiting for approval', ar: 'بانتظار الموافقة' },
  approved: { en: 'Approved', ar: 'تمت الموافقة' },
  scheduled: { en: 'Scheduled', ar: 'مُجدوَل' },
  applying: { en: 'Taking effect', ar: 'قيد التنفيذ' },
  applied: { en: 'In effect', ar: 'نافذ' },
  failed: { en: 'Failed', ar: 'تعذّر التنفيذ' },
  rejected: { en: 'Rejected', ar: 'مرفوض' },
  withdrawn: { en: 'Withdrawn', ar: 'مسحوب' },
  expired: { en: 'Expired', ar: 'منتهي الصلاحية' },
  stale: { en: 'Out of date', ar: 'لم يعد صالحًا' },
});
