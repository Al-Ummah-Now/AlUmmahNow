'use client';

/**
 * Payments → Tax & seller details (wiki AUN-SUBS, BillingTaxSettings): the
 * seller's legal details on receipts, whether prices include tax and the rate
 * shown to buyers when the provider is not the merchant of record.
 * billing:manage changes them.
 */
import { useId, useState } from 'react';
import { BILLING_TEXT_LIMITS, type BillingTaxSettings } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { ActionFeedback } from '@/components/content/actions';
import { primarySmallButtonClass } from '@/components/content/parts';
import { cardClass, fieldClass } from '@/components/ui';
import { billingRequest } from '@/lib/list/api-client';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { taxBody, taxDraft, type TaxDraft } from '@/lib/payments';
import { hintClass, labelClass, useBillingAction } from './shared';

export function TaxPanel({ tax, canManage, onRefresh }: { tax: BillingTaxSettings; canManage: boolean; onRefresh: () => Promise<void> }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const { busy, error, notice, run } = useBillingAction('payments-tax');
  const { run: withUndo } = useUndoableAction();
  const [draft, setDraft] = useState<TaxDraft>(() => taxDraft(tax));
  const [invalid, setInvalid] = useState<'sellerCountry' | 'taxRatePercent' | null>(null);
  const set = (patch: Partial<TaxDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const field = (name: keyof TaxDraft) => `${ids}-${name}`;

  return (
    <section className={cardClass} aria-label={t('payments.tabs.tax')} data-testid="payments-tax">
      <p className="text-sm text-fg-muted mb-1 max-w-prose">{t('payments.tax.hint')}</p>
      {!canManage && <p className="text-sm text-fg-muted mb-1">{t('payments.tax.readOnly')}</p>}
      {tax.updatedAt && <p className="text-xs text-fg-muted mb-4">{t('payments.tax.changed', { date: formatDate(tax.updatedAt, locale, true) })}</p>}
      <ActionFeedback error={error} message={notice} testId="payments-tax-feedback" />
      <form
        className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          const out = taxBody(draft);
          if (!out.ok) {
            setInvalid(out.field);
            return;
          }
          setInvalid(null);
          void run('tax', async () => {
            await withUndo({
              action: () => billingRequest<{ previous: Record<string, unknown> }>('PUT', 'tax', { body: out.body }),
              // Undo sends back the fields this save changed, as they were
              undo: async (r) => {
                await billingRequest('PUT', 'tax', { body: { ...Object.fromEntries(Object.keys(out.body).map((k) => [k, r.previous[k] ?? null])), undo: true } });
                await onRefresh();
              },
              message: t('payments.saved'),
              undoneMessage: t('payments.undone'),
            });
            await onRefresh();
            return null;
          });
        }}
      >
        <fieldset disabled={!canManage} className="contents">
          <div>
            <label htmlFor={field('sellerName')} className={labelClass}>
              {t('payments.tax.sellerName')}
            </label>
            <input id={field('sellerName')} dir="auto" className={`${fieldClass} w-full`} maxLength={BILLING_TEXT_LIMITS.sellerName} value={draft.sellerName} onChange={(e) => set({ sellerName: e.target.value })} data-testid="payments-tax-seller-name" />
          </div>
          <div>
            <label htmlFor={field('taxId')} className={labelClass}>
              {t('payments.tax.taxId')}
            </label>
            <input id={field('taxId')} dir="ltr" className={`${fieldClass} w-full`} maxLength={BILLING_TEXT_LIMITS.taxId} value={draft.taxId} onChange={(e) => set({ taxId: e.target.value })} aria-describedby={`${field('taxId')}-hint`} />
            <p id={`${field('taxId')}-hint`} className={hintClass}>
              {t('payments.tax.taxIdHint')}
            </p>
          </div>
          <div className="md:col-span-2">
            <label htmlFor={field('sellerAddress')} className={labelClass}>
              {t('payments.tax.sellerAddress')}
            </label>
            <textarea id={field('sellerAddress')} dir="auto" rows={3} className={`${fieldClass} w-full`} maxLength={BILLING_TEXT_LIMITS.sellerAddress} value={draft.sellerAddress} onChange={(e) => set({ sellerAddress: e.target.value })} />
          </div>
          <div>
            <label htmlFor={field('sellerCountry')} className={labelClass}>
              {t('payments.tax.sellerCountry')}
            </label>
            <input
              id={field('sellerCountry')}
              dir="ltr"
              className={`${fieldClass} w-24 uppercase`}
              maxLength={2}
              autoComplete="country"
              value={draft.sellerCountry}
              onChange={(e) => set({ sellerCountry: e.target.value.toUpperCase() })}
              aria-invalid={invalid === 'sellerCountry' || undefined}
              aria-describedby={`${field('sellerCountry')}-hint`}
            />
            <p id={`${field('sellerCountry')}-hint`} className={invalid === 'sellerCountry' ? 'text-xs text-danger-fg mt-1' : hintClass}>
              {invalid === 'sellerCountry' ? t('payments.tax.invalid.sellerCountry') : t('payments.tax.sellerCountryHint')}
            </p>
          </div>
          <div>
            <label htmlFor={field('taxRatePercent')} className={labelClass}>
              {t('payments.tax.taxRatePercent')}
            </label>
            <input
              id={field('taxRatePercent')}
              dir="ltr"
              inputMode="decimal"
              className={`${fieldClass} w-28`}
              value={draft.taxRatePercent}
              onChange={(e) => set({ taxRatePercent: e.target.value })}
              aria-invalid={invalid === 'taxRatePercent' || undefined}
              aria-describedby={`${field('taxRatePercent')}-hint`}
            />
            <p id={`${field('taxRatePercent')}-hint`} className={invalid === 'taxRatePercent' ? 'text-xs text-danger-fg mt-1' : hintClass}>
              {invalid === 'taxRatePercent' ? t('payments.tax.invalid.taxRatePercent') : t('payments.tax.taxRateHint')}
            </p>
          </div>
          <label className="md:col-span-2 flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={draft.pricesIncludeTax} onChange={(e) => set({ pricesIncludeTax: e.target.checked })} data-testid="payments-tax-includes" />
            {t('payments.tax.pricesIncludeTax')}
          </label>
          {canManage && (
            <div className="md:col-span-2">
              <button type="submit" className={primarySmallButtonClass} disabled={busy !== null} data-testid="payments-tax-save">
                {t('payments.tax.save')}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </section>
  );
}
