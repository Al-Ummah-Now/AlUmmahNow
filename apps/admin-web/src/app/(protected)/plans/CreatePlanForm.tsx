'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPlan } from '@/lib/api/admin';
import type { PlanRow } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';

export function CreatePlanForm({ plans }: { plans: PlanRow[] }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [form, setForm] = useState({ slug: '', name_en: '', name_ar: '', audience: 'creator', cloneFrom: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { cloneFrom, ...rest } = form;
    const result = await createPlan({ ...rest, ...(cloneFrom ? { cloneFrom } : {}) });
    setBusy(false);
    if (result.ok === false) {
      setError(result.status === 400 || result.status === 409 ? result.error : t('plans.saveFailed'));
      return;
    }
    router.push(`/plans/${encodeURIComponent(result.data.plan.id)}`);
  }

  return (
    <form onSubmit={submit} className={`${cardClass} space-y-4`} data-testid="plan-create-form">
      <h2 className="text-xl font-semibold text-fg">{t('plans.createTitle')}</h2>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-fg">{t('plans.slug')}<input required dir="ltr" className={fieldClass} value={form.slug} onChange={set('slug')} data-testid="plan-slug" /></label>
        <label className="block text-sm text-fg">{t('plans.audience')}
          <select className={fieldClass} value={form.audience} onChange={set('audience')}>
            {['creator', 'organisation', 'viewer', 'everyone'].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="block text-sm text-fg">{t('plans.nameEn')}<input required dir="ltr" className={fieldClass} value={form.name_en} onChange={set('name_en')} data-testid="plan-name-en" /></label>
        <label className="block text-sm text-fg">{t('plans.nameAr')}<input required dir="rtl" className={fieldClass} value={form.name_ar} onChange={set('name_ar')} data-testid="plan-name-ar" /></label>
        <label className="block text-sm text-fg">{t('plans.cloneFrom')}
          <select className={fieldClass} value={form.cloneFrom} onChange={set('cloneFrom')}>
            <option value="">{t('plans.cloneNone')}</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{locale === 'ar' ? p.name_ar : p.name_en}</option>)}
          </select>
        </label>
      </div>
      <button type="submit" disabled={busy} className={primaryButtonClass} data-testid="plan-create">{t('plans.create')}</button>
    </form>
  );
}
