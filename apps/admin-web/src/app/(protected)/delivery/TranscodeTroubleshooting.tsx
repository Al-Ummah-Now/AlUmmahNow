'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from '@/components/AppLink';
import { dateTimeFormat, TROUBLESHOOT_LOG_HOURS, TROUBLESHOOT_TOKEN_CHECKS, type TroubleshootJob, type TroubleshootLogs, type TroubleshootStatus, type TroubleshootTokenView } from '@al-ummah/shared-types';
import {
  getTranscodeLogs,
  getTranscodeTroubleshoot,
  removeTroubleshootToken,
  setTroubleshootToken,
  testTroubleshootToken,
  transcodeAction,
} from '@/lib/api/admin';
import type { TranscodeTroubleshoot } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic, type Translator } from '@/i18n/translate';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { ErrorAlert, cardClass, fieldClass, linkClass } from '@/components/ui';
import { ConfirmButton } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { deliveryFormats } from './format';
import { API_ERROR_LABEL, REASON_LABEL, STATE_CHIP, STATE_LABEL, TROUBLESHOOT_REFRESH_MS, filterProblem, jobActions, orderJobs, statusNote } from './troubleshoot-view';
import { Select } from '@/components/select/Select';

const subTitle = 'text-base font-semibold text-fg';

export interface TranscodeTroubleshootingProps {
  initial: TranscodeTroubleshoot | null;
  /** Super admins set, test and remove the Cloudflare token */
  canSetToken: boolean;
  /** ?video=<id> (the Errors page links here): that video's job first, and the logs filter set to it */
  focusVideo: string | null;
}

/**
 * Transcode troubleshooting (videos admin → Delivery; owner 2026-11-15: "why the logs are not on
 * admin to troubleshoot?"): why an R2 transcode waits or fails, without Cloudflare access. Polls
 * admin-api every 30 s while the page is visible; log lines load only when asked for.
 */
export function TranscodeTroubleshooting({ initial, canSetToken, focusVideo }: TranscodeTroubleshootingProps) {
  const { t, locale } = useLanguage();
  const [data, setData] = useState<TranscodeTroubleshoot | null>(initial);
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [logsFilter, setLogsFilter] = useState(focusVideo ?? '');
  const logsRef = useRef<HTMLFormElement>(null) as React.RefObject<HTMLFormElement>;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const result = await getTranscodeTroubleshoot();
      if (result.ok) {
        setData(result.data);
        setStale(false);
      } else {
        logger.warn('[delivery] Troubleshoot refresh failed', { status: result.status });
        setStale(true);
      }
    } catch (e) {
      logger.warn('[delivery] Troubleshoot request failed', { error: e instanceof Error ? e.message : String(e) });
      setStale(true);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, TROUBLESHOOT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const updated = data ? new Date(data.status.at) : null;

  return (
    <section className={`${cardClass} mb-6 space-y-6`} aria-labelledby="transcode-troubleshooting-title" id="transcode-troubleshooting" data-testid="transcode-troubleshooting">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="transcode-troubleshooting-title" className="text-lg font-semibold text-fg">{t('transcodeTroubleshoot.title')}</h2>
          <p className="text-fg-muted text-sm mt-1">{t('transcodeTroubleshoot.intro')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button type="button" className={smallButtonClass} onClick={() => void refresh()} disabled={refreshing} data-testid="troubleshoot-refresh">
            {refreshing ? t('transcodeTroubleshoot.refreshing') : t('transcodeTroubleshoot.refresh')}
          </button>
          <p className="text-xs text-fg-muted" data-testid="troubleshoot-updated">
            {updated && !Number.isNaN(updated.getTime()) ? t('transcodeTroubleshoot.updated', { time: dateTimeFormat(locale, { timeStyle: 'medium' }).format(updated) }) : null}
          </p>
        </div>
      </div>
      {stale && <p role="status" className="text-sm text-danger-fg" data-testid="troubleshoot-stale">{t('transcodeTroubleshoot.stale')}</p>}

      {data ? (
        <>
          <StatusStrip status={data.status} t={t} locale={locale} />
          <JobsList
            data={data}
            focusVideo={focusVideo}
            t={t}
            locale={locale}
            onChanged={refresh}
            onShowLogs={(videoId) => {
              setLogsFilter(videoId);
              logsRef.current?.scrollIntoView({ block: 'start' }); // scroll-mt keeps it clear of the sticky header
              // The form reads the filter from state on its next submit
              window.setTimeout(() => logsRef.current?.requestSubmit(), 0);
            }}
          />
          <LogsViewer formRef={logsRef} filter={logsFilter} setFilter={setLogsFilter} tokenState={data.status.token} t={t} locale={locale} />
          <TokenCard token={data.token} canSetToken={canSetToken} t={t} locale={locale} onChanged={refresh} />
        </>
      ) : (
        <ErrorAlert testId="troubleshoot-load-error">{t('transcodeTroubleshoot.loadFailed')}</ErrorAlert>
      )}
    </section>
  );
}

function Figure({ label, value, note, testId }: { label: string; value: string; note?: string | null; testId: string }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-4 min-w-0">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-fg tabular-nums break-words" data-testid={testId}>{value}</dd>
      {note && <dd className="mt-1 text-xs text-fg-muted break-words">{note}</dd>}
    </div>
  );
}

