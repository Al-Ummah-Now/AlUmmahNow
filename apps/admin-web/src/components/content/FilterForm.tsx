'use client';

import Form from 'next/form';
import Link from 'next/link';
import { useId } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass, linkClass } from '@/components/ui';

export type FilterField =
  | { kind: 'search'; name: string; label: string; wide?: boolean }
  | { kind: 'text'; name: string; label: string }
  | { kind: 'date'; name: string; label: string }
  | { kind: 'select'; name: string; label: string; options: { value: string; label: string }[]; allLabel?: string }
  | { kind: 'flag'; name: string; label: string; value: string };

interface Props {
  action: string;
  label: string;
  fields: FilterField[];
  values: Record<string, string>;
  testId: string;
}

/**
 * A GET form, so filters live in the URL. Selects and checkboxes submit on
 * change; text fields submit with Enter or the Apply button. Fields stack on a
 * phone and flow in a row from the small breakpoint up.
 */
export function FilterForm({ action, label, fields, values, testId }: Props) {
  const { t } = useLanguage();
  const id = useId();
  const submit = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => e.currentTarget.form?.requestSubmit();
  const active = Object.keys(values).some((k) => k !== 'page' && values[k]);
  // Re-mount the fields when the URL changes so defaultValue follows it
  const key = JSON.stringify(values);

  return (
    <Form action={action} role="search" aria-label={label} className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 mb-6" data-testid={testId} key={key}>
      {fields.map((field) => {
        const fieldId = `${id}-${field.name}`;
        if (field.kind === 'flag') {
          return (
            <label key={field.name} htmlFor={fieldId} className="flex items-center gap-2 py-2 text-sm text-fg">
              <input id={fieldId} type="checkbox" name={field.name} value={field.value} defaultChecked={values[field.name] === field.value} onChange={submit} className="h-4 w-4 accent-accent" />
              {field.label}
            </label>
          );
        }
        return (
          <div key={field.name} className={`flex flex-col gap-1 ${field.kind === 'search' && field.wide !== false ? 'sm:min-w-64 sm:flex-1' : ''}`}>
            <label htmlFor={fieldId} className="text-sm text-fg-muted">
              {field.label}
            </label>
            {field.kind === 'select' ? (
              <select id={fieldId} name={field.name} defaultValue={values[field.name] ?? ''} onChange={submit} className={fieldClass}>
                <option value="">{field.allLabel ?? t('content.all')}</option>
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={fieldId}
                name={field.name}
                type={field.kind === 'date' ? 'date' : field.kind === 'search' ? 'search' : 'text'}
                defaultValue={values[field.name] ?? ''}
                dir={field.kind === 'text' ? 'ltr' : 'auto'}
                onChange={field.kind === 'date' ? submit : undefined}
                className={fieldClass}
                maxLength={200}
              />
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="bg-accent hover:bg-accent-hover text-on-accent rounded px-4 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus"
        >
          {t('content.apply')}
        </button>
        {active && (
          <Link href={action} className={`${linkClass} py-2`}>
            {t('content.clear')}
          </Link>
        )}
      </div>
    </Form>
  );
}
