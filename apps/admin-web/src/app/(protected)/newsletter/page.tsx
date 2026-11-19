import Link from '@/components/AppLink';
import { MissingLanguageBadge } from '@/components/localized/LocalizedFieldPair';
import { getAdminSession } from '@/lib/auth';
import { canManageNewsletter } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { AdminApiError } from '@/lib/api/errors';
import { getNewsletterIssue, listNewsletterIssues, listNewsletterSubscribers } from '@/lib/api/newsletter';
import type { IssueList, NewsletterIssue, SubscriberCounts, SubscriberList, SubscriberStatus } from '@/lib/api/newsletter-types';
import { EraseSubscriberButton, IssueEditor } from './NewsletterAdmin';
import { numberFormat } from '@al-ummah/shared-types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const STATUSES: SubscriberStatus[] = ['confirmed', 'pending', 'unsubscribed'];
const ISSUE_TONE: Record<string, string> = { draft: 'text-fg-muted', sending: 'text-warning-fg', sent: 'text-success-fg' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const pageOf = (v: string) => Math.max(1, Math.floor(Number(v)) || 1);

/**
 * Newsletter (AlUmmahNowUI#6): people sign up on www (double opt-in, unsubscribe in every email);
 * admins write issues here in English and Arabic and send them to every confirmed subscriber,
 * through the mail queue (retries; failures show on the Errors page with Retry).
 */
export default async function NewsletterPage({ searchParams }: PageProps) {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canManageNewsletter(session?.user.role)) return <ErrorAlert testId="newsletter-no-access">{t('newsletter.noAccess')}</ErrorAlert>;

  const params = await searchParams;
  const tab = one(params.tab) === 'subscribers' ? 'subscribers' : 'issues';
  const issueId = one(params.issue);
  const page = pageOf(one(params.page));
  const status = STATUSES.includes(one(params.status) as SubscriberStatus) ? (one(params.status) as SubscriberStatus) : undefined;
  const q = one(params.q).trim().slice(0, 200);

  let issues: IssueList | null = null;
  let issue: (NewsletterIssue & { subscribers: SubscriberCounts }) | null = null;
  let subscribers: SubscriberList | null = null;
  let loadError = '';
  try {
    if (tab === 'subscribers') subscribers = await listNewsletterSubscribers({ status, q: q || undefined, page, pageSize: PAGE_SIZE });
    else if (issueId) issue = await getNewsletterIssue(issueId);
    else issues = await listNewsletterIssues(page, PAGE_SIZE);
  } catch (error) {
    logger.error('[newsletter] Failed to load', { tab, error: error instanceof Error ? error.message : String(error) });
    loadError = error instanceof AdminApiError && error.status === 404 ? t('newsletter.notFound') : t('newsletter.loadFailed');
  }
  const counts = issues?.subscribers ?? issue?.subscribers ?? subscribers?.counts ?? null;
  const number = (n: number) => numberFormat(locale).format(n);
  const subjectOf = (i: NewsletterIssue) => (locale === 'ar' ? i.subject_ar || i.subject_en : i.subject_en || i.subject_ar) || t('newsletter.untitled');
  const tabLink = (id: 'issues' | 'subscribers') => (
    <Link
      href={id === 'issues' ? '/newsletter' : '/newsletter?tab=subscribers'}
      aria-current={tab === id ? 'page' : undefined}
      className={`px-4 py-2 rounded-t border-b-2 ${tab === id ? 'border-accent text-fg font-semibold' : 'border-transparent text-fg-muted hover:text-fg'}`}
      data-testid={`newsletter-tab-${id}`}
    >
      {t(`newsletter.tabs.${id}`)}
    </Link>
  );
  const pager = (total: number, base: string) => {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages <= 1) return null;
    const href = (p: number) => `${base}${base.includes('?') ? '&' : '?'}page=${p}`;
    return (
      <nav aria-label={t('newsletter.pages')} className="flex items-center gap-4 mt-4 text-sm">
        {page > 1 ? <Link className={linkClass} href={href(page - 1)} rel="prev">{t('newsletter.prev')}</Link> : null}
        <span className="text-fg-muted">{t('newsletter.pageOf', { page: number(page), pages: number(pages) })}</span>
        {page < pages ? <Link className={linkClass} href={href(page + 1)} rel="next">{t('newsletter.next')}</Link> : null}
      </nav>
    );
  };

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('newsletter.title')}</h1>
        <p className="text-fg-muted mt-1">{t('newsletter.subtitle')}</p>
      </div>

      {counts && (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-6" data-testid="newsletter-counts">
          {STATUSES.map((s) => (
            <div key={s} className={`${cardClass} !p-4`} data-status={s}>
              <dt className="text-sm text-fg-muted">{t(`newsletter.statuses.${s}`)}</dt>
              <dd className="text-2xl font-semibold text-fg tabular-nums">{number(counts[s])}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex gap-1 border-b border-border mb-6" data-testid="newsletter-tabs">
        {tabLink('issues')}
        {tabLink('subscribers')}
      </div>

      {loadError && <ErrorAlert testId="newsletter-load-error">{loadError}</ErrorAlert>}

      {tab === 'issues' && !issueId && issues && (
        <>
          <IssueEditor issue={null} confirmed={issues.subscribers.confirmed} />
          <section aria-labelledby="newsletter-issues-title" data-testid="newsletter-issues">
            <h2 id="newsletter-issues-title" className="text-xl font-semibold text-fg mb-3">{t('newsletter.issuesTitle')}</h2>
            {issues.items.length === 0 ? (
              <p className="text-fg-muted" data-testid="newsletter-issues-empty">{t('newsletter.issuesEmpty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('newsletter.issuesTitle')}</caption>
                  <thead>
                    <tr className="text-fg-muted">
                      <th scope="col" className="p-2 text-start font-medium">{t('newsletter.cols.subject')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('newsletter.cols.status')}</th>
                      <th scope="col" className="p-2 text-end font-medium">{t('newsletter.cols.delivered')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('newsletter.cols.updated')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.items.map((i) => (
                      <tr key={i.id} className="border-t border-border" data-testid="newsletter-issue-row" data-status={i.status}>
                        <th scope="row" className="p-2 text-start font-normal">
                          <Link className={linkClass} href={`/newsletter?issue=${encodeURIComponent(i.id)}`}>{subjectOf(i)}</Link>{' '}
                          <MissingLanguageBadge pairs={[{ en: i.subject_en, ar: i.subject_ar }, { en: i.body_en, ar: i.body_ar }]} />
                        </th>
                        <td className={`p-2 font-medium ${ISSUE_TONE[i.status]}`}>{t(`newsletter.issueStatuses.${i.status}` as MessageKey)}</td>
                        <td className="p-2 text-end tabular-nums text-fg-muted">{i.status === 'draft' ? '—' : number(i.counts.sent + i.counts.sunk)}</td>
                        <td className="p-2 whitespace-nowrap text-fg-muted">{formatDate(i.finished_at ?? i.send_started_at ?? i.updated_at, locale, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pager(issues.total, '/newsletter')}
          </section>
        </>
      )}

      {tab === 'issues' && issue && (
        <>
          <p className="mb-4"><Link className={linkClass} href="/newsletter" data-testid="newsletter-back">{t('newsletter.back')}</Link></p>
          {issue.status === 'draft' ? (
            <IssueEditor issue={issue} confirmed={issue.subscribers.confirmed} />
          ) : (
            <section className={`${cardClass} mb-6`} aria-labelledby="newsletter-issue-title" data-testid="newsletter-issue" data-status={issue.status}>
              <h2 id="newsletter-issue-title" className="text-lg font-semibold text-fg mb-1">{subjectOf(issue)}</h2>
              <p className={`text-sm font-medium mb-4 ${ISSUE_TONE[issue.status]}`} data-testid="newsletter-issue-status">
                {t(`newsletter.issueStatuses.${issue.status}` as MessageKey)}
                {issue.send_started_at ? ` · ${formatDate(issue.send_started_at, locale, true)}` : ''}
              </p>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5 mb-4" data-testid="newsletter-delivery">
                {(['sent', 'queued', 'failed', 'skipped', 'sunk'] as const).map((k) => (
                  <div key={k} data-delivery={k}>
                    <dt className="text-sm text-fg-muted">{t(`newsletter.delivery.${k}`)}</dt>
                    <dd className={`text-xl font-semibold tabular-nums ${k === 'failed' && issue.counts.failed ? 'text-danger-fg' : 'text-fg'}`}>{number(issue.counts[k])}</dd>
                  </div>
                ))}
              </dl>
              {issue.counts.failed > 0 && (
                <p className="text-sm text-fg-muted mb-4">
                  {t('newsletter.failedHint')} <Link className={linkClass} href="/errors">{t('newsletter.openErrors')}</Link>
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(['en', 'ar'] as const).map((l) => (
                  <article key={l} lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'} className="border border-border rounded p-4" data-testid={`newsletter-issue-${l}`}>
                    <h3 className="font-semibold text-fg mb-2">{l === 'ar' ? issue.subject_ar : issue.subject_en}</h3>
                    <p className="whitespace-pre-wrap text-fg break-words">{l === 'ar' ? issue.body_ar : issue.body_en}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {tab === 'subscribers' && subscribers && (
        <section aria-labelledby="newsletter-subscribers-title" data-testid="newsletter-subscribers">
          <h2 id="newsletter-subscribers-title" className="sr-only">{t('newsletter.tabs.subscribers')}</h2>
          <form method="get" action="/newsletter" className="flex flex-wrap items-end gap-3 mb-4" role="search" aria-label={t('newsletter.filters')}>
            <input type="hidden" name="tab" value="subscribers" />
            <div>
              <label htmlFor="newsletter-q" className="block text-sm font-medium text-fg mb-1">{t('newsletter.search')}</label>
              <input id="newsletter-q" name="q" type="search" defaultValue={q} className={fieldClass} dir="ltr" data-testid="newsletter-q" />
            </div>
            <div>
              <label htmlFor="newsletter-status" className="block text-sm font-medium text-fg mb-1">{t('newsletter.cols.status')}</label>
              <select id="newsletter-status" name="status" defaultValue={status ?? ''} className={fieldClass} data-testid="newsletter-status">
                <option value="">{t('newsletter.allStatuses')}</option>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`newsletter.statuses.${s}`)}</option>)}
              </select>
            </div>
            <button type="submit" className={`${secondaryButtonClass} !py-2`}>{t('newsletter.apply')}</button>
          </form>
          {subscribers.items.length === 0 ? (
            <p className="text-fg-muted" data-testid="newsletter-subscribers-empty">{q || status ? t('newsletter.subscribersNoMatch') : t('newsletter.subscribersEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('newsletter.tabs.subscribers')}</caption>
                <thead>
                  <tr className="text-fg-muted">
                    <th scope="col" className="p-2 text-start font-medium">{t('newsletter.cols.email')}</th>
                    <th scope="col" className="p-2 text-start font-medium">{t('newsletter.cols.language')}</th>
                    <th scope="col" className="p-2 text-start font-medium">{t('newsletter.cols.status')}</th>
                    <th scope="col" className="p-2 text-start font-medium">{t('newsletter.cols.confirmEmail')}</th>
                    <th scope="col" className="p-2 text-start font-medium">{t('newsletter.cols.signedUp')}</th>
                    <th scope="col" className="p-2 text-start font-medium"><span className="sr-only">{t('newsletter.cols.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.items.map((s) => (
                    <tr key={s.id} className="border-t border-border" data-testid="newsletter-subscriber-row" data-status={s.status}>
                      <th scope="row" className="p-2 text-start font-normal text-fg break-all" dir="ltr">{s.email}</th>
                      <td className="p-2 text-fg-muted">{t(`newsletter.languages.${s.locale}`)}</td>
                      <td className="p-2 text-fg">{t(`newsletter.statuses.${s.status}`)}</td>
                      <td className={`p-2 ${s.confirm_status === 'failed' ? 'text-danger-fg' : 'text-fg-muted'}`} title={s.confirm_error ?? undefined}>
                        {s.confirm_status ? t(`newsletter.confirmStatuses.${s.confirm_status}` as MessageKey) : '—'}
                      </td>
                      <td className="p-2 whitespace-nowrap text-fg-muted">{formatDate(s.created_at, locale)}</td>
                      <td className="p-2 text-end"><EraseSubscriberButton id={s.id} email={s.email} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pager(subscribers.total, `/newsletter?tab=subscribers${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`)}
        </section>
      )}
    </div>
  );
}
