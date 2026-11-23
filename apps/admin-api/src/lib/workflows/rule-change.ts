/**
 * `workflows.rule.set`: changing an approval rule is itself a change request (wiki AUN-WORKFLOWS §4.3).
 * Super admins propose rule changes; a change to a money rule is scoped 'money', and finance-list
 * members propose and approve it, so tech staff (the owner) can never weaken money controls.
 */
import {
  WORKFLOW_ACTIONS,
  WORKFLOW_RULE_CHANGE_MONEY_SCOPE,
  isMoneyRule,
  isWorkflowActionType,
  validateWorkflowRule,
  type WorkflowActionType,
  type WorkflowApproverSet,
  type WorkflowField,
  type WorkflowRuleConfig,
} from '@al-ummah/shared-types';
import { registerWorkflowExecutor, ruleInForce, ruleVersionStatement, WorkflowError } from './engine';
import type { WorkflowExecutor } from './types';

export interface RuleChangePayload {
  type: WorkflowActionType;
  scope: string;
  config: WorkflowRuleConfig;
}

/** Floors raised per action at run time (payout batches and ledger adjustments: MEM-D24). Set by the feature. */
const minApprovalsHooks = new Map<WorkflowActionType, () => Promise<number>>();
export function setRuleMinApprovals(type: WorkflowActionType, hook: () => Promise<number>): void {
  minApprovalsHooks.set(type, hook);
}

const stepUpLabel = { none: { en: 'None', ar: 'لا شيء' }, approve: { en: 'To approve', ar: 'عند الموافقة' }, propose_and_approve: { en: 'To propose and approve', ar: 'عند الاقتراح والموافقة' } };

const approverText = (sets: WorkflowApproverSet[]) =>
  sets.map((s) => (s.kind === 'role' ? `role:${s.role}` : s.kind === 'finance' ? `finance${s.permission ? `:${s.permission}` : ''}` : `people:${s.userIds.join(',')}`)).join(' + ');

function ruleFields(before: WorkflowRuleConfig, after: WorkflowRuleConfig): WorkflowField[] {
  return [
    { key: 'approvalsNeeded', label: { en: 'Approvals needed', ar: 'الموافقات المطلوبة' }, kind: 'count', before: before.approvalsNeeded, after: after.approvalsNeeded },
    { key: 'approvers', label: { en: 'Who may approve', ar: 'من يحق له الموافقة' }, kind: 'text', before: approverText(before.approvers), after: approverText(after.approvers) },
    { key: 'techStaff', label: { en: 'Tech staff excluded', ar: 'استبعاد الفريق التقني' }, kind: 'bool', before: before.exclusions.techStaff, after: after.exclusions.techStaff },
    { key: 'owner', label: { en: 'Owner excluded', ar: 'استبعاد المالك' }, kind: 'bool', before: before.exclusions.owner, after: after.exclusions.owner },
    { key: 'oneStepPerPerson', label: { en: 'One step per person', ar: 'خطوة واحدة لكل شخص' }, kind: 'bool', before: before.exclusions.oneStepPerPerson, after: after.exclusions.oneStepPerPerson },
    { key: 'stepUp', label: { en: 'Passkey check', ar: 'التحقق بمفتاح المرور' }, kind: 'enum', before: before.stepUp, after: after.stepUp, enumLabels: stepUpLabel },
    { key: 'expiryHours', label: { en: 'Expires after (hours)', ar: 'تنتهي صلاحيته بعد (ساعات)' }, kind: 'count', before: before.expiryHours, after: after.expiryHours },
    { key: 'effectiveDate', label: { en: 'Effective date allowed (days ahead)', ar: 'السماح بتاريخ سريان (أيام مقدمًا)' }, kind: 'count', before: before.effectiveDate.allowed ? before.effectiveDate.maxDaysAhead : null, after: after.effectiveDate.allowed ? after.effectiveDate.maxDaysAhead : null },
    { key: 'notifyEmail', label: { en: 'Email notices', ar: 'إشعارات البريد' }, kind: 'bool', before: before.notify.email, after: after.notify.email },
  ];
}

export const ruleChangeExecutor: WorkflowExecutor<RuleChangePayload, { version: number }> = {
  type: 'workflows.rule.set',
  // A rule whose floor is money (money actions, the creatorSupport switch, the money rule-change rule):
  // its change is scoped 'money', so the finance list decides it under the money floor.
  scope: (p) => (isMoneyRule(p.type, p.scope) ? WORKFLOW_RULE_CHANGE_MONEY_SCOPE : ''),
  target: (p) => ({ kind: 'workflow-rule', id: `${p.type}:${p.scope}` }),
  // Money rules: the finance list (tech staff and the owner are refused by the engine's money floor);
  // every other rule: super admins.
  canPropose: async (_ctx, actor, p) => (isMoneyRule(p.type, p.scope) ? actor.financePermissions.length > 0 : actor.roles.includes('super_admin')),
  async validate(_ctx, input) {
    const i = (input ?? {}) as { type?: unknown; scope?: unknown; config?: unknown };
    if (!isWorkflowActionType(i.type)) throw new WorkflowError(400, 'rule_invalid', { problems: ['invalid_shape'] });
    const def = WORKFLOW_ACTIONS[i.type];
    const scope = typeof i.scope === 'string' ? i.scope.trim() : '';
    if (scope && !def.scoped) throw new WorkflowError(400, 'rule_invalid', { problems: ['invalid_shape'] });
    if (!/^[A-Za-z0-9._:-]{0,64}$/.test(scope)) throw new WorkflowError(400, 'rule_invalid', { problems: ['invalid_shape'] });
    const min = (await minApprovalsHooks.get(i.type)?.()) ?? 0;
    const res = validateWorkflowRule(i.type, i.config, { minApprovals: min, scope });
    // (admin-api compiles without strict null checks, so the result union is narrowed by hand)
    if (!res.ok) {
      const problems = (res as Extract<typeof res, { ok: false }>).problems;
      throw new WorkflowError(400, problems.some((p) => p.startsWith('below_floor')) ? 'rule_below_floor' : 'rule_invalid', { problems });
    }
    const valid = res as Extract<typeof res, { ok: true }>;
    return { type: i.type, scope, config: valid.rule };
  },
  async describe(ctx, p) {
    const current = await ruleInForce(ctx, p.type, p.scope);
    const label = WORKFLOW_ACTIONS[p.type].label;
    const scoped = p.scope ? ` (${p.scope})` : '';
    return {
      title: { en: `Approval rule: ${label.en}${scoped}`, ar: `قاعدة الموافقة: ${label.ar}${scoped}` },
      fields: ruleFields(current.config, p.config),
      baseVersion: `${current.scope === p.scope ? current.version : 0}`,
    };
  },
  async currentVersion(ctx, p) {
    const current = await ruleInForce(ctx, p.type, p.scope);
    return `${current.scope === p.scope ? current.version : 0}`;
  },
  async applyStatements(ctx, p, request) {
    const current = await ruleInForce(ctx, p.type, p.scope);
    const version = (current.scope === p.scope ? current.version : 0) + 1;
    return { statements: [ruleVersionStatement(ctx, { type: p.type, scope: p.scope, version, config: p.config, requestId: request.id, by: request.proposedBy })], result: { version } };
  },
};

let registered = false;
export function registerRuleChangeExecutor(): void {
  if (registered) return;
  registered = true;
  registerWorkflowExecutor(ruleChangeExecutor);
}
