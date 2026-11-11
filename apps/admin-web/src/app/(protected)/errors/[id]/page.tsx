import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getErrorGroup } from '@/lib/api/admin';
import { AdminApiError } from '@/lib/api/errors';
import type { ErrorActivity, ErrorEvent, ErrorGroupDetail } from '@/lib/api/error-groups-types';
import { getAdminSession } from '@/lib/auth';
import { canManageErrors, canReadErrors } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, formatHour, formatNumber, hourDate, translateDynamic, type Translator } from '@/i18n/translate';
import type { Locale } from '@/i18n/config';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ErrorStatusChip, HourlyChart, TestChip, errorTitle } from '../ui';
import { groupActionsFor, itemActionsFor, itemHref } from '../permissions';
import { ErrorGroupActions } from './ErrorGroupActions';
import { NeedsActionItemButtons } from './NeedsActionItemButtons';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const GROUP_ID = /^eg_[0-9a-f]{16}$/;
const USER_ID = /^usr_[A-Za-z0-9_-]{1,64}$/;
/** Public videos site, for items that point at a video (same config as the access-denied page). */
const WEB_ORIGIN = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://alummahnow.net';
const thClass = 'text-start px-3 py-2 text-fg-muted font-medium whitespace-nowrap';

export default async function ErrorGroupPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const highlight = (await searchParams).ref;
  const { t, locale } = await getI18n();
  const session = await getAdminSession();

  if (!canReadErrors(session?.user.role)) {
    return <ErrorAlert testId="errors-no-access">{t('errorsPage.noAccess')}</ErrorAlert>;
  }
  if (!GROUP_ID.test(id)) notFound();

  let data: ErrorGroupDetail | null = null;
  let missing = false;
  try {
    data = await getErrorGroup(id);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) missing = true;
    else logger.error('[errors] Failed to load group', { id, error: e instanceof Error ? e.message : String(e) });
  }

  const back = (
    <Link href="/errors" className={`${linkClass} inline-block mb-4`}>
      <span aria-hidden="true" className="rtl:hidden">← </span>
      <span aria-hidden="true" className="ltr:hidden">→ </span>
      {t('errorsPage.back')}
    </Link>
  );
  if (missing) return <div>{back}<ErrorAlert testId="error-group-missing">{t('errorsPage.notFound')}</ErrorAlert></div>;
  if (!data) return <div>{back}<ErrorAlert testId="error-group-error">{t('errorsPage.loadFailed')}</ErrorAlert></div>;

  const { group, events, releases, activity, hourly, actions } = data;
  const viewerId = session?.user.id;
  const role = session?.user.role;
  const groupActions = groupActionsFor(role, group, viewerId);
  const latest = events[0];
  const stack = latest?.symbolicated_stack || latest?.stack || null;

  return (
    <div className="space-y-6" data-testid="error-group" data-group-id={group.id} data-status={group.status}>
      <div>
        {back}
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="text-2xl font-bold text-fg break-words min-w-0 flex-1" dir="ltr" style={{ textAlign: 'start' }} data-testid="error-group-message">
            {errorTitle(group)}
          </h1>
          <ErrorStatusChip status={group.status} label={translateDynamic(t, 'errorStatus', group.status)} testId="error-status" />
          {!!group.test && <TestChip label={t('errorsPage.test')} />}
        </div>
        {group.culprit && (
          <p className="mt-2 text-sm text-fg-muted">
            {t('errorsPage.culprit')}: <code className="font-mono text-fg" dir="ltr">{group.culprit}</code>
          </p>
        )}
      </div>

      <dl className={`${cardClass} grid grid-cols-2 md:grid-cols-4 gap-4 text-sm`}>
        <Fact label={t('errorsPage.app')} value={group.app} mono />
        <Fact label={t('errorsPage.environment')} value={group.environment} mono />
        <Fact label={t('errorsPage.occurrences')} value={formatNumber(group.occurrences, locale)} />
        <Fact label={t('errorsPage.usersAffected')} value={formatNumber(group.users, locale)} />
        <Fact label={t('errorsPage.firstSeen')} value={formatDate(group.first_seen, locale, true)} />
        <Fact label={t('errorsPage.lastSeen')} value={formatDate(group.last_seen, locale, true)} />
        <Fact label={t('errorsPage.firstRelease')} value={group.first_release ?? '—'} mono />
        <Fact label={t('errorsPage.lastRelease')} value={group.last_release ?? '—'} mono />
        {group.route && <Fact label={t('errorsPage.route')} value={group.route} mono />}
        {group.resolved_release && <Fact label={t('errorsPage.resolvedIn')} value={group.resolved_release} mono />}
        <Fact
          label={t('errorsPage.assignee')}
          value={group.assignee_id ? (group.assignee_id === viewerId ? t('errorsPage.you') : group.assignee_email ?? group.assignee_id) : t('errorsPage.unassigned')}
        />
      </dl>

      {groupActions.length > 0 ? (
        <ErrorGroupActions id={group.id} actions={groupActions} testRef={group.test && canManageErrors(role) ? latest?.ref ?? null : null} />
      ) : (
        <p className="text-sm text-fg-muted" data-testid="errors-read-only">
          {t('errorsPage.readOnly')}
        </p>
      )}

      <section className={cardClass} aria-labelledby="needs-action-heading" data-testid="error-items">
        <h2 id="needs-action-heading" className="text-lg font-semibold text-fg mb-4">
          {t('errorsPage.needsAction')}
        </h2>
        {actions.length === 0 ? (
          <p className="text-fg-muted">{t('errorsPage.noItems')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {actions.map((item) => {
              const href = itemHref(item, WEB_ORIGIN, locale);
              const buttons = itemActionsFor(role, item);
              return (
                <li key={item.id} className="py-4 first:pt-0 last:pb-0" data-testid="error-item" data-item-id={item.id} data-status={item.status}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-fg" dir="auto">{item.title}</p>
                      {item.detail && <p className="text-sm text-fg-muted mt-1 break-words" dir="auto">{item.detail}</p>}
                    </div>
                    <ErrorStatusChip status={item.status} label={translateDynamic(t, 'itemStatus', item.status)} testId="error-item-status" />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <Fact label={t('errorsPage.itemSource')} value={translateDynamic(t, 'itemSource', item.source)} />
                    <Fact label={t('errorsPage.itemAttempts')} value={formatNumber(item.attempts, locale)} />
                    <Fact label={t('errorsPage.itemLastResult')} value={item.last_attempt_result ?? '—'} />
                    <Fact label={t('errorsPage.lastSeen')} value={formatDate(item.updated_at, locale, true)} />
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {href && (
                      <a href={href} className={linkClass} data-testid="error-item-link" {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                        {t('errorsPage.openItem')}
                      </a>
                    )}
                    {buttons.length > 0 && <NeedsActionItemButtons id={item.id} actions={buttons} retryLabel={item.retry_label} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`} aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className="text-lg font-semibold text-fg mb-4">
            {t('errorsPage.timeline')}
          </h2>
          <HourlyChart
            hours={hourly}
            label={t('errorsPage.timeline')}
            barTitle={(h) => t('errorsPage.timelineHour', { hour: formatDate(hourDate(h.hour), locale, true), count: formatNumber(h.occurrences, locale) })}
            locale={locale}
            hourLabel={(hour) => formatHour(hour, locale)}
            tableLabel={t('errorsPage.timelineTable')}
            hourHeading={t('errorsPage.timelineHourHeading')}
            countHeading={t('errorsPage.colOccurrences')}
            emptyText={t('errorsPage.timelineEmpty')}
          />
        </section>
        <section className={cardClass} aria-labelledby="releases-heading">
          <h2 id="releases-heading" className="text-lg font-semibold text-fg mb-4">
            {t('errorsPage.releases')}
          </h2>
          {releases.length === 0 ? (
            <p className="text-fg-muted">{t('errorsPage.noReleases')}</p>
          ) : (
            <table className="w-full text-sm" data-testid="error-releases">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>{t('errorsPage.colReleaseName')}</th>
                  <th scope="col" className={`${thClass} text-end`}>{t('errorsPage.colOccurrences')}</th>
                  <th scope="col" className={thClass}>{t('errorsPage.colLastSeen')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {releases.map((r) => (
                  <tr key={r.release}>
                    <td className="px-3 py-2 font-mono" dir="ltr">{r.release}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.occurrences, locale)}</td>
                    <td className="px-3 py-2 text-fg-muted whitespace-nowrap">{formatDate(r.last_seen, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className={cardClass} aria-labelledby="stack-heading">
        <h2 id="stack-heading" className="text-lg font-semibold text-fg mb-1">
          {t('errorsPage.stack')}
        </h2>
        {stack ? (
          <>
            <p className="text-sm text-fg-muted mb-3">{latest?.symbolicated_stack ? t('errorsPage.stackSymbolicated') : t('errorsPage.stackRaw')}</p>
            <pre className="bg-surface-2 border border-border rounded p-4 text-xs overflow-x-auto font-mono text-fg" dir="ltr" data-testid="error-stack">
              {stack}
            </pre>
          </>
        ) : (
          <p className="text-fg-muted">{t('errorsPage.noStack')}</p>
        )}
      </section>

      <section className={cardClass} aria-labelledby="samples-heading">
        <h2 id="samples-heading" className="text-lg font-semibold text-fg mb-4">
          {t('errorsPage.samples')}
        </h2>
        {events.length === 0 ? (
          <p className="text-fg-muted">{t('errorsPage.noSamples')}</p>
        ) : (
          <ul className="space-y-4" data-testid="error-samples">
            {events.map((e) => (
              <Sample key={e.id} event={e} t={t} locale={locale} highlighted={e.ref === highlight} />
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass} aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="text-lg font-semibold text-fg mb-4">
          {t('errorsPage.activity')}
        </h2>
        {activity.length === 0 ? (
          <p className="text-fg-muted">{t('errorsPage.noActivity')}</p>
        ) : (
          <ol className="border-s border-border ms-2 space-y-4" data-testid="error-activity">
            {activity.map((a) => (
              <ActivityEntry key={a.id} entry={a} t={t} locale={locale} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`text-fg break-words ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : 'auto'} style={mono ? { textAlign: 'start' } : undefined}>
        {value}
      </dd>
    </div>
  );
}

function Sample({ event: e, t, locale, highlighted }: { event: ErrorEvent; t: Translator; locale: Locale; highlighted: boolean }) {
  const user = e.user_id && USER_ID.test(e.user_id) ? e.user_id : null;
  const facts: [string, React.ReactNode][] = [
    [t('errorsPage.occurredAt'), formatDate(e.occurred_at, locale, true)],
    [t('errorsPage.route'), e.route ? <code dir="ltr">{e.method ? `${e.method} ` : ''}{e.route}</code> : '—'],
    [t('errorsPage.browser'), [e.browser, e.os].filter(Boolean).join(' · ') || '—'],
    [t('errorsPage.release'), e.release ? <code dir="ltr">{e.release}</code> : '—'],
    [t('errorsPage.workerVersion'), e.worker_version ? <code dir="ltr">{e.worker_version}</code> : '—'],
    [t('errorsPage.requestId'), e.request_id ? <code dir="ltr">{e.request_id}</code> : '—'],
    [t('errorsPage.locale'), e.locale ?? '—'],
    [t('errorsPage.theme'), e.theme ?? '—'],
    [
      t('errorsPage.user'),
      user ? (
        <Link href={`/users/${encodeURIComponent(user)}`} className={linkClass} dir="ltr" data-testid="error-sample-user">
          {user}
        </Link>
      ) : (
        t('errorsPage.anonymous')
      ),
    ],
  ];
  if (e.status) facts.push([t('errorsPage.statusCode'), String(e.status)]);
  return (
    <li className={`border rounded p-4 ${highlighted ? 'border-accent ring-1 ring-accent' : 'border-border'}`} data-testid="error-sample" data-ref={e.ref}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="text-sm text-fg-muted">{t('errorsPage.reference')}</span>
        <code className="font-mono font-semibold text-fg" dir="ltr" data-testid="error-event-ref">{e.ref}</code>
        {e.count > 1 && <span className="text-xs text-fg-subtle">{t('errorsPage.repeated', { count: e.count })}</span>}
        {e.shown === 1 && <span className="text-xs text-fg-subtle">{t('errorsPage.shownToUser')}</span>}
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-fg break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function ActivityEntry({ entry: a, t, locale }: { entry: ErrorActivity; t: Translator; locale: Locale }) {
  const title =
    a.kind === 'status'
      ? t('errorActivity.status', { from: translateDynamic(t, 'errorStatus', a.from_status ?? ''), to: translateDynamic(t, 'errorStatus', a.to_status ?? '') })
      : translateDynamic(t, 'errorActivity', a.kind);
  return (
    <li className="ps-4 relative" data-testid="error-activity-entry" data-kind={a.kind}>
      <span aria-hidden="true" className="absolute -start-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
      <p className="text-sm text-fg">
        <span className="font-medium">{title}</span>{' '}
        <span className="text-fg-muted">{t('errorsPage.by', { actor: a.actor_email ?? a.actor_id ?? t('errorsPage.system') })}</span>
      </p>
      <time dateTime={a.created_at} className="text-xs text-fg-subtle">
        {formatDate(a.created_at, locale, true)}
      </time>
      {a.body && <p className="mt-1 text-sm text-fg whitespace-pre-wrap break-words" dir="auto">{a.body}</p>}
    </li>
  );
}