const HEALTH_KEYS = ['active', 'healthy', 'failed', 'stopped', 'starting', 'scheduling'] as const;
/** Containers API health counter names in words; an unknown one stays as Cloudflare names it. */
function healthName(name: string, t: Translator): string {
  return (HEALTH_KEYS as readonly string[]).includes(name) ? t(`transcodeTroubleshoot.health.${name as (typeof HEALTH_KEYS)[number]}`) : name;
}

function StatusStrip({ status, t, locale }: { status: TroubleshootStatus; t: Translator; locale: string }) {
  const f = deliveryFormats(locale);
  const note = statusNote(status);
  const c = status.containers;
  const q = status.queues;
  const unknown = t('transcodeTroubleshoot.unknownValue');
  const problem = (part: { ok: false; error: keyof typeof API_ERROR_LABEL } | null | { ok: true }) => (part && !part.ok ? t(API_ERROR_LABEL[part.error]) : null);
  const inUse = c && c.ok ? (c.maxInstances === null ? f.integer(c.inUse) : t('transcodeTroubleshoot.of', { n: f.integer(c.inUse), m: f.integer(c.maxInstances) })) : unknown;
  const health = c && c.ok
    ? c.health && Object.keys(c.health).length
      ? Object.entries(c.health).map(([name, n]) => t('transcodeTroubleshoot.healthItem', { name: healthName(name, t), n: f.integer(n) })).join(' · ')
      : t('transcodeTroubleshoot.noHealth')
    : unknown;
  const backlog = (n: number | null | undefined) => (typeof n === 'number' ? t('transcodeTroubleshoot.messages', { n: f.integer(n) }) : unknown);
  const w = status.waiting;
  return (
    <div className="space-y-3">
      <h3 className={subTitle}>{t('transcodeTroubleshoot.statusTitle')}</h3>
      {note && <p className="rounded border border-border bg-surface-2 p-3 text-sm text-fg" data-testid="troubleshoot-status-note" data-note={note}>{t(note)}</p>}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Figure label={t('transcodeTroubleshoot.containersInUse')} value={inUse} note={problem(c)} testId="troubleshoot-in-use" />
        <Figure label={t('transcodeTroubleshoot.containersHealth')} value={health} testId="troubleshoot-health" />
        <Figure label={t('transcodeTroubleshoot.queueBacklog')} value={q && q.ok ? backlog(q.queue.backlog) : unknown} note={problem(q)} testId="troubleshoot-queue" />
        <Figure label={t('transcodeTroubleshoot.dlqBacklog')} value={q && q.ok ? backlog(q.dlq.backlog) : unknown} testId="troubleshoot-dlq" />
        <Figure label={t('transcodeTroubleshoot.waiting')} value={w ? f.integer(w.queued) : unknown} testId="troubleshoot-waiting" />
        <Figure
          label={t('transcodeTroubleshoot.oldestWait')}
          value={w ? (w.queued > 0 && w.oldestQueuedSeconds !== null ? f.duration(w.oldestQueuedSeconds) : t('transcodeTroubleshoot.noWait')) : unknown}
          testId="troubleshoot-oldest"
        />
      </dl>
    </div>
  );
}

