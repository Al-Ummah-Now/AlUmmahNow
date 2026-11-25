'use client';

import { useCallback, useId, useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WORKFLOW_LIMITS, stepUpAtLeast, type AdminSuggestion, type WorkflowActionType, type WorkflowApproverSet, type WorkflowFloor, type WorkflowRuleConfig, type WorkflowStepUp } from '@al-ummah/shared-types';
import { Autocomplete, type AutocompleteSource } from '@/components/search/Autocomplete';
import { Select } from '@/components/select/Select';
import { NumberField } from '@/components/forms/NumberField';
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import type { ActionResult } from '@/lib/api/errors';
import type { WorkflowProposeResult } from '@/lib/api/workflows';
import { logger } from '@/lib/logger-client';
import { MONEY_PERMISSION_KEYS, permissionLabel } from '@/lib/workflows';

interface Props {
  type: WorkflowActionType;
  scope: string;
  actionName: string;
  rule: WorkflowRuleConfig;
  floor: WorkflowFloor;
  propose: (type: WorkflowActionType, scope: string, config: WorkflowRuleConfig, reason: string) => Promise<ActionResult<WorkflowProposeResult>>;
  /** Names of the people already named in the rule (never their ids) */
  names: Record<string, string>;
  /** The scope's name in the page language */
  scopeText?: { text: string; named: boolean } | null;
  /** Who can be named for the emails (lib/api/workflows searchWorkflowRecipients) */
  recipients: (query: string) => Promise<{ items: AdminSuggestion[] }>;
}

const STEP_UPS: WorkflowStepUp[] = ['none', 'approve', 'propose_and_approve'];
const PROBLEMS = ['approvals_out_of_range', 'approvers_empty', 'approvers_invalid', 'recipients_invalid', 'expiry_out_of_range', 'below_floor_approvals', 'below_floor_step_up', 'below_floor_money_approvers', 'below_floor_money_exclusions', 'below_floor_subject', 'invalid_shape', 'not_connected'];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Edit one approval rule in the in-app dialog (wiki AUN-WORKFLOWS §4.1, §10). Values below the rule's
 * minimum are disabled with the reason; money rules keep the finance list as the only approvers and
 * always exclude tech staff and the owner. Saving asks for approval: the change is a request.
 */
