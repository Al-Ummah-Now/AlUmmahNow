'use client';

import Form from 'next/form';
import Link from '@/components/AppLink';
import { CLIENT_SURFACES, ERROR_STATUSES } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { fieldClass, linkClass } from '@/components/ui';
import { Autocomplete } from '@/components/search/Autocomplete';
import type { ErrorFacets } from '@/lib/api/error-groups-types';
import { errorsHref, type ErrorListFilters } from './filters';
import { DateField } from '@/components/DateField';
import { Select, type SelectChangeEvent } from '@/components/select/Select';

/** GET form: filters live in the URL. Selects submit on change; text and dates on Apply. */
export function ErrorFilterBar({ filters, facets, active }: { filters: ErrorListFilters; facets: ErrorFacets | null; active: boolean }) {
  const { t } = useLanguage();
  const submitOnChange = (e: SelectChangeEvent) => e.currentTarget.form?.requestSubmit();
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
        <Select id="errors-app" name="app" defaultValue={filters.app ?? ''} onChange={submitOnChange} className={fieldClass} data-testid="errors-app-filter">
          <option value="">{t('errorsPage.allApps')}</option>
          {apps.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-environment" className="text-sm text-fg-muted">
          {t('errorsPage.environmentFilter')}
        </label>
        <Select id="errors-environment" name="environment" defaultValue={filters.environment ?? ''} onChange={submitOnChange} className={fieldClass}>
          <option value="">{t('errorsPage.allEnvironments')}</option>
          {environments.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-release" className="text-sm text-fg-muted">
          {t('errorsPage.releaseFilter')}
        </label>
        <Select id="errors-release" name="release" defaultValue={filters.release ?? ''} onChange={submitOnChange} className={`${fieldClass} font-mono`} dir="ltr">
          <option value="">{t('errorsPage.allReleases')}</option>
          {releases.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-status" className="text-sm text-fg-muted">
          {t('errorsPage.statusFilter')}
        </label>
        <Select id="errors-status" name="status" defaultValue={filters.status ?? ''} onChange={submitOnChange} className={fieldClass} data-testid="errors-status-filter">
          <option value="">{t('errorsPage.allStatuses')}</option>
          {ERROR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {translateDynamic(t, 'errorStatus', s)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-origin" className="text-sm text-fg-muted">
          {t('errorsPage.originFilter')}
        </label>
        <select id="errors-origin" name="origin" defaultValue={filters.origin ?? ''} onChange={submitOnChange} className={fieldClass} data-testid="errors-origin-filter">
          <option value="">{t('errorsPage.allOrigins')}</option>
          {CLIENT_SURFACES.map((s) => (
            <option key={s} value={s}>
              {translateDynamic(t, 'originSurface', s)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-from" className="text-sm text-fg-muted">
          {t('errorsPage.fromFilter')}
        </label>
        <DateField id="errors-from" name="from" defaultValue={filters.from ?? ''} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-to" className="text-sm text-fg-muted">
          {t('errorsPage.toFilter')}
        </label>
        <DateField id="errors-to" name="to" defaultValue={filters.to ?? ''} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="errors-sort" className="text-sm text-fg-muted">
          {t('errorsPage.sortBy')}
        </label>
        <Select id="errors-sort" name="sort" defaultValue={filters.sort} onChange={submitOnChange} className={fieldClass} data-testid="errors-sort">
          <option value="last_seen">{t('errorsPage.sortLastSeen')}</option>
          <option value="count">{t('errorsPage.sortCount')}</option>
          <option value="users">{t('errorsPage.sortUsers')}</option>
        </Select>
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
