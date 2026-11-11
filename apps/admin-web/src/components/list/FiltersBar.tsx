'use client';

/**
 * A list's filters, applied as the admin changes them (no Apply round trip):
 * the search box (the shared Autocomplete, written to the URL after a pause in
 * typing; Enter applies at once), id filters picked by name, selects, flags
 * and dates. The active filters show below as chips that remove themselves.
 * The same field definitions as the server FilterForm (components/content).
 *
 * The form is keyed on the non-text filters plus `resetKey`, so a change made
 * elsewhere (a saved view, Clear) re-mounts the uncontrolled fields while the
 * box being typed in keeps its focus.
 */
import { useId } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import type { FilterField } from '@/components/content/FilterForm';
import { Autocomplete } from '@/components/search/Autocomplete';
import { fieldClass, linkClass } from '@/components/ui';
import type { ListChanges, ListValues } from '@/lib/list/params';

export type { FilterField };

interface FiltersBarProps {
  label: string;
  fields: FilterField[];
  values: ListValues;
  onChange: (changes: ListChanges) => void;
  onText: (name: string, text: string) => void;
  onClear: () => void;
  /** Bump to re-mount the fields after a change made outside the form. */
  resetKey?: number;
  testId: string;
  /** The form element (the list focuses its search box with `/`). */
  formRef?: React.Ref<HTMLFormElement>;
}

function fieldText(field: FilterField, value: string, on: string): string {
  if (field.kind === 'select') return field.options.find((o) => o.value === value)?.label ?? value;
  if (field.kind === 'flag') return on;
  return value;
}

export function FiltersBar({ label, fields, values, onChange, onText, onClear, resetKey = 0, testId, formRef }: FiltersBarProps) {
  const { t } = useLanguage();
  const id = useId();
  const textNames = new Set(fields.filter((f) => f.kind === 'search').map((f) => f.name));
  const key = `${JSON.stringify(Object.entries(values).filter(([k]) => !textNames.has(k)))}|${resetKey}`;
  const chips = fields.filter((f) => f.kind !== 'pick' && values[f.name]);
  const active = fields.some((f) => values[f.name]);

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const changes: ListChanges = {};
    for (const field of fields) {
      if (field.kind === 'search' || field.kind === 'pick') changes[field.name] = String(data.get(field.name) ?? '') || undefined;
    }
    onChange(changes);
  };

  return (
    <div className="mb-4 space-y-3">
      <form
        ref={formRef}
        key={key}
        role="search"
        aria-label={label}
        className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3"
        data-testid={testId}
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
        onInput={(e) => {
          const target = e.target as HTMLInputElement;
          if (target.name && textNames.has(target.name)) onText(target.name, target.value);
        }}
      >
        {fields.map((field) => {
          const fieldId = `${id}-${field.name}`;
          if (field.kind === 'flag') {
            return (
              <label key={field.name} htmlFor={fieldId} className="flex items-center gap-2 py-2 text-sm text-fg">
                <input
                  id={fieldId}
                  type="checkbox"
                  name={field.name}
                  value={field.value}
                  defaultChecked={values[field.name] === field.value}
                  onChange={(e) => onChange({ [field.name]: e.currentTarget.checked ? field.value : undefined })}
                  className="h-4 w-4 accent-accent"
                />
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
                <select id={fieldId} name={field.name} defaultValue={values[field.name] ?? ''} onChange={(e) => onChange({ [field.name]: e.currentTarget.value || undefined })} className={fieldClass} data-testid={`${testId}-${field.name}`}>
                  <option value="">{field.allLabel ?? t('content.all')}</option>
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input id={fieldId} name={field.name} type="date" defaultValue={values[field.name] ?? ''} onChange={(e) => onChange({ [field.name]: e.currentTarget.value || undefined })} className={fieldClass} />
              )}
            </div>
          );
        })}
      </form>
      {active && (
        <ul className="flex flex-wrap items-center gap-2" aria-label={t('list.activeFilters')} data-testid={`${testId}-chips`}>
          {chips.map((field) => {
            const text = `${field.label}: ${fieldText(field, values[field.name], t('list.on'))}`;
            return (
              <li key={field.name}>
                <button
                  type="button"
                  onClick={() => onChange({ [field.name]: undefined })}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1 text-sm text-fg hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  aria-label={t('list.removeFilter', { filter: text })}
                  data-testid="filter-chip"
                  data-filter={field.name}
                >
                  <bdi dir="auto">{text}</bdi>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={onClear} className={`${linkClass} text-sm`} data-testid={`${testId}-clear`}>
              {t('content.clear')}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
