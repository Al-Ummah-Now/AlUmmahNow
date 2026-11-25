'use client';

/**
 * A staff-set field in both languages (L10N rule, docs/features/LOCALIZED-FIELDS.md): English and
 * العربية side by side (stacked on a phone), each with its own dir/lang, and a Translate button under
 * each that fills the other language from it (POST /api/translate/fields). The suggestion stays
 * editable and is only saved with the form. Replacing text that was already there offers Undo
 * (in-app, never a browser prompt). Status and errors are announced in a polite live region and tied
 * to the fields with aria-describedby. Quran text is refused by the service: the admin is told to
 * paste the official text.
 *
 *   <LocalizedFieldPair label={t('…name')} field="categories.label" value={{ en, ar }} onChange={setName}
 *     errors={{ ar: fieldErrors.labelAr }} required maxLength={60} />
 */
import { useId, useState } from 'react';
import type { AdminFieldTranslateRequest, AdminFieldTranslateResponse } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey, type Translator } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import type { ActionResult } from '@/lib/api/errors';
import { reportError } from '@/lib/errors/reporter';
import { otherLang, suggestionOf, translateErrorCode, type FieldLang, type LocalizedPair } from '@/lib/localized';

/** The words for a refused Translate (the daily cap resets at UTC midnight). */
export function translateErrorMessage(t: Translator, code: ReturnType<typeof translateErrorCode>, locale: string, now = new Date()): string {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return t(`localized.errors.${code}` as MessageKey, { time: formatDate(reset, locale as never, true) });
}

export type TranslateFn = (request: AdminFieldTranslateRequest) => Promise<ActionResult<AdminFieldTranslateResponse>>;

/** The admin-api call (a server action), loaded on first use so the component stays light to render. */
export const translateFields: TranslateFn = (request) => import('@/lib/api/translate').then((m) => m.translateFields(request));

export const smallTranslateButton =
  'inline-flex items-center gap-1 min-h-11 px-3 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; to: FieldLang }
  | { kind: 'done'; to: FieldLang; replaced: boolean; cut: boolean }
  | { kind: 'undone'; to: FieldLang }
  | { kind: 'error'; message: string };

export interface LocalizedFieldPairProps {
  /** The field's name, e.g. "Name" (each input is labelled "Name (English)" for screen readers) */
  label: string;
  /** `<feature>.<field>` for the audit and the cache, e.g. "categories.label" */
  field: string;
  value: LocalizedPair;
  onChange: (next: LocalizedPair) => void;
  /** Per-language errors from the form or the API (shown under the field, tied with aria-describedby) */
  errors?: Partial<Record<FieldLang, string | undefined>>;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Optional help under the pair */
  help?: string;
  /** Base id (defaults to a generated one); inputs get `${id}-en` / `${id}-ar` */
  id?: string;
  /** Base of the data-testid attributes (defaults to the id): `${testId}-en`, `${testId}-translate-en`, … */
  testId?: string;
  /** The inputs' own data-testid when a form already has them (e.g. `tier-free-name` / `tier-free-nameAr`) */
  inputTestIds?: Partial<Record<FieldLang, string>>;
  /** Injected in tests; the admin-api call otherwise */
  translate?: TranslateFn;
}

