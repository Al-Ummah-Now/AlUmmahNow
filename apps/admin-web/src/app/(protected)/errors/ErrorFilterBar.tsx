'use client';

import Form from 'next/form';
import Link from 'next/link';
import { ERROR_STATUSES } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { fieldClass, linkClass } from '@/components/ui';
import { Autocomplete } from '@/components/search/Autocomplete';
import type { ErrorFacets } from '@/lib/api/error-groups-types';
import { errorsHref, type ErrorListFilters } from './filters';

/** GET form: filters live in the URL. Selects submit on change; text and dates on Apply. */
export function ErrorFilterBar({ filters, facets, active }: { filters: ErrorListFilters; facets: ErrorFacets | null; active: boolean }) {
  const { t } = useLanguage();
  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const key = JSON.stringify(filters);
  const apps = facets?.apps ?? [];
  const environments = facets?.environments ?? [];
  const releases = facets?.releases ?? [];

  return (
    <Form action="/errors" role="search" aria-label={t('errorsPage.filtersLabel')} className="flex flex-wrap items-end gap-3" data-testid="errors-filters" key={key}>
      {filters.needsAction && <input type="hidden" name="tab" value="needs-action" />}
      <Autocomplete
        kind="error"
        mode="search"
        name="q"
        label={t('errorsPage.search')}
        defaultValue={filters.q ?? ''}
        placeholder={t('errorsPage.searchPlaceholder')}
        className="grow sm:grow-0 sm:w-72"
        testId="errors-search"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-app" className="text-sm text-fg-muted">
          {t('errorsPage.appFilter')}
        </label>
        <select id="errors-app" name="app" defaultValue={filters.app ?? ''} onChange={submitOnChange} className={fieldClass} data-testid="errors-app-filter">
          <option value="">{t('errorsPage.allApps')}</option>
          {apps.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-environment" className="text-sm text-fg-muted">
          {t('errorsPage.environmentFilter')}
        </label>
        <select id="errors-environment" name="environment" defaultValue={filters.environment ?? ''} onChange={submitOnChange} className={fieldClass}>
          <option value="">{t('errorsPage.allEnvironments')}</option>
          {environments.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-release" className="text-sm text-fg-muted">
          {t('errorsPage.releaseFilter')}
        </label>
        <select id="errors-release" name="release" defaultValue={filters.release ?? ''} onChange={submitOnChange} className={`${fieldClass} font-mono`} dir="ltr">
          <option value="">{t('errorsPage.allReleases')}</option>
          {releases.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-status" className="text-sm text-fg-muted">
          {t('errorsPage.statusFilter')}
        </label>
        <select id="errors-status" name="status" defaultValue={filters.status ?? ''} onChange={submitOnChange} className={fieldClass} data-testid="errors-status-filter">
          <option value="">{t('errorsPage.allStatuses')}</option>
          {ERROR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {translateDynamic(t, 'errorStatus', s)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-from" className="text-sm text-fg-muted">
          {t('errorsPage.fromFilter')}
        </label>
        <input id="errors-from" name="from" type="date" defaultValue={filters.from ?? ''} className={fieldClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-to" className="text-sm text-fg-muted">
          {t('errorsPage.toFilter')}
        </label>
        <input id="errors-to" name="to" type="date" defaultValue={filters.to ?? ''} className={fieldClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-sort" className="text-sm text-fg-muted">
          {t('errorsPage.sortBy')}
        </label>
        <select id="errors-sort" name="sort" defaultValue={filters.sort} onChange={submitOnChange} className={fieldClass} data-testid="errors-sort">
          <option value="last_seen">{t('errorsPage.sortLastSeen')}</option>
          <option value="count">{t('errorsPage.sortCount')}</option>
          <option value="users">{t('errorsPage.sortUsers')}</option>
        </select>
      </div>
      <button
        type="submit"
        className="bg-accent hover:bg-accent-hover text-on-accent rounded px-4 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus"
        data-testid="errors-apply"
      >
        {t('errorsPage.apply')}
      </button>
      {active && (
        <Link href={errorsHref({ needsAction: filters.needsAction })} className={`${linkClass} py-2`}>
          {t('errorsPage.clear')}
        </Link>
      )}
    </Form>
  );
}
