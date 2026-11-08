'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EntitlementDefinition } from '@al-ummah/shared-types';
import { assignSubjectPlan, cancelSubjectPlan, removeSubjectOverride, setSubjectOverride } from '@/lib/api/admin';
import type { PlanRow, SubjectState } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { entitlementInputText, parseEntitlementInput } from '@/lib/plan-values';

const toIso = (date: string) => (date ? new Date(`${date}T23:59:59Z`).toISOString() : null);

export function SubjectManager({ subject, state, plans, catalogue }: { subject: string; state: SubjectState; plans: PlanRow[]; catalogue: EntitlementDefinition[] }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [reason, setReason] = useState('');
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [trial, setTrial] = useState(false);
  const [end, setEnd] = useState('');
  const [key, setKey] = useState(catalogue[0]?.key ?? '');
  const [value, setValue] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = state.subscription;

  async function run(action: () => Promise<{ ok: true } | { ok: false; status: number; error: string }>) {
    if (!reason.trim()) {
      setError(t('plans.reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok === false) {
      setError(result.status === 400 || result.status === 409 ? result.error : t('plans.saveFailed'));
      return;
    }
    setReason('');
    router.refresh();
  }

  function saveOverride() {
    const def = catalogue.find((d) => d.key === key);
    if (!def) return;
    const parsed = parseEntitlementInput(def, value);
    if (parsed.ok === false) {
      setError(parsed.error);
      return;
    }
    void run(() => setSubjectOverride(subject, { key, value: parsed.value, expiresAt: toIso(expires), reason }));
  }

  return (
    <div className="space-y-6" data-testid="subject-manager">
      {error && <ErrorAlert testId="subject-action-error">{error}</ErrorAlert>}
      <label className={`${cardClass} block text-sm text-fg`}>{t('plans.reason')}
        <input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="subject-reason" />
      </label>

      <section className={`${cardClass} space-y-4`}>
        <h2 className="text-xl font-semibold text-fg">{t('plans.currentPlan')}</h2>
        <p className="text-fg" data-testid="subject-plan">{sub ? `${locale === 'ar' ? sub.name_ar : sub.name_en} (${t('plans.version')} ${sub.plan_version})` : t('plans.defaultPlanNote')}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm text-fg">{t('plans.plan')}
            <select className={fieldClass} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{locale === 'ar' ? p.name_ar : p.name_en}</option>)}
            </select>
          </label>
          <label className="block text-sm text-fg">{t('plans.assignmentType')}
            <select className={fieldClass} value={trial ? 'trial' : 'active'} onChange={(e) => setTrial(e.target.value === 'trial')}>
              <option value="active">{t('plans.typeActive')}</option>
              <option value="trial">{t('plans.typeTrial')}</option>
            </select>
          </label>
          {trial && <label className="block text-sm text-fg">{t('plans.endDate')}<input type="date" className={fieldClass} value={end} onChange={(e) => setEnd(e.target.value)} /></label>}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy || !planId} className={primaryButtonClass} onClick={() => run(() => assignSubjectPlan(subject, { planId, status: trial ? 'trialing' : 'active', expiresAt: trial ? toIso(end) : null, reason }))}>{t('plans.assign')}</button>
          {sub && <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => run(() => cancelSubjectPlan(subject, reason))}>{t('plans.returnToDefault')}</button>}
        </div>
      </section>

      <section className={`${cardClass} space-y-4`}>
        <h2 className="text-xl font-semibold text-fg">{t('plans.overrides')}</h2>
        <p className="text-sm text-fg-muted">{t('plans.overridesHelp')}</p>
        {state.overrides.length === 0 ? <p className="text-fg-muted">{t('plans.noOverrides')}</p> : (
          <ul className="space-y-2 text-sm text-fg" data-testid="subject-overrides">
            {state.overrides.map((o) => (
              <li key={o.key} className="flex flex-wrap items-center gap-3">
                <span dir="ltr">{o.key} = {entitlementInputText(o.value)}</span>
                <span className="text-fg-muted">{t('plans.expires')}: {o.expires_at ? o.expires_at.slice(0, 10) : t('plans.never')}</span>
                <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => run(() => removeSubjectOverride(subject, o.key, reason))}>{t('plans.remove')}</button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm text-fg">{t('plans.key')}
            <select className={fieldClass} value={key} onChange={(e) => setKey(e.target.value)} data-testid="override-key">
              {catalogue.map((d) => <option key={d.key} value={d.key}>{locale === 'ar' ? d.description_ar : d.description_en}</option>)}
            </select>
          </label>
          <label className="block text-sm text-fg">{t('plans.value')}<input dir="ltr" className={fieldClass} value={value} onChange={(e) => setValue(e.target.value)} data-testid="override-value" /></label>
          <label className="block text-sm text-fg">{t('plans.expires')}<input type="date" className={fieldClass} value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        </div>
        <button type="button" disabled={busy} className={primaryButtonClass} onClick={saveOverride} data-testid="override-save">{t('plans.setOverride')}</button>
      </section>

      <section className={`${cardClass} space-y-2`}>
        <h2 className="text-xl font-semibold text-fg">{t('plans.usage')}</h2>
        {state.usage.length === 0 ? <p className="text-fg-muted">{t('plans.noUsage')}</p> : (
          <ul className="text-sm text-fg space-y-1">
            {state.usage.map((u) => <li key={`${u.key}-${u.period}`} dir="ltr">{u.key} ({u.period}): {u.value}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
