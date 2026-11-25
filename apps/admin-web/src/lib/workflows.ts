/**
 * Display helpers for the Approvals pages (wiki AUN-WORKFLOWS §6, §10): status colours, the diff's
 * values in the reader's language (٠–٩ in Arabic through the shared formatters), and a rule in one
 * line. Pure, so the server pages and the client dialogs share them and tests need no browser.
 */
import { FEATURE_REGISTRY, currencyExponent, formatMoney, isolateText, workflowFieldChanged, workflowScopeName, type WorkflowActionType, type WorkflowApproverSet, type WorkflowField, type WorkflowRuleConfig, type WorkflowStatus } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatDate, formatNumber, translateDynamic, type MessageKey, type Translator } from '@/i18n/translate';

export const WORKFLOW_VIEWS = ['waiting', 'mine', 'open', 'history'] as const;
export type WorkflowViewId = (typeof WORKFLOW_VIEWS)[number];

export function parseWorkflowView(v: string | undefined): WorkflowViewId {
  return (WORKFLOW_VIEWS as readonly string[]).includes(v ?? '') ? (v as WorkflowViewId) : 'waiting';
}

export const workflowsHref = (view: WorkflowViewId, cursor?: string | null) => `/approvals?view=${view}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

/** Status chip colours, from the shared chip tokens. */
export const WORKFLOW_STATUS_CHIP: Record<WorkflowStatus, string> = {
  pending: 'bg-chip-pending-bg text-chip-pending-fg',
  approved: 'bg-chip-resolved-bg text-chip-resolved-fg',
  applying: 'bg-chip-pending-bg text-chip-pending-fg',
  applied: 'bg-chip-resolved-bg text-chip-resolved-fg',
  failed: 'bg-danger-bg text-danger-fg',
  rejected: 'bg-danger-bg text-danger-fg',
  withdrawn: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  expired: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  stale: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
};

/** The rail at the start edge of a request card. */
export const WORKFLOW_STATUS_RAIL: Record<WorkflowStatus, string> = {
  pending: 'border-s-chip-pending-fg',
  approved: 'border-s-chip-resolved-fg',
  applying: 'border-s-chip-pending-fg',
  applied: 'border-s-chip-resolved-fg',
  failed: 'border-s-danger-border',
  rejected: 'border-s-danger-border',
  withdrawn: 'border-s-border',
  expired: 'border-s-border',
  stale: 'border-s-border',
};

export const statusLabel = (t: Translator, status: WorkflowStatus) => translateDynamic(t, 'workflows.status', status);

/** Whether a field changes (secrets always count: their value is never shown). */
export const fieldChanges = workflowFieldChanged;

/** The names of the people in a diff value (never an id or an email), for a page that lists them one per line. */
export const workflowPeople = (ids: readonly unknown[], t: Translator, names: Record<string, string>): string[] => ids.map((id) => names[String(id)] ?? t('workflows.someone'));

/** One value of the diff as text, in the reader's language. People come from `names` (never an email). */
export function workflowValue(f: WorkflowField, v: unknown, locale: Locale, t: Translator, names: Record<string, string>): string {
  if (v === null || v === undefined || v === '') return t('workflows.none');
  if (f.kind === 'secret') return v === 'replaced' ? t('workflows.replaced') : t('workflows.secretSet');
  if (f.kind === 'bool') return v ? t('workflows.yes') : t('workflows.no');
  const separator = locale === 'ar' ? '، ' : ', ';
  // Each name isolated (FSI…PDI), so a Latin name and the Arabic comma after it keep the list's direction on one line
  if (f.kind === 'person') return Array.isArray(v) ? workflowPeople(v, t, names).map(isolateText).join(separator) : workflowPeople([v], t, names)[0];
  const label = (x: unknown) => f.enumLabels?.[String(x)]?.[locale === 'ar' ? 'ar' : 'en'] ?? String(x);
  if (Array.isArray(v)) return v.map(label).join(separator);
  if (f.kind === 'enum') return label(v);
  if (f.kind === 'date' && (typeof v === 'string' || typeof v === 'number')) return formatDate(v, locale);
  if (typeof v === 'number') {
    if (f.kind === 'money') {
      const exp = f.currency ? currencyExponent(f.currency) : 2;
      return formatMoney(locale, v / 10 ** exp, f.currency ?? 'USD', { minimumFractionDigits: exp, maximumFractionDigits: exp });
    }
    if (f.kind === 'bps') return `${formatNumber(v / 100, locale)}${locale === 'ar' ? '٪' : '%'}`;
    if (f.kind === 'percent') return `${formatNumber(v, locale)}${locale === 'ar' ? '٪' : '%'}`;
    return formatNumber(v, locale);
  }
  return String(v);
}

function approverText(set: WorkflowApproverSet, t: Translator, permissionLabel: (p: string) => string): string {
  if (set.kind === 'role') return t(set.role === 'super_admin' ? 'workflows.rules.who.super_admin' : 'workflows.rules.who.admin');
  if (set.kind === 'finance') return set.permission ? t('workflows.rules.who.financeWith', { permission: permissionLabel(set.permission) }) : t('workflows.rules.who.finance');
  return t('workflows.rules.who.people', { count: set.userIds.length });
}

/** A rule in one line: "1 approver • the finance list with Providers and fees • passkey to approve • 7 days". */
export function ruleSummary(rule: WorkflowRuleConfig, t: Translator, locale: Locale, permissionLabel: (p: string) => string): string {
  const sep = t('common.sep');
  const parts: string[] = [];
  if (rule.approvalsNeeded === 0) parts.push(t('workflows.rules.direct'));
  else {
    parts.push(t('workflows.rules.approvalsCount', { count: rule.approvalsNeeded }));
    parts.push(rule.approvers.map((a) => approverText(a, t, permissionLabel)).join(locale === 'ar' ? '، ' : ', '));
  }
  parts.push(t(`workflows.rules.stepUp.${rule.stepUp}` as MessageKey));
  if (rule.notify.email && rule.notify.extra.length) parts.push(t('workflows.rules.alsoTells', { who: rule.notify.extra.map((a) => approverText(a, t, permissionLabel)).join(locale === 'ar' ? '، ' : ', ') }));
  parts.push(rule.expiryHours % 24 === 0 ? t('workflows.rules.days', { count: rule.expiryHours / 24 }) : t('workflows.rules.hours', { count: rule.expiryHours }));
  return parts.join(sep);
}

/** Money permissions (FINANCE_ONLY_SUPPORT_PERMISSIONS) and their labels. */
export const MONEY_PERMISSION_KEYS = ['support:refund', 'support:disputes', 'support:payouts', 'support:ledger', 'support:providers'] as const;

export const permissionLabel = (t: Translator) => (p: string) => {
  const key = p.replace('support:', '');
  return (MONEY_PERMISSION_KEYS as readonly string[]).includes(p) ? t(`workflows.permissions.${key}` as MessageKey) : p;
};

/**
 * A rule scope's name on the rules page: the action's own scope names (tiers.change: "A creator's tier",
 * "The default tier", "Tiers and their limits"), a feature switch's name, else the scope as stored.
 * `null` for the default scope (the page says "Default").
 */
export function scopeName(type: WorkflowActionType, scope: string, locale: Locale): { text: string; named: boolean } | null {
  if (!scope) return null;
  const label = workflowScopeName(type, scope);
  if (label) return { text: label[locale], named: true };
  return { text: scope, named: false };
}

/**
 * Features that can be given a rule of their own (every feature but those in `taken`), by name in the page
 * language; a query matches the name in either language.
 */
export function ruleFeatures(taken: readonly string[], query: string, locale: Locale): { id: string; label: string }[] {
  const q = query.trim().toLowerCase();
  return FEATURE_REGISTRY.filter((f) => !taken.includes(f.key) && (!q || [f.name.en, f.name.ar, f.key].some((x) => x.toLowerCase().includes(q))))
    .map((f) => ({ id: f.key, label: f.name[locale] }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** A target's open request on a page: its id, `undefined` when it has none, `null` when the page couldn't read it. */
export type PendingRequest = string | null | undefined;
/** Open requests by target (lib/api/workflows openWorkflowRequests); null when they couldn't be read. */
export type PendingRequests = Readonly<Record<string, string>> | null;
export const pendingFor = (pending: PendingRequests, target: string): PendingRequest => (pending ? pending[target] : null);

/** Whether a "Sent for approval" notice is over: the page was read again and the request is no longer the open one. */
export const sentNoticeEnds = (sent: string, pendingRequest: PendingRequest, readAgain: boolean): boolean =>
  readAgain && pendingRequest !== null && pendingRequest !== sent;
