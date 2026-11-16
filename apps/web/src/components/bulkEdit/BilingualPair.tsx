/**
 * An English/Arabic field pair, side by side (stacked on phones): each
 * language in its own column with its own label, direction and `lang`, and
 * optionally its own "change this" tick. When a translator is registered
 * (lib/i18n/translate-text.ts, signed in) each column offers "Translate from …"
 * filled from the other language's text: a machine translation to review before
 * saving, asking first before it replaces text already in the field, and saying
 * why when it can't (today's limit with its reset time, paused, budget spent).
 */
'use client';

import { dateTimeFormat } from '@al-ummah/shared-types';
import React, { useState } from 'react';
import { Languages } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { TranslateFailure, useTranslator } from '@/lib/i18n/translate-text';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { InlineTranslateField, TitleLanguage } from '@al-ummah/shared-types';

export const PAIR_LANGUAGES: readonly TitleLanguage[] = ['en', 'ar'];

interface BilingualPairProps {
  /** Group label read by screen readers ("Titles", "Description") */
  legend: string;
  /** Column heading per language */
  labels: Record<TitleLanguage, string>;
  /** The column's fields; `ids` gives stable, language-scoped ids */
  children: (language: TitleLanguage, ids: { heading: string }) => React.ReactNode;
  /** Optional "change this language" ticks */
  ticked?: Record<TitleLanguage, boolean>;
  onTick?: (language: TitleLanguage, on: boolean) => void;
  tickLabel?: (language: TitleLanguage) => string;
  tickTestId?: (language: TitleLanguage) => string;
  /** For Translate: the text to translate from a language, and where to put the result */
  textOf?: (language: TitleLanguage) => string;
  onTranslated?: (language: TitleLanguage, text: string) => void;
  /** What the texts are (title by default) and, in the video editor, the video they belong to */
  field?: InlineTranslateField;
  videoId?: string;
  idPrefix: string;
  testId?: string;
}

/** The local time a fair-use allowance comes back, in the page's language. */
export function resetTime(resetsAt: string | undefined, lang: string): string {
  const at = resetsAt ? new Date(resetsAt) : null;
  if (!at || Number.isNaN(at.getTime())) return '';
  return dateTimeFormat(lang === 'ar' ? 'ar' : 'en', { hour: 'numeric', minute: '2-digit' }).format(at);
}

export function BilingualPair({ legend, labels, children, ticked, onTick, tickLabel, tickTestId, textOf, onTranslated, field, videoId, idPrefix, testId }: BilingualPairProps) {
  const { t, lang } = useLanguage();
  const ti = t.captions.inline;
  const translator = useTranslator();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<TitleLanguage | null>(null);
  const [notes, setNotes] = useState<Partial<Record<TitleLanguage, { text: string; error: boolean }>>>({});

  const failureText = (error: unknown) => {
    if (!(error instanceof TranslateFailure)) return ti.failed;
    if (error.code === 'fair_use_limit') return ti.fairUse.replace('{time}', resetTime(error.resetsAt, lang));
    if (error.code === 'budget_spent') return ti.budget;
    return ti.failed;
  };

  const translate = async (to: TitleLanguage) => {
    if (!translator || !textOf || !onTranslated) return;
    const from: TitleLanguage = to === 'en' ? 'ar' : 'en';
    const text = textOf(from);
    if (!text.trim()) return;
    setNotes((n) => ({ ...n, [to]: undefined }));
    setBusy(to);
    let result: string;
    try {
      result = await translator(text, from, to, { field: field ?? 'title', ...(videoId ? { videoId } : {}) });
    } catch (error) {
      // Switched off meanwhile: the button goes away (the features are read again), nothing to say
      if (error instanceof TranslateFailure && error.code === 'feature_off') return;
      setNotes((n) => ({ ...n, [to]: { text: failureText(error), error: true } }));
      return;
    } finally {
      setBusy(null);
    }
    // Never overwrite the creator's own words without asking
    if (textOf(to).trim() && textOf(to).trim() !== result.trim()) {
      const language = labels[to];
      const yes = await confirm({ title: ti.replaceTitle, description: ti.replaceBody.replace('{language}', language), confirmLabel: ti.replace, cancelLabel: ti.keep });
      if (!yes) return;
    }
    onTranslated(to, result);
    setNotes((n) => ({ ...n, [to]: { text: /\{[^{}]*\S\s+\S[^{}]*\}/.test(text) ? `${ti.hint} ${ti.quranKept}` : ti.hint, error: false } }));
  };

  return (
    <fieldset className="min-w-0" data-testid={testId}>
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-4 md:grid-cols-2">
        {PAIR_LANGUAGES.map((language) => {
          const heading = `${idPrefix}-${language}-heading`;
          const on = ticked ? ticked[language] : true;
          return (
            <div
              key={language}
              className={`min-w-0 rounded-md border p-3 ${on ? 'border-[var(--fanous-color-outline)]' : 'border-dashed border-[var(--fanous-color-divider)]'}`}
              role="group"
              aria-labelledby={heading}
              data-testid={testId ? `${testId}-${language}` : undefined}
              data-language={language}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                {onTick ? (
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--fanous-color-text-primary)]" id={heading}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => onTick(language, e.target.checked)}
                      className="h-5 w-5 accent-[var(--fanous-color-primary)]"
                      data-testid={tickTestId ? tickTestId(language) : testId ? `${testId}-tick-${language}` : undefined}
                    />
                    {tickLabel ? tickLabel(language) : labels[language]}
                  </label>
                ) : (
                  <span className="text-sm font-semibold text-[var(--fanous-color-text-primary)]" id={heading}>{labels[language]}</span>
                )}
                {translator && textOf && onTranslated && on && (
                  <button
                    type="button"
                    className="b b-ghost b-sm"
                    onClick={() => void translate(language)}
                    disabled={busy !== null || !textOf(language === 'en' ? 'ar' : 'en').trim()}
                    data-testid={testId ? `${testId}-translate-${language}` : undefined}
                  >
                    <Languages aria-hidden="true" />
                    {busy === language ? ti.working : language === 'ar' ? t.bulkEdit.translateFromEnglish : t.bulkEdit.translateFromArabic}
                  </button>
                )}
              </div>
              {on && notes[language] && (
                <p
                  role={notes[language]!.error ? 'alert' : 'status'}
                  className={`mb-2 text-xs ${notes[language]!.error ? 'text-[var(--fanous-color-error-text)]' : 'text-[var(--fanous-color-text-secondary)]'}`}
                  data-testid={testId ? `${testId}-translate-note-${language}` : undefined}
                >
                  {notes[language]!.text}
                </p>
              )}
              {/* Labels stay in the page's language; the fields set their own dir and lang */}
              {on && <div className="space-y-3">{children(language, { heading })}</div>}
            </div>
          );
        })}
      </div>
      {dialog}
    </fieldset>
  );
}

export default BilingualPair;