function when(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function JobsList({ data, focusVideo, t, locale, onChanged, onShowLogs }: { data: TranscodeTroubleshoot; focusVideo: string | null; t: Translator; locale: string; onChanged: () => Promise<void>; onShowLogs: (videoId: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const jobs = data.jobs;

  async function act(job: TroubleshootJob, action: 'retry-now' | 'cancel') {
    setBusy(`${job.videoId}:${action}`);
    setError(null);
    setNotice(null);
    try {
      const result = await transcodeAction(job.videoId, action);
      if (!result.ok) {
        logger.warn('[delivery] Transcode action refused', { action, status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('transcodeTroubleshoot.actionFailed'));
        return;
      }
      setNotice(t(action === 'cancel' ? 'transcodeTroubleshoot.cancelQueued' : 'transcodeTroubleshoot.retryQueued', { video: job.title ?? job.videoId }));
      await onChanged();
    } catch (e) {
      logger.error('[delivery] Transcode action request failed', { action, error: e instanceof Error ? e.message : String(e) });
      setError(t('transcodeTroubleshoot.actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className={subTitle}>{t('transcodeTroubleshoot.jobsTitle')}</h3>
      {jobs?.transcoder === 'unbound' && <p className="text-sm text-fg-muted" data-testid="troubleshoot-transcoder-unbound">{t('transcodeTroubleshoot.transcoderUnbound')}</p>}
      {jobs?.transcoder === 'error' && <p className="text-sm text-danger-fg" data-testid="troubleshoot-transcoder-error">{t('transcodeTroubleshoot.transcoderError')}</p>}
      {error && <ErrorAlert testId="troubleshoot-action-error">{error}</ErrorAlert>}
      <p role="status" className="text-sm text-fg empty:hidden" data-testid="troubleshoot-action-notice">{notice}</p>
      {!jobs && <ErrorAlert testId="troubleshoot-jobs-error">{t('transcodeTroubleshoot.jobsUnavailable')}</ErrorAlert>}
      {jobs && jobs.items.length === 0 && <p className="rounded border border-border p-4 text-center text-fg-muted" data-testid="troubleshoot-jobs-empty">{t('transcodeTroubleshoot.jobsEmpty')}</p>}
      {jobs && jobs.items.length > 0 && (
        <ul className="space-y-3" data-testid="troubleshoot-jobs" aria-label={t('transcodeTroubleshoot.jobsCaption')}>
          {orderJobs(jobs.items, focusVideo).map((job) => {
            const actions = jobActions(job);
            const name = job.title ?? t('transcodeTroubleshoot.untitled');
            const times = [
              job.queuedAt && t('transcodeTroubleshoot.queuedAt', { time: when(job.queuedAt, locale) ?? '' }),
              job.startedAt && t('transcodeTroubleshoot.startedAt', { time: when(job.startedAt, locale) ?? '' }),
              job.lastSeenAt && job.state === 'running' && t('transcodeTroubleshoot.lastSeen', { time: when(job.lastSeenAt, locale) ?? '' }),
              job.nextRetryAt && (job.state === 'waiting_retry' || job.state === 'start_retry') && t('transcodeTroubleshoot.nextRetry', { time: when(job.nextRetryAt, locale) ?? '' }),
            ].filter(Boolean) as string[];
            return (
              <li
                key={job.videoId}
                className={`rounded-lg border p-4 ${job.videoId === focusVideo ? 'border-focus bg-surface-2' : 'border-border'}`}
                data-video-id={job.videoId}
                data-state={job.state}
                data-testid="troubleshoot-job"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[min(100%,16rem)] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-1 text-sm rounded font-medium whitespace-nowrap ${STATE_CHIP[job.state]}`} data-testid="troubleshoot-job-state">{t(STATE_LABEL[job.state])}</span>
                      <span className="text-xs text-fg-muted whitespace-nowrap tabular-nums" data-testid="troubleshoot-job-attempt">
                        {t('transcodeTroubleshoot.colAttempt')}{' '}
                        {job.maxAttempts === null ? t('transcodeTroubleshoot.attemptNoMax', { n: job.attempt }) : t('transcodeTroubleshoot.attempt', { n: job.attempt, m: job.maxAttempts })}
                      </span>
                      {job.state === 'running' && typeof job.progress === 'number' && (
                        <span className="text-xs text-fg-muted">{t('transcodeTroubleshoot.progress', { progress: Math.round(Math.min(1, Math.max(0, job.progress)) * 100) })}</span>
                      )}
                    </div>
                    <h4 className="mt-2 text-base font-medium">
                      <Link href={`/videos/${encodeURIComponent(job.videoId)}`} className={linkClass}>{name}</Link>
                    </h4>
                    {!job.title && <div className="font-mono text-xs text-fg-muted break-all" dir="ltr">{job.videoId}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={smallButtonClass} onClick={() => onShowLogs(job.videoId)} data-testid="troubleshoot-job-logs">
                      {t('transcodeTroubleshoot.showLogs')}
                      <span className="sr-only"> {t('transcodeTroubleshoot.showLogsFor', { video: name })}</span>
                    </button>
                    {actions.retry && (
                      <ConfirmButton
                        label={t('transcodeTroubleshoot.retryNow')}
                        title={t('transcodeTroubleshoot.retryNowTitle')}
                        body={t('transcodeTroubleshoot.retryNowBody')}
                        confirmLabel={t('transcodeTroubleshoot.retryNow')}
                        busy={busy === `${job.videoId}:retry-now`}
                        disabled={busy !== null}
                        testId="troubleshoot-retry-now"
                        onConfirm={() => act(job, 'retry-now')}
                      />
                    )}
                    {actions.cancel && (
                      <ConfirmButton
                        label={t('transcodeTroubleshoot.cancel')}
                        title={t('transcodeTroubleshoot.cancelTitle')}
                        body={t('transcodeTroubleshoot.cancelBody')}
                        confirmLabel={t('transcodeTroubleshoot.cancel')}
                        danger
                        busy={busy === `${job.videoId}:cancel`}
                        disabled={busy !== null}
                        testId="troubleshoot-cancel"
                        onConfirm={() => act(job, 'cancel')}
                      />
                    )}
                  </div>
                </div>
                <dl className="mt-3 grid gap-3 border-t border-border pt-3 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <dt className="text-xs text-fg-muted">{t('transcodeTroubleshoot.colWhy')}</dt>
                    <dd className="mt-1">
                      <p className="text-fg" data-testid="troubleshoot-job-reason" data-reason={job.reason ?? ''}>{job.reason ? t(REASON_LABEL[job.reason]) : t('transcodeTroubleshoot.noReason')}</p>
                      {job.error && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-fg-muted py-1">{t('transcodeTroubleshoot.rawError')}</summary>
                          <code className="mt-1 block whitespace-pre-wrap break-all rounded bg-surface-2 p-2 text-xs text-fg-muted" dir="ltr">{job.error}</code>
                        </details>
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-fg-muted">{t('transcodeTroubleshoot.colTimes')}</dt>
                    <dd className="mt-1">
                      <ul className="space-y-1 text-xs text-fg">{times.map((line) => <li key={line}>{line}</li>)}</ul>
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-fg-muted">{t('transcodeTroubleshoot.colContainer')}</dt>
                    <dd className="mt-1 text-xs">
                      {job.instance ? (
                        <>
                          <div className="font-mono break-all text-fg-muted" dir="ltr">{job.instance.name}</div>
                          <div className="mt-1 text-fg" data-testid="troubleshoot-job-instance-state">
                            {job.instance.state ? t('transcodeTroubleshoot.instanceState', { state: translateDynamic(t, 'transcodeTroubleshoot.instanceStates', job.instance.state) }) : t('transcodeTroubleshoot.instanceNoState')}
                          </div>
                        </>
                      ) : '—'}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type Source = 'all' | 'worker' | 'container';

function LogsViewer({ formRef, filter, setFilter, tokenState, t, locale }: { formRef: React.RefObject<HTMLFormElement>; filter: string; setFilter: (v: string) => void; tokenState: TroubleshootStatus['token']; t: Translator; locale: string }) {
  const [hours, setHours] = useState<number>(6);
  const [source, setSource] = useState<Source>('all');
  const [logs, setLogs] = useState<TroubleshootLogs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = filterProblem(filter);
  const noToken = tokenState !== 'ok';
  const time = dateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' });

  async function load(e: React.FormEvent) {
    e.preventDefault();
    if (invalid || noToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getTranscodeLogs({ q: filter.trim() || undefined, hours, source });
      if (!result.ok) {
        logger.warn('[delivery] Troubleshoot logs failed', { status: result.status });
        setError(t('transcodeTroubleshoot.logsFailed'));
        return;
      }
      setLogs(result.data);
    } catch (err) {
      logger.error('[delivery] Troubleshoot logs request failed', { error: err instanceof Error ? err.message : String(err) });
      setError(t('transcodeTroubleshoot.logsFailed'));
    } finally {
      setLoading(false);
    }
  }

  const sourceProblems = logs
    ? (['worker', 'container'] as const)
        .filter((s) => logs.sources[s] !== 'ok' && logs.sources[s] !== 'skipped')
        .map((s) => {
          const code = logs.sources[s];
          const problem = s === 'container' && code === 'not_found' ? t('transcodeTroubleshoot.logsNoApplication') : t(API_ERROR_LABEL[code as keyof typeof API_ERROR_LABEL]);
          return t('transcodeTroubleshoot.logsSourceProblem', { source: t(s === 'worker' ? 'transcodeTroubleshoot.sourceWorker' : 'transcodeTroubleshoot.sourceContainer'), problem });
        })
    : [];

  return (
    <div className="space-y-3" data-testid="troubleshoot-logs">
      <h3 className={subTitle} id="troubleshoot-logs-title">{t('transcodeTroubleshoot.logsTitle')}</h3>
      <p className="text-sm text-fg-muted">{t('transcodeTroubleshoot.logsIntro')}</p>
      {noToken && <p className="text-sm text-fg" data-testid="troubleshoot-logs-need-token">{t('transcodeTroubleshoot.logsNeedToken')}</p>}
      <form ref={formRef} onSubmit={load} className="flex flex-wrap items-end gap-3 scroll-mt-28" aria-labelledby="troubleshoot-logs-title" noValidate>
        <label className="flex w-full flex-col gap-1 text-sm text-fg-muted sm:w-auto">
          {t('transcodeTroubleshoot.logsFilter')}
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={`${fieldClass} w-full font-mono sm:w-80`}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby="troubleshoot-logs-filter-hint"
            data-testid="troubleshoot-logs-filter"
          />
          <span id="troubleshoot-logs-filter-hint" className={`text-xs ${invalid ? 'text-danger-fg' : ''}`}>
            {invalid ? t('transcodeTroubleshoot.logsFilterInvalid') : t('transcodeTroubleshoot.logsFilterHint')}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('transcodeTroubleshoot.logsHours')}
          <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={fieldClass} data-testid="troubleshoot-logs-hours">
            {TROUBLESHOOT_LOG_HOURS.map((h) => <option key={h} value={h}>{t('transcodeTroubleshoot.logsHoursOption', { n: h })}</option>)}
          </Select>
          <span className="text-xs">&nbsp;</span>
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('transcodeTroubleshoot.logsSource')}
          <Select value={source} onChange={(e) => setSource(e.target.value as Source)} className={fieldClass} data-testid="troubleshoot-logs-source">
            <option value="all">{t('transcodeTroubleshoot.logsSourceAll')}</option>
            <option value="worker">{t('transcodeTroubleshoot.logsSourceWorker')}</option>
            <option value="container">{t('transcodeTroubleshoot.logsSourceContainer')}</option>
          </Select>
          <span className="text-xs">&nbsp;</span>
        </label>
        <div className="flex flex-col gap-1">
          <button type="submit" className={smallButtonClass} disabled={loading || invalid || noToken} data-testid="troubleshoot-logs-load">
            {loading ? t('transcodeTroubleshoot.logsLoading') : t('transcodeTroubleshoot.logsLoad')}
          </button>
          <span className="text-xs">&nbsp;</span>
        </div>
      </form>
      {error && <ErrorAlert testId="troubleshoot-logs-error">{error}</ErrorAlert>}
      {sourceProblems.length > 0 && <ul className="text-sm text-danger-fg" data-testid="troubleshoot-logs-problems">{sourceProblems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {logs && (
        logs.lines.length === 0 ? (
          <p className="rounded border border-border p-4 text-center text-fg-muted" data-testid="troubleshoot-logs-empty">{t('transcodeTroubleshoot.logsEmpty')}</p>
        ) : (
          <>
            <p className="text-xs text-fg-muted" aria-live="polite">{t('transcodeTroubleshoot.logsCount', { n: logs.lines.length })}</p>
            <ol className="max-h-[28rem] overflow-y-auto rounded border border-border divide-y divide-border bg-surface-2" data-testid="troubleshoot-log-lines" tabIndex={0} aria-labelledby="troubleshoot-logs-title">
              {logs.lines.map((line, i) => (
                <li key={`${line.at}-${i}`} className="p-3 text-xs" data-source={line.source} data-level={line.level ?? ''}>
                  <div className="flex flex-wrap items-center gap-2 text-fg-muted">
                    <time dateTime={line.at} className="tabular-nums">{time.format(new Date(line.at))}</time>
                    <span className="rounded border border-border px-1.5 py-0.5 text-fg">{t(line.source === 'worker' ? 'transcodeTroubleshoot.sourceWorker' : 'transcodeTroubleshoot.sourceContainer')}</span>
                    {line.level && <span className={`rounded px-1.5 py-0.5 font-medium ${/error/i.test(line.level) ? 'bg-danger-bg text-danger-fg' : 'bg-chip-pending-bg text-chip-pending-fg'}`} data-level-raw={line.level}>{translateDynamic(t, 'transcodeTroubleshoot.logLevels', line.level.toLowerCase())}</span>}
                  </div>
                  <code className="mt-1 block whitespace-pre-wrap break-all text-fg" dir="ltr">{line.message}</code>
                  {line.detail && <code className="mt-1 block whitespace-pre-wrap break-all text-fg-muted" dir="ltr">{line.detail}</code>}
                </li>
              ))}
            </ol>
          </>
        )
      )}
    </div>
  );
}

function TokenCard({ token, canSetToken, t, locale, onChanged }: { token: TroubleshootTokenView; canSetToken: boolean; t: Translator; locale: string; onChanged: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const missing = token.test ? token.test.checks.filter((c) => !c.ok).map((c) => t(`transcodeTroubleshoot.checks.${c.name}`)) : [];

  async function run(kind: 'save' | 'test' | 'remove') {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      if (kind === 'save') {
        const result = await setTroubleshootToken(value.trim());
        if (!result.ok) {
          logger.warn('[delivery] Troubleshoot token save refused', { status: result.status });
          setError(result.status === 400 ? t('transcodeTroubleshoot.tokenInvalid') : t('transcodeTroubleshoot.tokenSaveFailed'));
          return;
        }
        setValue('');
        setNotice(result.data.test.ok ? t('transcodeTroubleshoot.tokenSaved') : t('transcodeTroubleshoot.tokenSavedMissing'));
      } else if (kind === 'test') {
        const result = await testTroubleshootToken();
        if (!result.ok) {
          logger.warn('[delivery] Troubleshoot token test refused', { status: result.status });
          setError(t('transcodeTroubleshoot.tokenTestFailed'));
          return;
        }
      } else {
        const result = await removeTroubleshootToken();
        if (!result.ok) {
          logger.warn('[delivery] Troubleshoot token remove refused', { status: result.status });
          setError(t('transcodeTroubleshoot.tokenRemoveFailed'));
          return;
        }
        setNotice(t('transcodeTroubleshoot.tokenRemoved'));
      }
      await onChanged();
    } catch (e) {
      logger.error('[delivery] Troubleshoot token request failed', { kind, error: e instanceof Error ? e.message : String(e) });
      setError(t(kind === 'save' ? 'transcodeTroubleshoot.tokenSaveFailed' : kind === 'test' ? 'transcodeTroubleshoot.tokenTestFailed' : 'transcodeTroubleshoot.tokenRemoveFailed'));
    } finally {
      setBusy(null);
    }
  }

  const stateText = !token.set
    ? t('transcodeTroubleshoot.tokenNotSet')
    : token.unreadable
      ? t('transcodeTroubleshoot.tokenUnreadable')
      : token.last4
        ? t('transcodeTroubleshoot.tokenSet', { last4: token.last4 })
        : t('transcodeTroubleshoot.tokenSetNoLast4');

  return (
    <div className="space-y-3 border-t border-border pt-6" data-testid="troubleshoot-token" data-token-set={token.set ? 'true' : 'false'}>
      <h3 className={subTitle} id="troubleshoot-token-title">{t('transcodeTroubleshoot.tokenTitle')}</h3>
      <p className="text-sm text-fg-muted max-w-3xl">{t('transcodeTroubleshoot.tokenIntro')}</p>
      <p className="text-sm text-fg-muted max-w-3xl">{t('transcodeTroubleshoot.tokenNeeds')}</p>
      <p className="text-sm text-fg font-medium" data-testid="troubleshoot-token-state">{stateText}</p>
      {token.set && token.updatedBy && token.updatedAt && (
        <p className="text-xs text-fg-muted">{fillNodes(t('transcodeTroubleshoot.tokenUpdated', { time: when(token.updatedAt, locale) ?? '' }), { who: <UserName id={token.updatedBy} showEmail={false} /> })}</p>
      )}
      {token.set && (
        token.test ? (
          <div className="text-sm" data-testid="troubleshoot-token-test">
            <p className="text-fg-muted">{t('transcodeTroubleshoot.tokenTested', { time: when(token.test.at, locale) ?? '' })}</p>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2">
              {TROUBLESHOOT_TOKEN_CHECKS.map((name) => {
                const ok = token.test!.checks.find((c) => c.name === name)?.ok ?? false;
                return (
                  <li key={name} className="flex items-center gap-2" data-check={name} data-ok={ok ? 'true' : 'false'}>
                    <span aria-hidden="true" className={ok ? 'text-fg' : 'text-danger-fg'}>{ok ? '✓' : '✕'}</span>
                    <span className="text-fg">{t(`transcodeTroubleshoot.checks.${name}`)}</span>
                    <span className={`text-xs ${ok ? 'text-fg-muted' : 'text-danger-fg'}`}>{ok ? t('transcodeTroubleshoot.checkOk') : t('transcodeTroubleshoot.checkMissing')}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-sm">{missing.length ? t('transcodeTroubleshoot.tokenMissing', { list: missing.join(locale.startsWith('ar') ? '، ' : ', ') }) : t('transcodeTroubleshoot.tokenAllGood')}</p>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t('transcodeTroubleshoot.tokenNeverTested')}</p>
        )
      )}
      {error && <ErrorAlert testId="troubleshoot-token-error">{error}</ErrorAlert>}
      <p role="status" className="text-sm text-fg empty:hidden" data-testid="troubleshoot-token-notice">{notice}</p>
      {canSetToken ? (
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) void run('save');
            }}
          >
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              {t('transcodeTroubleshoot.tokenField')}
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={`${fieldClass} font-mono w-full sm:w-80`}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                data-testid="troubleshoot-token-input"
              />
            </label>
            <button type="submit" className={smallButtonClass} disabled={busy !== null || !value.trim()} data-testid="troubleshoot-token-save">
              {busy === 'save' ? t('transcodeTroubleshoot.tokenSaving') : token.set ? t('transcodeTroubleshoot.tokenReplace') : t('transcodeTroubleshoot.tokenSave')}
            </button>
          </form>
          {token.set && !token.unreadable && (
            <button type="button" className={smallButtonClass} disabled={busy !== null} onClick={() => void run('test')} data-testid="troubleshoot-token-test-again">
              {busy === 'test' ? t('transcodeTroubleshoot.tokenTesting') : t('transcodeTroubleshoot.tokenTest')}
            </button>
          )}
          {token.set && (
            <ConfirmButton
              label={t('transcodeTroubleshoot.tokenRemove')}
              title={t('transcodeTroubleshoot.tokenRemoveTitle')}
              body={t('transcodeTroubleshoot.tokenRemoveBody')}
              confirmLabel={t('transcodeTroubleshoot.tokenRemove')}
              danger
              busy={busy === 'remove'}
              disabled={busy !== null}
              testId="troubleshoot-token-remove"
              onConfirm={() => run('remove')}
            />
          )}
        </div>
      ) : (
        <p className="text-sm text-fg-muted" data-testid="troubleshoot-token-super-only">{t('transcodeTroubleshoot.tokenSuperOnly')}</p>
      )}
    </div>
  );
}
