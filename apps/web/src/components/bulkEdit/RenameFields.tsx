/**
 * The rename rule: pattern with tokens, find and replace, prefix/suffix or
 * case, which title fields (en/ar) change, and the digits of Arabic titles.
 * Shared by Studio's bulk edit and the upload queue's "Set values".
 */
'use client';

import React, { useId, useRef } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import type { RenameMode, RenameState } from '@/lib/bulk-edit/form';
import type { TitleLanguage } from '@al-ummah/shared-types';

export const inputClass =
  'mt-1 block w-full min-h-11 rounded-md border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] px-3 text-sm ' +
  'text-[var(--fanous-color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]';
export const labelClass = 'block text-sm font-medium text-[var(--fanous-color-text-primary)]';
export const hintClass = 'mt-1 text-xs text-[var(--fanous-color-text-secondary)]';

const TOKENS = [
  { token: '{n}', key: 'tokenN' },
  { token: '{filename}', key: 'tokenFilename' },
  { token: '{title}', key: 'tokenTitle' },
  { token: '{date}', key: 'tokenDate' },
  { token: '{channel}', key: 'tokenChannel' },
] as const;

interface RenameFieldsProps {
  value: RenameState;
  onChange: (next: RenameState) => void;
  /** Tokens that mean nothing here (e.g. no file names for old videos) */
  hideTokens?: string[];
  idPrefix?: string;
}

