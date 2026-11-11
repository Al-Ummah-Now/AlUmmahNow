'use client';

import Form from 'next/form';
import Link from '@/components/AppLink';
import { useId } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import type { AdminSuggestKind } from '@al-ummah/shared-types';
import { fieldClass, linkClass } from '@/components/ui';
import { Autocomplete } from '@/components/search/Autocomplete';

/**
 * search: free text, with live suggestions of `suggest` items as the admin types.
 * pick: an id filter (channel, owner, video…) chosen by name; the URL keeps the id.
 */
export type FilterField =
  | { kind: 'search'; name: string; label: string; suggest: AdminSuggestKind; wide?: boolean }
  | { kind: 'pick'; name: string; label: string; suggest: AdminSuggestKind }
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
 * change; search boxes submit with Enter or the Apply button, and an id
 * filter submits when a value is chosen. Fields stack on a
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
        if (field.kind === 'search' || field.kind === 'pick') {
          return (
            <Autocomplete
              key={field.name}
              kind={field.suggest}
              mode={field.kind}
              name={field.name}
              label={field.label}
              defaultValue={values[field.name] ?? ''}
              submitOnChange={field.kind === 'pick'}
              className={field.kind === 'search' && field.wide !== false ? 'sm:min-w-64 sm:flex-1' : 'sm:min-w-56'}
              testId={`${testId}-${field.name}`}
            />
          );
        }
        return (
          <div key={field.name} className="flex flex-col gap-1">
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
              <input id={fieldId} name={field.name} type="date" defaultValue={values[field.name] ?? ''} onChange={submit} className={fieldClass} />
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
