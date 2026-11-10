'use client';

import Form from 'next/form';
import Link from 'next/link';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { fieldClass, linkClass } from '@/components/ui';
import { CONTACT_STATUSES, CONTACT_TOPICS, type ContactInboxFilters } from './filters';

/** GET form: filters live in the URL. Selects submit on change; text and dates on Apply. */
export function ContactFilterBar({ filters, active }: { filters: ContactInboxFilters; active: boolean }) {
  const { t } = useLanguage();
  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const key = JSON.stringify(filters);

  return (
    <Form action="/contact" role="search" aria-label={t('contact.filtersLabel')} className="flex flex-wrap items-end gap-3" data-testid="contact-filters" key={key}>
      <div className="flex flex-col gap-1 grow sm:grow-0">
        <label htmlFor="contact-q" className="text-sm text-fg-muted">
          {t('contact.search')}
        </label>
        <input
          id="contact-q"
          name="q"
          type="search"
          defaultValue={filters.q ?? ''}
          placeholder={t('contact.searchPlaceholder')}
          className={`${fieldClass} w-full sm:w-64`}
          data-testid="contact-search"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="contact-status" className="text-sm text-fg-muted">
          {t('contact.statusFilter')}
        </label>
        <select id="contact-status" name="status" defaultValue={filters.status ?? ''} onChange={submitOnChange} className={fieldClass} data-testid="contact-status-filter">
          <option value="">{t('contact.allStatuses')}</option>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {translateDynamic(t, 'contactStatus', s)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="contact-topic" className="text-sm text-fg-muted">
          {t('contact.topicFilter')}
        </label>
        <select id="contact-topic" name="topic" defaultValue={filters.topic ?? ''} onChange={submitOnChange} className={fieldClass}>
          <option value="">{t('contact.allTopics')}</option>
          {CONTACT_TOPICS.map((s) => (
            <option key={s} value={s}>
              {translateDynamic(t, 'contactTopic', s)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="contact-assignee" className="text-sm text-fg-muted">
          {t('contact.assigneeFilter')}
        </label>
        <select id="contact-assignee" name="assignee" defaultValue={filters.assignee ?? ''} onChange={submitOnChange} className={fieldClass}>
          <option value="">{t('contact.assigneeAny')}</option>
          <option value="me">{t('contact.assigneeMe')}</option>
          <option value="unassigned">{t('contact.assigneeNone')}</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="contact-from" className="text-sm text-fg-muted">
          {t('contact.fromFilter')}
        </label>
        <input id="contact-from" name="from" type="date" defaultValue={filters.from ?? ''} className={fieldClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="contact-to" className="text-sm text-fg-muted">
          {t('contact.toFilter')}
        </label>
        <input id="contact-to" name="to" type="date" defaultValue={filters.to ?? ''} className={fieldClass} />
      </div>
      <button
        type="submit"
        className="bg-accent hover:bg-accent-hover text-on-accent rounded px-4 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus"
        data-testid="contact-apply"
      >
        {t('contact.apply')}
      </button>
      {active && (
        <Link href="/contact" className={`${linkClass} py-2`}>
          {t('contact.clear')}
        </Link>
      )}
    </Form>
  );
}
