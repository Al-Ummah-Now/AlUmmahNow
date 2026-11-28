import Link from '@/components/AppLink';
import { LocalHour, LocalTime, LocalZoneName } from '@/components/LocalTime';
import { notFound } from 'next/navigation';
import { getErrorGroup } from '@/lib/api/admin';
import { AdminApiError } from '@/lib/api/errors';
import type { ErrorActivity, ErrorEvent, ErrorGroupDetail } from '@/lib/api/error-groups-types';
import { getAdminSession } from '@/lib/auth';
import { canManageErrors, canManageMedia, canReadErrors } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatNumber, hourDate, translateDynamic, type MessageKey, type Translator } from '@/i18n/translate';
import { pageStart, type Locale } from '@/i18n/config';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { BackLink } from '@/components/content/parts';
import { logger } from '@/lib/logger';
import { videoFailuresById } from '@/lib/api/failures';
import { causedByFile, failureIds } from '@/lib/video-failure';
import { FailureWhy } from '@/components/content/failure';
import { ErrorStatusChip, HourlyChart, TestChip, appName, environmentName, errorTitle, errorType, localizedQafError, languageName, platformName } from '../ui';
import { countryName, sourceLabel } from '../origin';
import { groupActionsFor, itemActionsFor, itemHref } from '../permissions';
import { ErrorGroupActions } from './ErrorGroupActions';
import { NeedsActionItemButtons } from './NeedsActionItemButtons';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { normalizeRoute, pluralCategory, scrubContext, type ErrorContext, type RequestOrigin } from '@al-ummah/shared-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const GROUP_ID = /^eg_[0-9a-f]{16}$/;
const USER_ID = /^usr_[A-Za-z0-9_-]{1,64}$/;
/** Public videos site, for items that point at a video (same config as the access-denied page). */
const WEB_ORIGIN = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://alummahnow.net';

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

  const back = <BackLink href="/errors" label={t('errorsPage.back')} />;
  if (missing) return <div>{back}<ErrorAlert testId="error-group-missing">{t('errorsPage.notFound')}</ErrorAlert></div>;
  if (!data) return <div>{back}<ErrorAlert testId="error-group-error">{t('errorsPage.loadFailed')}</ErrorAlert></div>;

  const { group, events, releases, activity, hourly, actions, origins } = data;
  const viewerId = session?.user.id;
  const role = session?.user.role;
  const groupActions = groupActionsFor(role, group, viewerId);
  // Videos that failed: the same reason and what to do as on every other page
  const failures = canManageMedia(role) ? await videoFailuresById(failureIds(actions.map((a) => ({ id: a.item_id ?? '', failed: a.item_type === 'video' && a.source === 'processing' && !!a.item_id && a.status === 'open' })))) : {};
  const latest = events[0];
  const stack = latest?.symbolicated_stack || latest?.stack || null;
  const start = pageStart(locale);

  return (
    <div className="space-y-6" data-testid="error-group" data-group-id={group.id} data-status={group.status}>
      <div>
        {back}
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="text-2xl font-bold text-fg break-words min-w-0 flex-1 [text-wrap:balance]" dir="auto" style={{ textAlign: start }} data-testid="error-group-message">
            {localizedQafError(t, errorTitle(group))}
          </h1>
          <ErrorStatusChip status={group.status} label={translateDynamic(t, 'errorStatus', group.status)} testId="error-status" />
          {!!group.test && <TestChip label={t('errorsPage.test')} />}
        </div>
        {group.culprit && (
          <p className="mt-2 text-sm text-fg-muted">
            {t('errorsPage.culprit')}: <code className="font-mono text-fg" dir="ltr">{group.culprit}</code>
          </p>
        )}
        {errorType(group) && (
          <p className="mt-1 text-sm text-fg-muted" data-testid="error-group-type">
            {t('errorsPage.errorType')}: <code className="font-mono text-fg" dir="ltr">{errorType(group)}</code>
          </p>
        )}
      </div>

      <dl className={`${cardClass} grid grid-cols-2 md:grid-cols-4 gap-4 text-sm`}>
        <Fact align={start} label={t('errorsPage.app')} value={appName(t, group.app)} />
        <Fact align={start} label={t('errorsPage.environment')} value={environmentName(t, group.environment)} />
        <Fact align={start} label={t('errorsPage.occurrences')} value={formatNumber(group.occurrences, locale)} />
        <Fact align={start} label={t('errorsPage.usersAffected')} value={formatNumber(group.users, locale)} />
        <Fact align={start} label={t('errorsPage.firstSeen')} value={<LocalTime value={group.first_seen} withTime />} />
        <Fact align={start} label={t('errorsPage.lastSeen')} value={<LocalTime value={group.last_seen} withTime />} />
        <Fact align={start} label={t('errorsPage.firstRelease')} value={group.first_release ?? '—'} mono />
        <Fact align={start} label={t('errorsPage.lastRelease')} value={group.last_release ?? '—'} mono />
        {group.route && <Fact align={start} label={t('errorsPage.route')} value={group.route} mono />}
        {group.resolved_release && <Fact align={start} label={t('errorsPage.resolvedIn')} value={group.resolved_release} mono />}
        <Fact
          align={start}
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
              const failure = item.item_id ? failures[item.item_id] : undefined;
              // The same file fails again: Retry is not offered
              const buttons = itemActionsFor(role, item).filter((b) => b !== 'retry' || !causedByFile(failure));
              return (
                <li key={item.id} className="py-4 first:pt-0 last:pb-0" data-testid="error-item" data-item-id={item.id} data-status={item.status}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-fg" dir="auto" style={failure ? { textAlign: start } : undefined}>{failure?.title ?? localizedQafError(t, item.title)}</p>
                      {failure ? (
                        <>
                          <FailureWhy failure={failure} t={t} className="mt-1" />
                          {/* The stored (English) words of the report, for a search in the logs */}
                          {item.detail && <p className="mt-1 text-xs text-fg-muted break-words" style={{ textAlign: start }}><bdi dir="ltr">{item.detail}</bdi></p>}
                        </>
                      ) : (
                        item.detail && <p className="text-sm text-fg-muted mt-1 break-words" dir="auto">{localizedQafError(t, item.detail)}</p>
                      )}
                    </div>
                    <ErrorStatusChip status={item.status} label={translateDynamic(t, 'itemStatus', item.status)} testId="error-item-status" />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <Fact align={start} label={t('errorsPage.itemSource')} value={translateDynamic(t, 'itemSource', item.source)} />
                    <Fact align={start} label={t('errorsPage.itemAttempts')} value={formatNumber(item.attempts, locale)} />
                    <Fact align={start} label={t('errorsPage.itemLastResult')} value={item.last_attempt_result ?? '—'} />
                    <Fact align={start} label={t('errorsPage.lastSeen')} value={<LocalTime value={item.updated_at} withTime />} />
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {href && (
                      <a href={href} className={linkClass} data-testid="error-item-link" {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                        {t('errorsPage.openItem')}
                      </a>
                    )}
                    {buttons.length > 0 && <NeedsActionItemButtons id={item.id} actions={buttons} retryLabel={failure ? t('mediaDelivery.retry') : item.retry_label} />}
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
            barTitle={(h) => fillNodes(t('errorsPage.timelineHour'), { hour: <LocalTime value={hourDate(h.hour).toISOString()} withTime />, count: formatNumber(h.occurrences, locale) })}
            locale={locale}
            hourLabel={(hour) => <LocalHour value={hourDate(hour).toISOString()} />}
            tableLabel={t('errorsPage.timelineTable')}
            hourHeading={fillNodes(t('errorsPage.timelineHourHeading'), { zone: <LocalZoneName /> })}
            axisNote={fillNodes(t('errorsPage.timelineZone'), { zone: <LocalZoneName /> })}
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
            // A list, not a table: the card is a third of the page, and three columns clipped the time (AUDIT-2)
            <ul className="divide-y divide-border text-sm" data-testid="error-releases">
              {releases.map((r) => (
                <li key={r.release} className="py-2 first:pt-0 last:pb-0" data-testid="error-release">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <code className="font-mono text-fg" dir="ltr">{r.release}</code>
                    <span className="text-fg-muted">
                      {t('errorsPage.colOccurrences')}: <span className="text-fg tabular-nums">{formatNumber(r.occurrences, locale)}</span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {t('errorsPage.colLastSeen')}: <LocalTime value={r.last_seen} withTime />
                  </p>
                </li>
              ))}
            </ul>
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
              <Sample key={e.id} event={e} app={group.app} t={t} locale={locale} highlighted={e.ref === highlight} />
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
              <ActivityEntry key={a.id} entry={a} t={t} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** A label over its value. The value lines up with the label at the page's start, whatever its own direction. */
function Fact({ label, value, mono = false, align }: { label: string; value: React.ReactNode; mono?: boolean; align: 'left' | 'right' }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`text-fg break-words ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined} style={{ textAlign: align }}>
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

function Sample({ event: e, app, t, locale, highlighted }: { event: ErrorEvent; app: string; t: Translator; locale: Locale; highlighted: boolean }) {
  const user = e.user_id && USER_ID.test(e.user_id) ? e.user_id : null;
  const ctx = parseContext(e.context_json);
  const extra = parseExtra(e.extra_json);
  // An Admin Tools report about an imported file (TA-11 reporter: extra.videoId): its file in Imports (TA-8)
  const importVideo = app === 'tools' ? extra.find(([k, v]) => k === 'videoId' && ID_SAFE.test(v))?.[1] ?? null : null;
  const template = e.route ? normalizeRoute(e.route) : '';
  const code = (v: string) => <code dir="ltr">{v}</code>;
  const facts: [string, React.ReactNode][] = [
    [t('errorsPage.occurredAt'), <LocalTime key="at" value={e.occurred_at} withTime />],
    [t('errorsPage.route'), e.route ? code(`${e.method ? `${e.method} ` : ''}${e.route}`) : '—'],
  ];
  if (template && template !== e.route) facts.push([t('errorsPage.routeTemplate'), code(template)]);
  if (e.status) facts.push([t('errorsPage.statusCode'), formatNumber(e.status, locale)]);
  facts.push(
    [t('errorsPage.environment'), e.environment ? environmentName(t, e.environment) : '—'],
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
  facts.push([t('errorsPage.browser'), [e.browser, e.os].filter((v): v is string => !!v).map((v) => platformName(t, locale, v)).join(' · ') || '—'], [t('errorsPage.locale'), e.locale ? languageName(e.locale, locale) : '—'], [t('errorsPage.theme'), e.theme ?? '—']);
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
                <LocalTime value={b.at} clock className="text-fg-subtle tabular-nums whitespace-nowrap" />
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
          {/* The same grid as the facts above, so its columns line up with theirs (AUDIT-2) */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm" data-testid="error-sample-extra">
            {extra.map(([k, v]) => {
              // Known keys in words, and the import step too; an unknown key stays as sent
              const label = translateDynamic(t, 'errorsPage.extraKeys', k);
              const known = label !== k;
              const step = k === 'step' ? translateDynamic(t, 'errorsPage.importSteps', v) : v;
              return (
                <div key={k} className="min-w-0">
                  <dt className={`text-fg-muted ${known ? '' : 'font-mono'}`} dir={known ? undefined : 'ltr'} style={{ textAlign: pageStart(locale) }}>{label}</dt>
                  <dd className={`text-fg break-all ${step !== v ? '' : 'font-mono'}`} dir={step !== v ? undefined : 'ltr'} style={{ textAlign: pageStart(locale) }}>{step}</dd>
                </div>
              );
            })}
          </dl>
          {importVideo && (
            <Link href={`/imports?video=${encodeURIComponent(importVideo)}`} className={`${linkClass} inline-block mt-2 text-sm`} data-testid="error-sample-import">
              {t('errorsPage.openImport')}
            </Link>
          )}
        </div>
      )}
      {!!e.diagnostic_size_bytes && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm" data-testid="error-sample-diagnostic">
          <span className="font-medium text-fg">{t('errorsPage.diagnosticLog')}</span>
          <a
            href={`/api/errors/diagnostics/${encodeURIComponent(e.ref)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            data-testid="error-sample-diagnostic-view"
          >
            {t('errorsPage.viewDiagnosticLog')}
          </a>
          <a
            href={`/api/errors/diagnostics/${encodeURIComponent(e.ref)}?download=1`}
            className={linkClass}
            data-testid="error-sample-diagnostic-download"
          >
            {t('errorsPage.downloadDiagnosticLog')}
          </a>
        </div>
      )}
    </li>
  );
}

function ActivityEntry({ entry: a, t }: { entry: ErrorActivity; t: Translator }) {
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
      <LocalTime value={a.created_at} withTime className="text-xs text-fg-subtle" />
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
