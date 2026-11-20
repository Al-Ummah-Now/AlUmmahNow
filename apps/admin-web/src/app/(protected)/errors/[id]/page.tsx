import Link from '@/components/AppLink';
import { notFound } from 'next/navigation';
import { getErrorGroup } from '@/lib/api/admin';
import { AdminApiError } from '@/lib/api/errors';
import type { ErrorActivity, ErrorEvent, ErrorGroupDetail } from '@/lib/api/error-groups-types';
import { getAdminSession } from '@/lib/auth';
import { canManageErrors, canReadErrors } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, formatHour, formatNumber, hourDate, translateDynamic, type MessageKey, type Translator } from '@/i18n/translate';
import type { Locale } from '@/i18n/config';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ErrorStatusChip, HourlyChart, TestChip, errorTitle } from '../ui';
import { countryName, sourceLabel } from '../origin';
import { groupActionsFor, itemActionsFor, itemHref } from '../permissions';
import { ErrorGroupActions } from './ErrorGroupActions';
import { NeedsActionItemButtons } from './NeedsActionItemButtons';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { dateTimeFormat, normalizeRoute, pluralCategory, scrubContext, type ErrorContext, type RequestOrigin } from '@al-ummah/shared-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const GROUP_ID = /^eg_[0-9a-f]{16}$/;
const USER_ID = /^usr_[A-Za-z0-9_-]{1,64}$/;
/** Public videos site, for items that point at a video (same config as the access-denied page). */
const WEB_ORIGIN = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://alummahnow.net';
const thClass = 'text-start px-3 py-2 text-fg-muted font-medium';

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

  const { group, events, releases, activity, hourly, actions, origins } = data;
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
          value={group.assignee_id ? (group.assignee_id === viewerId ? t('errorsPage.you') : <UserName id={group.assignee_id} email={group.assignee_email} showEmail={false} />) : t('errorsPage.unassigned')}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
            <div className="overflow-x-auto">
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
                    <td className="px-3 py-2 text-fg-muted">{formatDate(r.last_seen, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>
      </div>

      {origins && <OriginBreakdown origins={origins} t={t} locale={locale} />}

      <section className={cardClass} aria-labelledby="stack-heading">
        <h2 id="stack-heading" className="text-lg font-semibold text-fg mb-1">
          {t('errorsPage.stack')}
        </h2>
        {stack ? (
          <>
            <p className="text-sm text-fg-muted mb-3">{latest?.symbolicated_stack ? t('errorsPage.stackSymbolicated') : t('errorsPage.stackRaw')}</p>
            <pre className="bg-surface-2 border border-border rounded p-4 text-xs font-mono text-fg whitespace-pre-wrap break-words [overflow-wrap:anywhere]" dir="ltr" data-testid="error-stack">
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

function Fact({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`text-fg break-words ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : 'auto'} style={mono ? { textAlign: 'start' } : undefined}>
        {value}
      </dd>
    </div>
  );
}

/** The stored context (scrubbed again here: the page renders only what passes the schema). */
function parseContext(json: string | null | undefined): ErrorContext | undefined {
  if (!json) return undefined;
  try {
    return scrubContext(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/** extra_json as key → scalar pairs (anything else dropped). */
function parseExtra(json: string | null | undefined): [string, string][] {
  if (!json) return [];
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return [];
    return Object.entries(o)
      .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v) || v === null)
      .slice(0, 12)
      .map(([k, v]) => [k, v === null ? '—' : String(v)]);
  } catch {
    return [];
  }
}

const ID_SAFE = /^[A-Za-z0-9_-]{1,64}$/;

function Sample({ event: e, t, locale, highlighted }: { event: ErrorEvent; t: Translator; locale: Locale; highlighted: boolean }) {
  const user = e.user_id && USER_ID.test(e.user_id) ? e.user_id : null;
  const ctx = parseContext(e.context_json);
  const extra = parseExtra(e.extra_json);
  const template = e.route ? normalizeRoute(e.route) : '';
  const code = (v: string) => <code dir="ltr">{v}</code>;
  const facts: [string, React.ReactNode][] = [
    [t('errorsPage.occurredAt'), formatDate(e.occurred_at, locale, true)],
    [t('errorsPage.route'), e.route ? code(`${e.method ? `${e.method} ` : ''}${e.route}`) : '—'],
  ];
  if (template && template !== e.route) facts.push([t('errorsPage.routeTemplate'), code(template)]);
  if (e.status) facts.push([t('errorsPage.statusCode'), formatNumber(e.status, locale)]);
  facts.push(
    [t('errorsPage.environment'), e.environment ? code(e.environment) : '—'],
    [t('errorsPage.worker'), ctx?.worker ? code(ctx.worker) : '—'],
    [t('errorsPage.release'), e.release ? code(e.release) : '—'],
    [t('errorsPage.workerVersion'), e.worker_version ? code(e.worker_version) : '—'],
    [t('errorsPage.requestId'), e.request_id ? code(e.request_id) : '—'],
    [
      t('errorsPage.user'),
      user ? (
        <UserName id={user} showEmail={false} testId="error-sample-user" />
      ) : (
        t('errorsPage.anonymous')
      ),
    ],
  );
  if (ctx?.videoId && ID_SAFE.test(ctx.videoId)) {
    facts.push([
      t('errorsPage.video'),
      <Link key="v" href={`/videos/${encodeURIComponent(ctx.videoId)}`} className={linkClass} dir="ltr" data-testid="error-sample-video">
        {ctx.videoId}
      </Link>,
    ]);
  }
  if (ctx?.channelId && ID_SAFE.test(ctx.channelId)) {
    facts.push([
      t('errorsPage.channel'),
      <Link key="c" href={`/channels/${encodeURIComponent(ctx.channelId)}`} className={linkClass} dir="ltr" data-testid="error-sample-channel">
        {ctx.channelId}
      </Link>,
    ]);
  }
  if (ctx?.upstream) {
    const u = ctx.upstream;
    facts.push([
      t('errorsPage.upstream'),
      <span key="u" data-testid="error-sample-upstream" className="inline-flex flex-wrap items-baseline gap-x-2">
        <code dir="ltr">{`${u.service}${u.route ? ` ${u.route}` : ''}`}</code>
        <span>{u.status !== undefined ? formatNumber(u.status, locale) : t('errorsPage.upstreamFailed')}</span>
      </span>,
    ]);
  }
  if (ctx?.job) {
    const j = ctx.job;
    facts.push([
      t('errorsPage.job'),
      <span key="j" data-testid="error-sample-job" className="inline-flex flex-wrap items-baseline gap-x-2">
        {[j.queue, j.id].filter(Boolean).map((v) => (
          <code key={v} dir="ltr">
            {v}
          </code>
        ))}
        {j.attempt !== undefined && <span>{t('errorsPage.jobAttempt', { n: j.attempt })}</span>}
      </span>,
    ]);
  }
  if (ctx?.origin) facts.push(...originFacts(ctx.origin, t, locale));
  facts.push([t('errorsPage.browser'), [e.browser, e.os].filter(Boolean).join(' • ') || '—'], [t('errorsPage.locale'), e.locale ?? '—'], [t('errorsPage.theme'), e.theme ?? '—']);
  const time = dateTimeFormat(locale, { timeStyle: 'medium', timeZone: 'UTC' });
  return (
    <li className={`border rounded p-4 ${highlighted ? 'border-accent ring-1 ring-accent' : 'border-border'}`} data-testid="error-sample" data-ref={e.ref}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="text-sm text-fg-muted">{t('errorsPage.reference')}</span>
        <code className="font-mono font-semibold text-fg" dir="ltr" data-testid="error-event-ref">{e.ref}</code>
        {e.count > 1 && (
          <span className="text-xs text-fg-subtle">{t(`errorsPage.repeated.${pluralCategory(locale, e.count)}` as MessageKey, { count: e.count })}</span>
        )}
        {e.shown === 1 && <span className="text-xs text-fg-subtle">{t('errorsPage.shownToUser')}</span>}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-fg break-words [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      {ctx?.breadcrumbs && ctx.breadcrumbs.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-fg mb-2">{t('errorsPage.breadcrumbs')}</h3>
          <ol className="space-y-1 text-xs" data-testid="error-sample-breadcrumbs">
            {ctx.breadcrumbs.map((b, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 min-w-0">
                <time dateTime={b.at} className="text-fg-subtle tabular-nums whitespace-nowrap">
                  {time.format(new Date(b.at))}
                </time>
                <span className="text-fg-muted">{b.kind}</span>
                <code dir="ltr" className="text-fg break-words [overflow-wrap:anywhere] min-w-0" style={{ textAlign: 'start' }}>
                  {b.message}
                </code>
              </li>
            ))}
          </ol>
        </div>
      )}
      {extra.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-fg mb-2">{t('errorsPage.extra')}</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs" data-testid="error-sample-extra">
            {extra.map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0">
                <dt className="text-fg-muted font-mono" dir="ltr">{k}</dt>
                <dd className="text-fg break-all font-mono" dir="ltr">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
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
        <span className="text-fg-muted">
          {a.actor_id
            ? fillNodes(t('errorsPage.by'), { actor: <UserName id={a.actor_id} email={a.actor_email} showEmail={false} /> })
            : t('errorsPage.by', { actor: a.actor_email ?? t('errorsPage.system') })}
        </span>
      </p>
      <time dateTime={a.created_at} className="text-xs text-fg-subtle">
        {formatDate(a.created_at, locale, true)}
      </time>
      {a.body && <p className="mt-1 text-sm text-fg whitespace-pre-wrap break-words" dir="auto">{a.body}</p>}
    </li>
  );
}

/** A sample's request origin as facts: app (with version), device, country, where it came from, entry page. */
function originFacts(o: RequestOrigin, t: Translator, locale: Locale): [string, React.ReactNode][] {
  const facts: [string, React.ReactNode][] = [
    [
      t('errorsPage.origin'),
      <span key="o" data-testid="error-sample-origin" data-surface={o.surface} className="inline-flex flex-wrap items-baseline gap-x-2">
        <span>{translateDynamic(t, 'originSurface', o.surface)}</span>
        {(o.app || o.appVersion) && <code dir="ltr">{[o.app, o.appVersion].filter(Boolean).join(' ')}</code>}
      </span>,
    ],
    [t('errorsPage.device'), translateDynamic(t, 'originDevice', o.device)],
  ];
  if (o.country) facts.push([t('errorsPage.country'), countryName(o.country, locale)]);
  facts.push([
    t('errorsPage.cameFrom'),
    <span key="s" data-testid="error-sample-source" className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{sourceLabel(o.source, t)}</span>
      {o.referrerHost && <code dir="ltr">{o.referrerHost}</code>}
      {o.campaign && <span>{t('errorsPage.campaign', { name: o.campaign })}</span>}
    </span>,
  ]);
  if (o.entry) facts.push([t('errorsPage.entryPage'), <code key="e" dir="ltr">{o.entry}</code>]);
  return facts;
}

/** How many of the stored samples came from each surface (web, admin, iOS…), with a share bar. */
function OriginBreakdown({ origins, t, locale }: { origins: { surface: string; samples: number }[]; t: Translator; locale: Locale }) {
  const total = origins.reduce((n, o) => n + o.samples, 0);
  return (
    <section className={cardClass} aria-labelledby="origins-heading" data-testid="error-origins">
      <h2 id="origins-heading" className="text-lg font-semibold text-fg mb-1">
        {t('errorsPage.origins')}
      </h2>
      <p className="text-sm text-fg-muted mb-4">{t('errorsPage.originsHint')}</p>
      {origins.length === 0 ? (
        <p className="text-fg-muted">{t('errorsPage.noOrigins')}</p>
      ) : (
        <ul className="space-y-3">
          {origins.map((o) => {
            const share = total > 0 ? o.samples / total : 0;
            return (
              <li key={o.surface} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm" data-surface={o.surface}>
                <Link href={`/errors?origin=${encodeURIComponent(o.surface)}`} className={`${linkClass} truncate`}>
                  {translateDynamic(t, 'originSurface', o.surface)}
                </Link>
                <span className="h-2 rounded-full bg-border overflow-hidden" aria-hidden="true">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
                </span>
                <span className="tabular-nums text-fg-muted text-end">
                  {t('errorsPage.originShare', { count: formatNumber(o.samples, locale), percent: formatNumber(Math.round(share * 100), locale) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
