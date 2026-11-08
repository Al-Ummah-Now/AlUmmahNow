'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EntitlementDefinition } from '@al-ummah/shared-types';
import { archivePlan, migratePlan, publishPlan, setPlanValues, updatePlanDetails } from '@/lib/api/admin';
import type { PlanDetail, PlanMigration } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { collectPlanValues, entitlementInputText } from '@/lib/plan-values';

export function PlanEditor({ detail, catalogue }: { detail: PlanDetail; catalogue: EntitlementDefinition[] }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const { plan } = detail;
  const start = detail.hasDraft ? detail.draft : detail.published;
  const [names, setNames] = useState({ name_en: plan.name_en, name_ar: plan.name_ar, is_public: plan.is_public === 1 });
  const [text, setText] = useState<Record<string, string>>(Object.fromEntries(catalogue.map((d) => [d.key, entitlementInputText(start[d.key])])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reason, setReason] = useState('');
  const [migration, setMigration] = useState<PlanMigration | null>(null);
  const archived = plan.status === 'archived';

  async function run<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }>): Promise<T | null> {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await action();
    setBusy(false);
    if (result.ok === false) {
      setError(result.status === 400 || result.status === 409 ? result.error : t('plans.saveFailed'));
      return null;
    }
    return result.data;
  }
  async function saveThen(action: Parameters<typeof run>[0]) {
    if ((await run(action)) !== null) {
      setSaved(true);
      router.refresh();
    }
  }
  function saveValues() {
    const collected = collectPlanValues(catalogue, text);
    if ('error' in collected) {
      setError(collected.error);
      return;
    }
    void saveThen(() => setPlanValues(plan.id, collected.values));
  }
  async function migrate(apply: boolean) {
    if (apply && !reason.trim()) {
      setError(t('plans.reasonRequired'));
      return;
    }
    setMigration(await run(() => migratePlan(plan.id, apply, reason)));
    if (apply) router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-fg" data-testid="plan-title">{locale === 'ar' ? plan.name_ar : plan.name_en}</h1>
      <p className="text-fg-muted">{t('plans.version')} {plan.version}</p>
      {error && <ErrorAlert testId="plan-error">{error}</ErrorAlert>}
      {saved && <p role="status" className="text-fg" data-testid="plan-saved">{t('plans.saved')}</p>}

      <section className={`${cardClass} space-y-4`}>
        <h2 className="text-xl font-semibold text-fg">{t('plans.details')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-fg">{t('plans.nameEn')}<input dir="ltr" className={fieldClass} value={names.name_en} onChange={(e) => setNames({ ...names, name_en: e.target.value })} /></label>
          <label className="block text-sm text-fg">{t('plans.nameAr')}<input dir="rtl" className={fieldClass} value={names.name_ar} onChange={(e) => setNames({ ...names, name_ar: e.target.value })} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={names.is_public} onChange={(e) => setNames({ ...names, is_public: e.target.checked })} />{t('plans.public')}</label>
        <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => saveThen(() => updatePlanDetails(plan.id, names))}>{t('plans.saveDetails')}</button>
      </section>

      <section className={`${cardClass} space-y-4`}>
        <h2 className="text-xl font-semibold text-fg">{t('plans.values')}</h2>
        <p className="text-sm text-fg-muted">{t('plans.valuesHelp')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {catalogue.map((d) => {
            const label = locale === 'ar' ? d.description_ar : d.description_en;
            const set = (value: string) => setText((x) => ({ ...x, [d.key]: value }));
            const choices = d.type === 'boolean' ? ['true', 'false'] : d.type === 'enum' ? [...(d.options ?? [])] : null;
            return (
              <label key={d.key} className="block text-sm text-fg">
                {label} <span className="text-fg-muted" dir="ltr">({d.key})</span>
                {choices ? (
                  <select disabled={archived} className={fieldClass} value={text[d.key] ?? ''} onChange={(e) => set(e.target.value)} data-testid={`value-${d.key}`}>
                    <option value="" />
                    {choices.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input disabled={archived} dir="ltr" className={fieldClass} value={text[d.key] ?? ''} onChange={(e) => set(e.target.value)} data-testid={`value-${d.key}`} />
                )}
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy || archived} className={secondaryButtonClass} onClick={saveValues} data-testid="plan-save-values">{t('plans.saveValues')}</button>
          <button type="button" disabled={busy || archived} className={primaryButtonClass} data-testid="plan-publish" onClick={() => window.confirm(t('plans.publishConfirm')) && saveThen(() => publishPlan(plan.id))}>{t('plans.publish')}</button>
          {plan.is_default !== 1 && !archived && (
            <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => window.confirm(t('plans.archiveConfirm')) && saveThen(() => archivePlan(plan.id))}>{t('plans.archive')}</button>
          )}
        </div>
      </section>

      {plan.status !== 'draft' && (
        <section className={`${cardClass} space-y-3`}>
          <h2 className="text-xl font-semibold text-fg">{t('plans.changes')}</h2>
          {detail.diff.length === 0 ? <p className="text-fg-muted">{t('plans.noChanges')}</p> : (
            <ul className="text-sm text-fg space-y-1" data-testid="plan-diff">
              {detail.diff.map((d) => <li key={d.key}><span dir="ltr">{d.key}</span>: {t('plans.before')} <bdi>{entitlementInputText(d.before ?? undefined) || '-'}</bdi>, {t('plans.after')} <bdi>{entitlementInputText(d.after ?? undefined) || '-'}</bdi></li>)}
            </ul>
          )}
        </section>
      )}

      {plan.status === 'active' && (
        <section className={`${cardClass} space-y-3`}>
          <h2 className="text-xl font-semibold text-fg">{t('plans.migrate')}</h2>
          <p className="text-sm text-fg-muted">{t('plans.migrateHelp')}</p>
          <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => migrate(false)}>{t('plans.migrateCheck')}</button>
          {migration && <p role="status" className="text-fg">{t(migration.applied ? 'plans.migrateDone' : 'plans.migrateCount', { count: String(migration.affected), version: String(migration.toVersion) })}</p>}
          {migration && !migration.applied && migration.affected > 0 && (
            <div className="space-y-3">
              <label className="block text-sm text-fg">{t('plans.reason')}<input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <button type="button" disabled={busy} className={primaryButtonClass} onClick={() => migrate(true)}>{t('plans.migrateApply')}</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
