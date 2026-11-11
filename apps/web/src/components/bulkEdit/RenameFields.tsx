/**
 * The rename rules, English and Arabic side by side. Each language has its
 * own tick and its own rule (pattern with tokens, find and replace,
 * prefix/suffix or case), so both titles change in one pass to different
 * values: "Lesson {n}" and "الدرس {n}". Numbering (start, step, digits) is
 * shared: a video gets the same {n} in both. Arabic-Indic digits are an
 * option of the Arabic title only. Shared by Studio's bulk edit and the
 * upload queue's "Set values".
 */
'use client';

import React, { useRef } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import type { LanguageRule, RenameMode, RenameState } from '@/lib/bulk-edit/form';
import type { TitleLanguage } from '@al-ummah/shared-types';
import { BilingualPair } from './BilingualPair';

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

const radioLabel = 'inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]';
const radioInput = 'h-4 w-4 accent-[var(--fanous-color-primary)]';

interface RenameFieldsProps {
  value: RenameState;
  onChange: (next: RenameState) => void;
  /** Tokens that mean nothing here (e.g. no file names for old videos) */
  hideTokens?: string[];
  idPrefix?: string;
}

export function RenameFields({ value, onChange, hideTokens = [], idPrefix = 'rename' }: RenameFieldsProps) {
  const { t } = useLanguage();
  const r = t.bulkEdit.rename;
  const b = t.bulkEdit;
  const patternRefs = useRef<Partial<Record<TitleLanguage, HTMLInputElement | null>>>({});
  const set = <K extends keyof RenameState>(key: K, v: RenameState[K]) => onChange({ ...value, [key]: v });
  const setRule = (language: TitleLanguage, patch: Partial<LanguageRule>) =>
    onChange({ ...value, rules: { ...value.rules, [language]: { ...value.rules[language], ...patch } } });

  const insertToken = (language: TitleLanguage, token: string) => {
    const input = patternRefs.current[language];
    const pattern = value.rules[language].pattern;
    const at = input?.selectionStart ?? pattern.length;
    const end = input?.selectionEnd ?? at;
    setRule(language, { pattern: pattern.slice(0, at) + token + pattern.slice(end) });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const toggleLanguage = (language: TitleLanguage, on: boolean) => {
    const languages = on ? Array.from(new Set([...value.languages, language])) : value.languages.filter((l) => l !== language);
    set('languages', (['en', 'ar'] as TitleLanguage[]).filter((l) => languages.includes(l)));
  };

  const modes: Array<{ mode: RenameMode; label: string }> = [
    { mode: 'pattern', label: r.modePattern },
    { mode: 'replace', label: r.modeReplace },
    { mode: 'affix', label: r.modeAffix },
    { mode: 'case', label: r.modeCase },
  ];
  const usesNumbers = value.languages.some((l) => value.rules[l].mode === 'pattern' && value.rules[l].pattern.includes('{n}'));
  const arabicNumbered = value.languages.includes('ar') && value.rules.ar.mode === 'pattern' && value.rules.ar.pattern.includes('{n}');

  const column = (language: TitleLanguage) => {
    const rule = value.rules[language];
    const id = (field: string) => `${idPrefix}-${field}-${language}`;
    const tid = (field: string) => `rename-${field}-${language}`;
    const dir = language === 'ar' ? 'rtl' : 'ltr';
    return (
      <>
        <fieldset>
          <legend className={labelClass}>{r.modeLabel}</legend>
          <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2" role="radiogroup">
            {modes.map((m) => (
              <label key={m.mode} className={radioLabel}>
                <input type="radio" name={`${idPrefix}-mode-${language}`} value={m.mode} checked={rule.mode === m.mode}
                  onChange={() => setRule(language, { mode: m.mode })} className={radioInput} data-testid={tid(`mode-${m.mode}`)} />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>

        {rule.mode === 'pattern' && (
          <div>
            <label htmlFor={id('pattern')} className={labelClass}>{r.pattern}</label>
            <input
              id={id('pattern')}
              ref={(el) => { patternRefs.current[language] = el; }}
              className={inputClass}
              value={rule.pattern}
              onChange={(e) => setRule(language, { pattern: e.target.value })}
              dir={dir}
              lang={language}
              aria-describedby={`${id('pattern')}-hint`}
              data-testid={tid('pattern')}
            />
            <p id={`${id('pattern')}-hint`} className={hintClass}>{r.patternHint}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TOKENS.filter((tk) => !hideTokens.includes(tk.token)).map((tk) => (
                <button key={tk.token} type="button" className="b b-secondary b-sm" onClick={() => insertToken(language, tk.token)}
                  aria-label={`${r.insertToken.replace('{token}', r[tk.key])} (${language === 'ar' ? r.langAr : r.langEn})`}
                  data-testid={tid(`token-${tk.token.slice(1, -1)}`)}>
                  <code dir="ltr">{tk.token}</code>
                  <span>{r[tk.key]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {rule.mode === 'replace' && (
          <div className="grid gap-3">
            <div>
              <label htmlFor={id('find')} className={labelClass}>{r.find}</label>
              <input id={id('find')} className={inputClass} dir={dir} lang={language} value={rule.find} onChange={(e) => setRule(language, { find: e.target.value })} data-testid={tid('find')} />
            </div>
            <div>
              <label htmlFor={id('replace')} className={labelClass}>{r.replaceWith}</label>
              <input id={id('replace')} className={inputClass} dir={dir} lang={language} value={rule.replace} onChange={(e) => setRule(language, { replace: e.target.value })} data-testid={tid('replace')} />
            </div>
            <label className={radioLabel}>
              <input type="checkbox" checked={rule.ignoreCase} onChange={(e) => setRule(language, { ignoreCase: e.target.checked })} className={radioInput} data-testid={tid('ignore-case')} />
              {r.ignoreCase}
            </label>
          </div>
        )}

        {rule.mode === 'affix' && (
          <div className="grid gap-3">
            <div>
              <label htmlFor={id('prefix')} className={labelClass}>{r.prefix}</label>
              <input id={id('prefix')} className={inputClass} dir={dir} lang={language} value={rule.prefix} onChange={(e) => setRule(language, { prefix: e.target.value })} data-testid={tid('prefix')} />
            </div>
            <div>
              <label htmlFor={id('suffix')} className={labelClass}>{r.suffix}</label>
              <input id={id('suffix')} className={inputClass} dir={dir} lang={language} value={rule.suffix} onChange={(e) => setRule(language, { suffix: e.target.value })} data-testid={tid('suffix')} />
            </div>
          </div>
        )}

        {rule.mode === 'case' && (
          <fieldset>
            <legend className={labelClass}>{r.caseMode}</legend>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {([['upper', r.caseUpper], ['lower', r.caseLower], ['title', r.caseTitle], ['sentence', r.caseSentence]] as const).map(([mode, label]) => (
                <label key={mode} className={radioLabel}>
                  <input type="radio" name={`${idPrefix}-case-${language}`} checked={rule.caseMode === mode} onChange={() => setRule(language, { caseMode: mode })} className={radioInput} data-testid={tid(`case-${mode}`)} />
                  <span dir="ltr">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4" data-testid="rename-fields">
      <BilingualPair
        legend={r.section}
        labels={{ en: r.langEn, ar: r.langAr }}
        ticked={{ en: value.languages.includes('en'), ar: value.languages.includes('ar') }}
        onTick={toggleLanguage}
        tickTestId={(language) => `rename-lang-${language}`}
        textOf={(language) => (value.rules[language].mode === 'pattern' ? value.rules[language].pattern : '')}
        onTranslated={(language, text) => setRule(language, { mode: 'pattern', pattern: text })}
        idPrefix={`${idPrefix}-pair`}
        testId="rename-pair"
      >
        {(language) => column(language)}
      </BilingualPair>
      <p className={hintClass}>{r.languagesHint}</p>

      {usesNumbers && (
        <fieldset data-testid="rename-numbering">
          <legend className={labelClass}>{b.numberingShared}</legend>
          <p className={hintClass}>{b.numberingSharedHint}</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {([['start', r.start, -9999, 99999], ['step', r.step, -999, 999], ['pad', r.pad, 1, 9]] as const).map(([key, label, min, max]) => (
              <div key={key}>
                <label htmlFor={`${idPrefix}-${key}`} className={labelClass}>{label}</label>
                <input
                  id={`${idPrefix}-${key}`}
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
          {arabicNumbered && (
            <fieldset className="mt-3">
              <legend className={labelClass}>{r.arabicDigits}</legend>
              <div className="mt-1 flex flex-wrap gap-4">
                {([['latin', r.digitsLatin], ['arabic-indic', r.digitsArabic]] as const).map(([digits, label]) => (
                  <label key={digits} className={radioLabel}>
                    <input type="radio" name={`${idPrefix}-digits`} checked={value.arabicDigits === digits} onChange={() => set('arabicDigits', digits)} className={radioInput} data-testid={`rename-digits-${digits}`} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </fieldset>
      )}
    </div>
  );
}

export default RenameFields;