export function RuleEditor({ type, scope, actionName, rule, floor, propose, names, scopeText, recipients }: Props) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const ids = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WorkflowRuleConfig>(() => clone(rule));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const perm = permissionLabel(t);
  const problemParams = (problem: string): Record<string, string> =>
    problem === 'recipients_invalid'
      ? { max: formatNumber(WORKFLOW_LIMITS.maxNamedPeople, locale) }
      : problem === 'expiry_out_of_range'
      ? { min: formatNumber(WORKFLOW_LIMITS.minExpiryHours, locale), max: formatNumber(WORKFLOW_LIMITS.maxExpiryHours, locale) }
      : { min: formatNumber(0, locale), max: formatNumber(WORKFLOW_LIMITS.maxApprovals, locale) };
  const [labels, setLabels] = useState<Record<string, string>>(names);
  const nameOf = (uid: string) => labels[uid] ?? t('workflows.someone');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const finance = draft.approvers.find((a): a is Extract<WorkflowApproverSet, { kind: 'finance' }> => a.kind === 'finance');
  const people = draft.approvers.find((a): a is Extract<WorkflowApproverSet, { kind: 'people' }> => a.kind === 'people');
  const hasRole = (role: 'super_admin' | 'admin') => draft.approvers.some((a) => a.kind === 'role' && a.role === role);
  const set = (patch: Partial<WorkflowRuleConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleSet = (match: (a: WorkflowApproverSet) => boolean, on: boolean, add: WorkflowApproverSet) =>
    setDraft((d) => ({ ...d, approvers: on ? [...d.approvers.filter((a) => !match(a)), add] : d.approvers.filter((a) => !match(a)) }));
  // Who else gets the emails: the same groups, and people by name
  const extraFinance = draft.notify.extra.find((a): a is Extract<WorkflowApproverSet, { kind: 'finance' }> => a.kind === 'finance');
  const extraPeople = draft.notify.extra.find((a): a is Extract<WorkflowApproverSet, { kind: 'people' }> => a.kind === 'people');
  const extraRole = (role: 'super_admin' | 'admin') => draft.notify.extra.some((a) => a.kind === 'role' && a.role === role);
  const toggleExtra = (match: (a: WorkflowApproverSet) => boolean, on: boolean, add: WorkflowApproverSet) =>
    setDraft((d) => ({ ...d, notify: { ...d.notify, extra: on ? [...d.notify.extra.filter((a) => !match(a)), add] : d.notify.extra.filter((a) => !match(a)) } }));
  const recipientSource: AutocompleteSource = useCallback(
    async (q) => {
      try {
        return { items: (await recipients(q)).items, next: null };
      } catch (error) {
        logger.warn('[approval-rules] Recipient search failed', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    [recipients],
  );
  const ex = (key: keyof WorkflowRuleConfig['exclusions'], on: boolean) => setDraft((d) => ({ ...d, exclusions: { ...d.exclusions, [key]: on } }));

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await propose(type, scope, draft, reason);
      if (result.ok) {
        setMessage({ tone: 'ok', text: result.data.status === 'applied' ? t('workflows.rules.applied') : t('workflows.rules.sent') });
        setOpen(false);
        setReason('');
        router.refresh();
      } else {
        const problem = result.problems?.[0]?.problem;
        if (result.status >= 500) logger.error('[approval-rules] Propose failed', { type, scope, status: result.status, code: result.code });
        // A known problem reads best in the page's words; otherwise admin-api's own sentence (already in the admin's language)
        const known = problem && PROBLEMS.includes(problem);
        setMessage({ tone: 'error', text: known ? t(`workflows.rules.problems.${problem}` as MessageKey, problemParams(problem)) : result.status < 500 && result.error ? result.error : t('workflows.failed') });
      }
    } catch (e) {
      logger.error('[approval-rules] Propose request failed', { type, scope, error: e instanceof Error ? e.message : String(e) });
      setMessage({ tone: 'error', text: t('workflows.failed') });
    } finally {
      setBusy(false);
    }
  }

  const checkbox = (id: string, label: string, checked: boolean, onChange: (on: boolean) => void, locked: false | 'floor' | 'money' | 'always' = false, testId?: string) => (
    <label htmlFor={id} className={`flex min-h-11 items-center gap-2 text-sm sm:min-h-0 ${locked ? 'text-fg-muted' : 'text-fg'}`}>
      <input id={id} type="checkbox" className="h-4 w-4 accent-accent" checked={checked} disabled={!!locked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{label}</span>
      {locked && <span className="text-xs text-fg-subtle">({t(locked === 'money' ? 'workflows.rules.lockedMoney' : locked === 'always' ? 'workflows.rules.lockedAlways' : 'workflows.rules.locked')})</span>}
    </label>
  );

  return (
    <>
      <button
        type="button"
        className={`${secondaryButtonClass} min-h-11 sm:min-h-0`}
        onClick={() => {
          setDraft(clone(rule));
          setMessage(null);
          setOpen(true);
        }}
        data-testid={`approval-rule-edit-${type}${scope ? `-${scope}` : ''}`}
      >
        {t('workflows.rules.edit')}
      </button>
      {message && !open && (
        <p role="status" className={`basis-full text-end text-sm ${message.tone === 'error' ? 'text-danger-fg' : 'text-fg-muted'}`} data-testid="approval-rule-message">
          {message.text}
        </p>
      )}
      <dialog
        ref={ref}
        onCancel={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        aria-labelledby={`${ids}-title`}
        className="m-auto bg-surface text-fg border border-border rounded-lg p-0 w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] backdrop:bg-fg/50"
        data-testid="approval-rule-dialog"
      >
        <form
          className="space-y-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 id={`${ids}-title`} className="text-lg font-semibold">
            {t('workflows.rules.editTitle', { action: actionName })}
            {scope && (
              <span className="ms-2 inline-block text-sm font-normal text-fg-muted" dir={scopeText?.named ? undefined : 'ltr'}>
                {scopeText?.text ?? scope}
              </span>
            )}
          </h2>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-n`} className="text-sm font-medium">{t('workflows.rules.approvalsNeeded')}</label>
            <Select id={`${ids}-n`} value={String(draft.approvalsNeeded)} onChange={(e) => set({ approvalsNeeded: Number(e.target.value) })} data-testid="approval-rule-count">
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={String(n)} disabled={n < floor.minApprovals}>
                  {formatNumber(n, locale)}
                </option>
              ))}
            </Select>
            <span className="text-xs text-fg-subtle">{t('workflows.rules.approvalsHint', { zero: formatNumber(0, locale) })}</span>
          </div>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('workflows.rules.approvers')}</legend>
            {checkbox(`${ids}-sa`, t('workflows.rules.roleSuper'), hasRole('super_admin'), (on) => toggleSet((a) => a.kind === 'role' && a.role === 'super_admin', on, { kind: 'role', role: 'super_admin' }), floor.money && 'money', 'approval-rule-super')}
            {checkbox(`${ids}-ad`, t('workflows.rules.roleAdmin'), hasRole('admin'), (on) => toggleSet((a) => a.kind === 'role' && a.role === 'admin', on, { kind: 'role', role: 'admin' }), floor.money && 'money', 'approval-rule-admin')}
            {checkbox(`${ids}-fi`, t('workflows.rules.financeAny'), !!finance, (on) => toggleSet((a) => a.kind === 'finance', on, { kind: 'finance' }), floor.money && !!finance && 'money', 'approval-rule-finance')}
            {finance && (
              <div className="ms-6 flex flex-col gap-1">
                <label htmlFor={`${ids}-fp`} className="text-xs text-fg-muted">{t('workflows.rules.financePermission')}</label>
                <Select
                  id={`${ids}-fp`}
                  value={finance.permission ?? ''}
                  onChange={(e) => toggleSet((a) => a.kind === 'finance', true, e.target.value ? { kind: 'finance', permission: e.target.value as (typeof MONEY_PERMISSION_KEYS)[number] } : { kind: 'finance' })}
                  data-testid="approval-rule-finance-permission"
                >
                  <option value="">{t('workflows.rules.financePermissionAny')}</option>
                  {MONEY_PERMISSION_KEYS.map((p) => (
                    <option key={p} value={p}>
                      {perm(p)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {!floor.money && (
              <div className="pt-2">
                <Autocomplete
                  key={people?.userIds.join(',') ?? 'none'}
                  kind="user"
                  mode="pick"
                  label={t('workflows.rules.peopleAdd')}
                  allowIds={false}
                  showIds={false}
                  onChange={(uid, item) => {
                    if (!uid) return;
                    if (item?.label) setLabels((l) => ({ ...l, [uid]: item.label }));
                    const next = [...new Set([...(people?.userIds ?? []), uid])].slice(0, WORKFLOW_LIMITS.maxNamedPeople);
                    toggleSet((a) => a.kind === 'people', true, { kind: 'people', userIds: next });
                  }}
                  testId="approval-rule-people"
                />
                <PeopleChips
                  ids={people?.userIds ?? []}
                  nameOf={nameOf}
                  testId="approval-rule-people-list"
                  onRemove={(uid) => {
                    const rest = (people?.userIds ?? []).filter((x) => x !== uid);
                    toggleSet((a) => a.kind === 'people', rest.length > 0, { kind: 'people', userIds: rest });
                  }}
                />
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('workflows.rules.exclusions')}</legend>
            {checkbox(`${ids}-xs`, t('workflows.rules.exSubject'), true, () => undefined, 'always')}
            {checkbox(`${ids}-xt`, t('workflows.rules.exTech'), draft.exclusions.techStaff || floor.money, (on) => ex('techStaff', on), floor.money && 'money', 'approval-rule-ex-tech')}
            {checkbox(`${ids}-xo`, t('workflows.rules.exOwner'), draft.exclusions.owner || floor.money, (on) => ex('owner', on), floor.money && 'money', 'approval-rule-ex-owner')}
            {checkbox(`${ids}-x1`, t('workflows.rules.exOneStep'), draft.exclusions.oneStepPerPerson, (on) => ex('oneStepPerPerson', on), false, 'approval-rule-ex-onestep')}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-su`} className="text-sm font-medium">{t('workflows.rules.stepUpLabel')}</label>
              <Select id={`${ids}-su`} value={draft.stepUp} onChange={(e) => set({ stepUp: e.target.value as WorkflowStepUp })} data-testid="approval-rule-stepup">
                {STEP_UPS.map((s) => (
                  <option key={s} value={s} disabled={!stepUpAtLeast(s, floor.minStepUp)}>
                    {t(`workflows.rules.stepUpOption.${s}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-ex`} className="text-sm font-medium">{t('workflows.rules.expiry')}</label>
              <NumberField
                id={`${ids}-ex`}
                className={fieldClass}
                value={draft.expiryHours}
                min={WORKFLOW_LIMITS.minExpiryHours}
                max={WORKFLOW_LIMITS.maxExpiryHours}
                onChange={(e) => set({ expiryHours: Number(e.target.value) || 0 })}
                data-testid="approval-rule-expiry"
              />
              <span className="text-xs text-fg-subtle">{t('workflows.rules.expiryHint', { min: formatNumber(WORKFLOW_LIMITS.minExpiryHours, locale), max: formatNumber(WORKFLOW_LIMITS.maxExpiryHours, locale) })}</span>
            </div>
          </div>

          {checkbox(`${ids}-em`, t('workflows.rules.notifyEmail'), draft.notify.email, (on) => setDraft((d) => ({ ...d, notify: { ...d.notify, email: on } })), false, 'approval-rule-email')}

          <fieldset className="space-y-1" data-testid="approval-rule-recipients">
            <legend className="text-sm font-medium">{t('workflows.rules.alsoTell')}</legend>
            <p className="text-xs text-fg-subtle">{t(draft.notify.email ? 'workflows.rules.alsoTellHint' : 'workflows.rules.alsoTellOff')}</p>
            {checkbox(`${ids}-esa`, t('workflows.rules.roleSuper'), extraRole('super_admin'), (on) => toggleExtra((a) => a.kind === 'role' && a.role === 'super_admin', on, { kind: 'role', role: 'super_admin' }), false, 'approval-rule-extra-super')}
            {checkbox(`${ids}-ead`, t('workflows.rules.roleAdmin'), extraRole('admin'), (on) => toggleExtra((a) => a.kind === 'role' && a.role === 'admin', on, { kind: 'role', role: 'admin' }), false, 'approval-rule-extra-admin')}
            {checkbox(`${ids}-efi`, t('workflows.rules.financeAny'), !!extraFinance, (on) => toggleExtra((a) => a.kind === 'finance', on, { kind: 'finance' }), false, 'approval-rule-extra-finance')}
            <div className="pt-2">
              <Autocomplete
                key={extraPeople?.userIds.join(',') ?? 'none'}
                kind="user"
                mode="pick"
                label={t('workflows.rules.alsoTellAdd')}
                source={recipientSource}
                allowIds={false}
                showIds={false}
                initialResults
                popup="inline"
                messages={{
                  recent: (count) => t('workflows.rules.recipientCount', { count }),
                  emptyList: t('workflows.rules.recipientsEmpty'),
                  noMatches: (query) => t('workflows.rules.recipientsNoMatch', { query }),
                  count: (count) => t('workflows.rules.recipientCount', { count }),
                }}
                onChange={(uid, item) => {
                  if (!uid) return;
                  if (item?.label) setLabels((l) => ({ ...l, [uid]: item.label }));
                  const next = [...new Set([...(extraPeople?.userIds ?? []), uid])].slice(0, WORKFLOW_LIMITS.maxNamedPeople);
                  toggleExtra((a) => a.kind === 'people', true, { kind: 'people', userIds: next });
                }}
                testId="approval-rule-extra-people"
              />
              <PeopleChips
                ids={extraPeople?.userIds ?? []}
                nameOf={nameOf}
                testId="approval-rule-extra-people-list"
                onRemove={(uid) => {
                  const rest = (extraPeople?.userIds ?? []).filter((x) => x !== uid);
                  toggleExtra((a) => a.kind === 'people', rest.length > 0, { kind: 'people', userIds: rest });
                }}
              />
            </div>
          </fieldset>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-why`} className="text-sm font-medium">{t('workflows.rules.reason')}</label>
            <textarea id={`${ids}-why`} className={`${fieldClass} min-h-20`} value={reason} required maxLength={WORKFLOW_LIMITS.maxReasonLength} dir="auto" onChange={(e) => setReason(e.target.value)} data-testid="approval-rule-reason" />
            <span className="text-xs text-fg-subtle">{t('workflows.rules.reasonHint')}</span>
          </div>

          {draft.approvers.length === 0 && (
            <p className="text-sm text-danger-fg" data-testid="approval-rule-no-approvers">
              {t('workflows.rules.problems.approvers_empty')}
            </p>
          )}
          {message && open && (
            <p role="alert" className="text-sm text-danger-fg" data-testid="approval-rule-error">
              {message.text}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={`${secondaryButtonClass} min-h-11 sm:min-h-0`} onClick={() => setOpen(false)} data-testid="approval-rule-cancel">
              {t('workflows.rules.cancel')}
            </button>
            <button type="submit" className={`${primaryButtonClass} min-h-11 sm:min-h-0`} disabled={busy || !reason.trim() || draft.approvers.length === 0} data-testid="approval-rule-submit">
              {t('workflows.rules.submit')}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** The named people of a rule, each with its remove button. */
function PeopleChips({ ids, nameOf, onRemove, testId }: { ids: readonly string[]; nameOf: (id: string) => string; onRemove: (id: string) => void; testId: string }) {
  const { t } = useLanguage();
  if (!ids.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" data-testid={testId}>
      {ids.map((uid) => (
        <li key={uid} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
          <span dir="auto">{nameOf(uid)}</span>
          <button type="button" className="min-h-6 min-w-6 rounded-full text-fg-muted hover:text-fg" aria-label={t('workflows.rules.peopleRemove', { name: nameOf(uid) })} onClick={() => onRemove(uid)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
