'use client';

import Form from 'next/form';
import Link from 'next/link';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { fieldClass, linkClass } from '@/components/ui';
import { ENTITY_TYPES, REPORT_STATUSES } from './filters';

interface FilterBarProps {
  status?: string;
  entityType?: string;
}

/**
 * GET form so filters live in the URL (shareable, back-button friendly).
 * Selects submit on change; the Apply button covers keyboard users who
 * prefer to set both filters first.
 */
export function FilterBar({ status, entityType }: FilterBarProps) {
  const { t } = useLanguage();

  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.currentTarget.form?.requestSubmit();
  };

  return (
    <Form
      action="/moderation"
      role="search"
      aria-label={t('moderation.filtersLabel')}
      className="flex flex-wrap items-end gap-3"
      data-testid="moderation-filters"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-status" className="text-sm text-fg-muted">
          {t('moderation.statusFilter')}
        </label>
        <select
          id="filter-status"
          name="status"
          defaultValue={status ?? ''}
          onChange={submitOnChange}
          className={fieldClass}
          key={`status-${status ?? ''}`}
        >
          <option value="">{t('moderation.allStatuses')}</option>
          {REPORT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {translateDynamic(t, 'status', value)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-type" className="text-sm text-fg-muted">
          {t('moderation.typeFilter')}
        </label>
        <select
          id="filter-type"
          name="entity_type"
          defaultValue={entityType ?? ''}
          onChange={submitOnChange}
          className={fieldClass}
          key={`type-${entityType ?? ''}`}
        >
          <option value="">{t('moderation.allTypes')}</option>
          {ENTITY_TYPES.map((value) => (
            <option key={value} value={value}>
              {translateDynamic(t, 'entityType', value)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="bg-accent hover:bg-accent-hover text-on-accent rounded px-4 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus"
      >
        {t('moderation.applyFilters')}
      </button>
      {(status || entityType) && (
        <Link href="/moderation" className={`${linkClass} py-2`}>
          {t('moderation.clearFilters')}
        </Link>
      )}
    </Form>
  );
}
