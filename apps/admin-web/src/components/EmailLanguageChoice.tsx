'use client';
/**
 * "Email language" next to a Send button: every email is ONE language, chosen
 * when the admin sends it (invite, invite resend, contact reply). Default: the
 * recipient's known language if any, else the admin UI's language (the caller
 * passes it as `value`). The options are in their own language, so an admin
 * can always find them.
 */
import { useId } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';

export type EmailLanguage = 'en' | 'ar';

const OPTIONS: Array<{ value: EmailLanguage; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

export function EmailLanguageChoice({ value, onChange, disabled, testId = 'email-language' }: { value: EmailLanguage; onChange: (next: EmailLanguage) => void; disabled?: boolean; testId?: string }) {
  const { t } = useLanguage();
  const name = useId();
  return (
    <fieldset className="inline-flex items-center gap-2" disabled={disabled} data-testid={testId}>
      <legend className="sr-only">{t('emailLanguage.legend')}</legend>
      <span aria-hidden="true" className="text-sm text-fg-muted">
        {t('emailLanguage.legend')}
      </span>
      <span className="inline-flex rounded-md border border-border overflow-hidden">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            lang={option.value}
            dir={option.value === 'ar' ? 'rtl' : 'ltr'}
            className={`cursor-pointer px-3 py-1.5 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] ${
              value === option.value ? 'bg-accent text-on-accent font-semibold' : 'bg-surface text-fg hover:bg-surface-hover'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
              data-testid={`${testId}-${option.value}`}
            />
            {option.label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}
