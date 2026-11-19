'use client';

/**
 * "Translate missing" for a list page (L10N rule): fills the missing language of the listed (filtered or
 * selected) rows by machine translation, then shows every suggestion for review: each stays editable,
 * and nothing is saved until the admin presses Save. Quran text and empty answers are listed as
 * "fill by hand", never saved. The page saves through `onSave` (its own API, with its own validation)
 * and gets back which keys were saved; the rest stay for another try.
 *
 * Also the list filter (All / A language missing / Arabic missing / English missing).
 */
import { useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import { cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { reportError } from '@/lib/errors/reporter';
import { suggestionOf, translateBatches, translateErrorCode, type MissingFilter, type MissingItem } from '@/lib/localized';
import { smallTranslateButton, translateErrorMessage, translateFields, type TranslateFn } from './LocalizedFieldPair';
import { Select } from '@/components/select/Select';

export type ReviewedItem = MissingItem & { text: string };

export interface TranslateMissingProps {
  /** The fields to fill (lib/localized.ts missingItems over the filtered or selected rows) */
  items: MissingItem[];
  /** `<feature>` for the audit; each item's field is appended (`categories.label`) */
  feature: string;
  rowLabel: (rowId: string) => string;
  fieldLabel: (field: string) => string;
  /** Saves the reviewed texts; answers the keys saved (the others stay in the review) */
  onSave: (items: ReviewedItem[]) => Promise<{ saved: string[] }>;
  translate?: TranslateFn;
  disabled?: boolean;
}

export function TranslateMissing({ items, feature, rowLabel, fieldLabel, onSave, translate = translateFields, disabled = false }: TranslateMissingProps) {
  const { t, locale } = useLanguage();
  const [busy, setBusy] = useState<'translate' | 'save' | null>(null);
  const [review, setReview] = useState<ReviewedItem[] | null>(null);
  const [skipped, setSkipped] = useState<MissingItem[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const langName = (l: 'en' | 'ar') => t(l === 'en' ? 'localized.langEnglish' : 'localized.langArabic');

  async function run() {
    setBusy('translate');
    setError('');
    setStatus(t('localized.translating'));
    const reviewed: ReviewedItem[] = [];
    const left: MissingItem[] = [];
    let stopped = false;
    try {
      for (const batch of translateBatches(items)) {
        if (stopped) break;
        // One field name per request (it shapes the prompt and the audit)
        for (const field of [...new Set(batch.items.map((i) => i.field))]) {
          const group = batch.items.filter((i) => i.field === field);
          const r = await translate({ from: batch.from, to: batch.to, texts: group.map((i) => i.source), field: `${feature}.${field}` });
          if (!r.ok) {
            const code = translateErrorCode(r.code);
            if (code === 'failed') reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'translate-missing', feature } });
            // What was translated so far is still offered for review; the rest can be tried again later
            setError(translateErrorMessage(t, code, locale));
            stopped = true;
            break;
          }
          group.forEach((item, n) => {
            const s = suggestionOf(r.data.items[n]);
            if (s.kind === 'text') reviewed.push({ ...item, text: s.text });
            else left.push(item);
          });
        }
      }
    } catch (e) {
      reportError(e, { shown: true, extra: { action: 'translate-missing', feature } });
      setError(t('localized.errors.failed'));
    } finally {
      setBusy(null);
    }
    setReview(reviewed.length || left.length ? reviewed : null);
    setSkipped(left);
    setStatus(reviewed.length ? t('localized.reviewIntro') : '');
  }

  async function save() {
    if (!review?.length) return;
    setBusy('save');
    setError('');
    try {
      const { saved } = await onSave(review);
      const rest = review.filter((r) => !saved.includes(r.key));
      setReview(rest.length ? rest : null);
      setStatus(rest.length ? t('localized.reviewPartial', { saved: formatNumber(saved.length, locale), failed: formatNumber(rest.length, locale) }) : t('localized.reviewSaved', { count: formatNumber(saved.length, locale) }));
      if (!rest.length) setSkipped([]);
    } catch (e) {
      reportError(e, { shown: true, extra: { action: 'translate-missing-save', feature } });
      setError(t('localized.errors.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="translate-missing">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={smallTranslateButton} disabled={disabled || busy !== null || !items.length || review !== null} onClick={() => void run()} data-testid="translate-missing-run">
          {items.length ? t('localized.translateMissing', { count: formatNumber(items.length, locale) }) : t('localized.translateMissingNone')}
        </button>
        <p role="status" aria-live="polite" className="text-sm text-fg-muted" data-testid="translate-missing-status">
          {status}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-fg" data-testid="translate-missing-error">
          {error}
        </p>
      ) : null}
      {review !== null ? (
        <section className={`${cardClass} flex flex-col gap-3`} aria-labelledby="translate-missing-title" data-testid="translate-missing-review">
          <h2 id="translate-missing-title" className="text-lg font-semibold text-fg">
            {t('localized.reviewTitle')}
          </h2>
          {review.length ? (
            <ul className="flex flex-col gap-3">
              {review.map((item, n) => (
                <li key={item.key} className="grid gap-2 sm:grid-cols-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{t('localized.reviewRow', { row: rowLabel(item.rowId), field: fieldLabel(item.field) })}</p>
                    <p className="text-sm text-fg-muted">{t('localized.reviewSource', { lang: langName(item.from) })}</p>
                    <p className="text-sm text-fg break-words" lang={item.from} dir={item.from === 'ar' ? 'rtl' : 'ltr'}>
                      {item.source}
                    </p>
                  </div>
                  <label className="flex flex-col gap-1 min-w-0">
                    <span className="text-sm font-medium text-fg">{t(item.to === 'en' ? 'localized.english' : 'localized.arabic')}</span>
                    <textarea
                      className={`${fieldClass} w-full`}
                      rows={2}
                      lang={item.to}
                      dir={item.to === 'ar' ? 'rtl' : 'ltr'}
                      value={item.text}
                      onChange={(e) => setReview((r) => (r ? r.map((x, i) => (i === n ? { ...x, text: e.target.value } : x)) : r))}
                      data-testid={`translate-missing-text-${item.key}`}
                    />
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {skipped.length ? (
            <div className="text-sm text-fg-muted" data-testid="translate-missing-skipped">
              <p>{t('localized.reviewSkipped', { count: formatNumber(skipped.length, locale) })}</p>
              <ul className="list-disc ps-5">
                {skipped.map((i) => (
                  <li key={i.key}>{t('localized.reviewRow', { row: rowLabel(i.rowId), field: fieldLabel(i.field) })}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButtonClass} disabled={busy !== null || !review.length || review.some((r) => !r.text.trim())} onClick={() => void save()} data-testid="translate-missing-save">
              {t('localized.reviewSave', { count: formatNumber(review.length, locale) })}
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy !== null}
              onClick={() => {
                setReview(null);
                setSkipped([]);
                setStatus('');
              }}
              data-testid="translate-missing-discard"
            >
              {t('localized.reviewDiscard')}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** The list filter for legacy rows missing a language. */
export function MissingFilterSelect({ value, onChange, id = 'missing-language-filter' }: { value: MissingFilter; onChange: (f: MissingFilter) => void; id?: string }) {
  const { t } = useLanguage();
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-sm text-fg">
      {t('localized.filterLabel')}
      <Select id={id} className={fieldClass} value={value} onChange={(e) => onChange(e.target.value as MissingFilter)} data-testid="missing-filter">
        <option value="all">{t('localized.filterAll')}</option>
        <option value="missing">{t('localized.filterMissing')}</option>
        <option value="ar">{t('localized.filterMissingAr')}</option>
        <option value="en">{t('localized.filterMissingEn')}</option>
      </Select>
    </label>
  );
}