export function LocalizedFieldPair({ label, field, value, onChange, errors, multiline = false, rows = 3, maxLength, required = true, disabled = false, autoFocus = false, help, id, testId, inputTestIds, translate = translateFields }: LocalizedFieldPairProps) {
  const { t, locale } = useLanguage();
  const generated = useId();
  const base = id ?? `lf-${generated.replace(/:/g, '')}`;
  const tid = testId ?? base;
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [undo, setUndo] = useState<{ lang: FieldLang; previous: string } | null>(null);
  const langName = (l: FieldLang) => t(l === 'en' ? 'localized.langEnglish' : 'localized.langArabic');

  const set = (lang: FieldLang, text: string) => onChange({ ...value, [lang]: text });

  async function run(from: FieldLang) {
    const to = otherLang(from);
    const source = value[from].trim();
    if (!source) {
      setStatus({ kind: 'error', message: t('localized.sourceEmpty', { lang: langName(from) }) });
      return;
    }
    setStatus({ kind: 'busy', to });
    try {
      const r = await translate({ from, to, texts: [source], field });
      if (!r.ok) {
        const code = translateErrorCode(r.code);
        if (code === 'failed') reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'translate-field', field } });
        setStatus({ kind: 'error', message: translateErrorMessage(t, code, locale) });
        return;
      }
      const s = suggestionOf(r.data.items[0]);
      if (s.kind === 'quran') {
        setStatus({ kind: 'error', message: [t('localized.quran'), s.refs.length ? t('localized.quranRefs', { refs: s.refs.map((q) => q.label).join('، ') }) : ''].filter(Boolean).join(' ') });
        return;
      }
      if (s.kind === 'empty') {
        setStatus({ kind: 'error', message: t('localized.errors.failed') });
        return;
      }
      const previous = value[to];
      const replaced = previous.trim().length > 0 && previous !== s.text;
      setUndo(replaced ? { lang: to, previous } : null);
      const cut = !!maxLength && s.text.length > maxLength;
      set(to, cut ? s.text.slice(0, maxLength) : s.text);
      setStatus({ kind: 'done', to, replaced, cut });
    } catch (error) {
      reportError(error, { shown: true, extra: { action: 'translate-field', field } });
      setStatus({ kind: 'error', message: t('localized.errors.failed') });
    }
  }

  function undoLast() {
    if (!undo) return;
    set(undo.lang, undo.previous);
    setStatus({ kind: 'undone', to: undo.lang });
    setUndo(null);
  }

  const statusId = `${base}-status`;
  const message =
    status.kind === 'busy'
      ? t('localized.translating')
      : status.kind === 'done'
        ? [
            t(status.replaced ? 'localized.replaced' : 'localized.filled', { lang: langName(status.to) }),
            status.cut ? t('localized.cut', { lang: langName(status.to), max: maxLength ?? 0 }) : '',
          ]
            .filter(Boolean)
            .join(' ')
        : status.kind === 'undone'
          ? t('localized.undone', { lang: langName(status.to) })
          : status.kind === 'error'
            ? status.message
            : '';

  const column = (lang: FieldLang) => {
    const inputId = `${base}-${lang}`;
    const errorId = `${inputId}-error`;
    const error = errors?.[lang];
    const describedBy = [error ? errorId : '', message ? statusId : '', help ? `${base}-help` : ''].filter(Boolean).join(' ') || undefined;
    const common = {
      id: inputId,
      value: value[lang],
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      disabled,
      required,
      autoFocus: autoFocus && lang === 'en' ? true : undefined,
      maxLength,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': describedBy,
      'aria-label': t('localized.fieldIn', { field: label, lang: langName(lang) }),
      className: `${fieldClass} w-full ${lang === 'ar' ? 'text-right' : 'text-left'} ${error ? 'border-danger-border' : ''}`,
      'data-testid': inputTestIds?.[lang] ?? `${tid}-${lang}`,
    } as const;
    const onInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (undo?.lang === lang) setUndo(null);
      set(lang, e.target.value);
    };
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <label htmlFor={inputId} className="text-sm font-medium text-fg" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {t(lang === 'en' ? 'localized.english' : 'localized.arabic')}
          {required ? <span aria-hidden="true"> *</span> : null}
        </label>
        {multiline ? <textarea {...common} rows={rows} onChange={onInput} /> : <input {...common} type="text" onChange={onInput} />}
        {error ? (
          <p id={errorId} className="text-sm text-danger-fg">
            {error}
          </p>
        ) : null}
        <div>
          <button
            type="button"
            className={smallTranslateButton}
            disabled={disabled || status.kind === 'busy' || !value[lang].trim()}
            onClick={() => void run(lang)}
            data-testid={`${tid}-translate-${lang}`}
          >
            <span aria-hidden="true">{lang === 'en' ? '→' : '←'}</span>
            {t(lang === 'en' ? 'localized.translateToAr' : 'localized.translateToEn')}
            {/* The field's name for screen readers; the visible words stay first in the name (WCAG 2.5.3) */}
            <span className="sr-only"> ({label})</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <fieldset className="flex flex-col gap-2 min-w-0" data-testid={`${tid}-pair`}>
      <legend className="text-sm font-semibold text-fg mb-1">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {column('en')}
        {column('ar')}
      </div>
      {help ? (
        <p id={`${base}-help`} className="text-sm text-fg-muted">
          {help}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 min-h-6">
        <p id={statusId} role="status" aria-live="polite" className={`text-sm ${status.kind === 'error' ? 'text-danger-fg' : 'text-fg-muted'}`} data-testid={`${tid}-status`}>
          {message}
        </p>
        {undo ? (
          <button type="button" className={smallTranslateButton} onClick={undoLast} aria-label={t('localized.undoNamed', { lang: langName(undo.lang) })} data-testid={`${tid}-undo`}>
            {t('localized.undo')}
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}

/** "Arabic missing" / "English missing" chips for a list row (legacy rows saved before the rule). */
export function MissingLanguageBadge({ pairs }: { pairs: Array<Partial<LocalizedPair>> }) {
  const { t } = useLanguage();
  const missing = new Set<FieldLang>();
  for (const p of pairs) for (const l of ['en', 'ar'] as const) if (!p[l]?.trim()) missing.add(l);
  if (!missing.size) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {[...missing].map((l) => (
        <span key={l} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-chip-pending-bg text-chip-pending-fg" data-testid={`missing-${l}`}>
          {t(l === 'ar' ? 'localized.missingAr' : 'localized.missingEn')}
        </span>
      ))}
    </span>
  );
}
