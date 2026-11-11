/**
 * An English/Arabic field pair, side by side (stacked on phones): each
 * language in its own column with its own label, direction and `lang`, and
 * optionally its own "change this" tick. When a translator is registered
 * (lib/i18n/translate-text.ts) each column offers "Translate from …" filled
 * from the other language's text.
 */
'use client';

import React, { useState } from 'react';
import { Languages } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useTranslator } from '@/lib/i18n/translate-text';
import { logger } from '@/lib/logger-client';
import type { TitleLanguage } from '@al-ummah/shared-types';

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
  idPrefix: string;
  testId?: string;
}

export function BilingualPair({ legend, labels, children, ticked, onTick, tickLabel, tickTestId, textOf, onTranslated, idPrefix, testId }: BilingualPairProps) {
  const { t } = useLanguage();
  const translator = useTranslator();
  const [busy, setBusy] = useState<TitleLanguage | null>(null);

  const translate = async (to: TitleLanguage) => {
    if (!translator || !textOf || !onTranslated) return;
    const from: TitleLanguage = to === 'en' ? 'ar' : 'en';
    const text = textOf(from);
    if (!text.trim()) return;
    setBusy(to);
    try {
      onTranslated(to, await translator(text, from, to));
    } catch (error) {
      logger.warn('[BilingualPair] Translation failed', { from, to, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
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
                    {(language === 'ar' ? t.bulkEdit.translateFromEnglish : t.bulkEdit.translateFromArabic)}
                  </button>
                )}
              </div>
              {/* Labels stay in the page's language; the fields set their own dir and lang */}
              {on && <div className="space-y-3">{children(language, { heading })}</div>}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export default BilingualPair;