export function RenameFields({ value, onChange, hideTokens = [], idPrefix }: RenameFieldsProps) {
  const { t } = useLanguage();
  const r = t.bulkEdit.rename;
  const autoId = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const base = idPrefix ?? `rename-${autoId}`;
  const patternRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof RenameState>(key: K, v: RenameState[K]) => onChange({ ...value, [key]: v });

  const insertToken = (token: string) => {
    const input = patternRef.current;
    const at = input?.selectionStart ?? value.pattern.length;
    const end = input?.selectionEnd ?? at;
    const next = value.pattern.slice(0, at) + token + value.pattern.slice(end);
    set('pattern', next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const toggleLanguage = (lang: TitleLanguage, on: boolean) => {
    const languages = on ? Array.from(new Set([...value.languages, lang])) : value.languages.filter((l) => l !== lang);
    set('languages', (['en', 'ar'] as TitleLanguage[]).filter((l) => languages.includes(l)));
  };

  const modes: Array<{ mode: RenameMode; label: string }> = [
    { mode: 'pattern', label: r.modePattern },
    { mode: 'replace', label: r.modeReplace },
    { mode: 'affix', label: r.modeAffix },
    { mode: 'case', label: r.modeCase },
  ];

  return (
    <div className="space-y-4" data-testid="rename-fields">
      <fieldset>
        <legend className={labelClass}>{r.languages}</legend>
        <div className="mt-1 flex flex-wrap gap-4">
          {(['en', 'ar'] as TitleLanguage[]).map((lang) => (
            <label key={lang} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
              <input
                type="checkbox"
                checked={value.languages.includes(lang)}
                onChange={(e) => toggleLanguage(lang, e.target.checked)}
                data-testid={`rename-lang-${lang}`}
                className="h-4 w-4 accent-[var(--fanous-color-primary)]"
              />
              {lang === 'en' ? r.langEn : r.langAr}
            </label>
          ))}
        </div>
        <p className={hintClass}>{r.languagesHint}</p>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>{r.modeLabel}</legend>
        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2" role="radiogroup">
          {modes.map((m) => (
            <label key={m.mode} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
              <input
                type="radio"
                name={`${base}-mode`}
                value={m.mode}
                checked={value.mode === m.mode}
                onChange={() => set('mode', m.mode)}
                data-testid={`rename-mode-${m.mode}`}
                className="h-4 w-4 accent-[var(--fanous-color-primary)]"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {value.mode === 'pattern' && (
        <div className="space-y-3">
          <div>
            <label htmlFor={`${base}-pattern`} className={labelClass}>{r.pattern}</label>
            <input
              id={`${base}-pattern`}
              ref={patternRef}
              className={inputClass}
              value={value.pattern}
              onChange={(e) => set('pattern', e.target.value)}
              dir="auto"
              aria-describedby={`${base}-pattern-hint`}
              data-testid="rename-pattern"
            />
            <p id={`${base}-pattern-hint`} className={hintClass}>{r.patternHint}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TOKENS.filter((tk) => !hideTokens.includes(tk.token)).map((tk) => (
                <button
                  key={tk.token}
                  type="button"
                  className="b b-secondary b-sm"
                  onClick={() => insertToken(tk.token)}
                  aria-label={r.insertToken.replace('{token}', r[tk.key])}
                  data-testid={`rename-token-${tk.token.slice(1, -1)}`}
                >
                  <code dir="ltr">{tk.token}</code>
                  <span>{r[tk.key]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {([['start', r.start, -9999, 99999], ['step', r.step, -999, 999], ['pad', r.pad, 1, 9]] as const).map(([key, label, min, max]) => (
              <div key={key}>
                <label htmlFor={`${base}-${key}`} className={labelClass}>{label}</label>
                <input
                  id={`${base}-${key}`}
                  type="number"
                  inputMode="numeric"
                  min={min}
                  max={max}
                  className={inputClass}
                  value={value[key]}
                  onChange={(e) => set(key, Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : key === 'pad' ? 1 : 0)}
                  data-testid={`rename-${key}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {value.mode === 'replace' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${base}-find`} className={labelClass}>{r.find}</label>
            <input id={`${base}-find`} className={inputClass} dir="auto" value={value.find} onChange={(e) => set('find', e.target.value)} data-testid="rename-find" />
          </div>
          <div>
            <label htmlFor={`${base}-replace`} className={labelClass}>{r.replaceWith}</label>
            <input id={`${base}-replace`} className={inputClass} dir="auto" value={value.replace} onChange={(e) => set('replace', e.target.value)} data-testid="rename-replace" />
          </div>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
            <input type="checkbox" checked={value.ignoreCase} onChange={(e) => set('ignoreCase', e.target.checked)} data-testid="rename-ignore-case" className="h-4 w-4 accent-[var(--fanous-color-primary)]" />
            {r.ignoreCase}
          </label>
        </div>
      )}

      {value.mode === 'affix' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${base}-prefix`} className={labelClass}>{r.prefix}</label>
            <input id={`${base}-prefix`} className={inputClass} dir="auto" value={value.prefix} onChange={(e) => set('prefix', e.target.value)} data-testid="rename-prefix" />
          </div>
          <div>
            <label htmlFor={`${base}-suffix`} className={labelClass}>{r.suffix}</label>
            <input id={`${base}-suffix`} className={inputClass} dir="auto" value={value.suffix} onChange={(e) => set('suffix', e.target.value)} data-testid="rename-suffix" />
          </div>
        </div>
      )}

      {value.mode === 'case' && (
        <fieldset>
          <legend className={labelClass}>{r.caseMode}</legend>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {([['upper', r.caseUpper], ['lower', r.caseLower], ['title', r.caseTitle], ['sentence', r.caseSentence]] as const).map(([mode, label]) => (
              <label key={mode} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                <input type="radio" name={`${base}-case`} checked={value.caseMode === mode} onChange={() => set('caseMode', mode)} className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`rename-case-${mode}`} />
                <span dir="ltr">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {value.languages.includes('ar') && (value.mode === 'pattern') && (
        <fieldset>
          <legend className={labelClass}>{r.arabicDigits}</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {([['latin', r.digitsLatin], ['arabic-indic', r.digitsArabic]] as const).map(([digits, label]) => (
              <label key={digits} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                <input type="radio" name={`${base}-digits`} checked={value.arabicDigits === digits} onChange={() => set('arabicDigits', digits)} className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`rename-digits-${digits}`} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

export default RenameFields;
