'use client';

/**
 * The parts of a job the Jobs page, the item panels and the Imports view share (wiki TOOLS-ADMIN
 * TA-8): attempts n/max and when it runs next, its last error in plain words (the raw message under
 * "Technical details"), its log, and Retry and Cancel.
 */
import { useState } from 'react';
import type { AdminContentPermission, AdminJob, AdminJobLogEntry } from '@al-ummah/shared-types';
import { cancelJob, readJob, retryJob } from '@/lib/api/content';
import { useLanguage } from '@/i18n/I18nProvider';
import { pageStart } from '@/i18n/config';
import { formatDuration, formatNumber } from '@/i18n/translate';
import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
import { linkClass } from '@/components/ui';
import { ConfirmDialog, type useContentAction } from './actions';
import { smallButtonClass } from './parts';
import { canCancelStatus, canRetryJob, canRetryStatus, jobErrorWords, logLineKey } from './job-helpers';

type ContentAction = ReturnType<typeof useContentAction>;
/** What Retry and Cancel need of a job. */
export type JobRef = Pick<AdminJob, 'id' | 'kind' | 'status'>;

/** The error in plain words, then the job's own message (left to right: it is code and English). */
export function JobErrorText({ error, testId = 'job-error' }: { error: string; testId?: string }) {
  const { t, locale } = useLanguage();
  return (
    <div className="text-xs break-words" data-testid={testId}>
      <p className="text-danger-fg [text-wrap:balance]">{t(jobErrorWords(error))}</p>
      {error !== 'hidden' && (
        <details className="mt-1 text-fg-muted">
          <summary className="cursor-pointer select-none hover:text-fg">{t('jobs.technical')}</summary>
          {/* Left to right (code and English), but on the page's start side like the summary above it */}
          <code dir="ltr" className="block mt-1 font-mono whitespace-pre-wrap" style={{ textAlign: pageStart(locale) }} data-testid={`${testId}-raw`}>
            {error}
          </code>
        </details>
      )}
    </div>
  );
}

/** "Attempt 2 of 6" and "Next try 2:20 PM EST" (or the next step of resumable work). */
export function JobTiming({ job }: { job: Pick<AdminJob, 'attempts' | 'maxAttempts' | 'nextRunAt' | 'status'> }) {
  const { t, locale } = useLanguage();
  const max = job.maxAttempts || 0;
  const waiting = job.nextRunAt && (job.status === 'retrying' || job.status === 'queued');
  return (
    <>
      {job.attempts > 0 && max > 0 && (
        <span className="block text-xs text-fg-muted mt-1" data-testid="job-attempts">
          {t('jobs.attemptsOf', { attempt: formatNumber(job.attempts, locale), max: formatNumber(max, locale) })}
        </span>
      )}
      {waiting && (
        <span className="block text-xs text-fg-muted mt-0.5" data-testid="job-next-run">
          {fillNodes(t(job.status === 'retrying' ? 'jobs.nextRun' : 'jobs.nextStep'), { time: <LocalTime value={job.nextRunAt!} timeOnly /> })}
        </span>
      )}
    </>
  );
}

/** Retry (failed or cancelled) and Cancel (not finished), each with the job kind's own permissions. */
export function JobActionButtons({ job, permissions, action, onCancelAsk }: { job: JobRef; permissions: readonly AdminContentPermission[]; action: ContentAction; onCancelAsk: (job: JobRef) => void }) {
  const { t } = useLanguage();
  if (!canRetryJob(job, permissions)) return null;
  const { run, busy } = action;
  return (
    <div className="flex flex-wrap gap-2 justify-end">
      {canRetryStatus(job) && (
        <button type="button" className={`${smallButtonClass} whitespace-nowrap`} disabled={!!busy} onClick={() => run(`retry:${job.id}`, () => retryJob(job.id), { success: t('jobs.retried') })} data-testid="job-retry">
          {busy === `retry:${job.id}` ? t('content.working') : t('jobs.retry')}
        </button>
      )}
      {canCancelStatus(job) && (
        <button type="button" className={`${smallButtonClass} whitespace-nowrap`} disabled={!!busy} onClick={() => onCancelAsk(job)} data-testid="job-cancel">
          {busy === `cancel:${job.id}` ? t('content.working') : t('jobs.cancel')}
        </button>
      )}
    </div>
  );
}

/** The in-app confirm for Cancel; one per list. */
export function useJobCancel(action: ContentAction) {
  const { t } = useLanguage();
  const [target, setTarget] = useState<JobRef | null>(null);
  const dialog = (
    <ConfirmDialog
      open={!!target}
      onCancel={() => setTarget(null)}
      onConfirm={() => {
        const job = target;
        setTarget(null);
        if (job) void action.run(`cancel:${job.id}`, () => cancelJob(job.id), { success: t('jobs.cancelled') });
      }}
      title={t('jobs.cancelTitle')}
      body={t('jobs.cancelBody')}
      confirmLabel={t('jobs.cancel')}
      cancelLabel={t('jobs.keepJob')}
      danger
      testId="job-cancel"
    />
  );
  return { ask: setTarget, dialog };
}

function LogLine({ entry, max }: { entry: AdminJobLogEntry; max: number }) {
  const { t, locale } = useLanguage();
  const text = t(logLineKey(entry), {
    attempt: formatNumber(entry.attempt ?? 0, locale),
    max: formatNumber(max, locale),
    wait: formatDuration(entry.delaySeconds ?? 0, locale),
  });
  return (
    <li className="grid grid-cols-1 sm:grid-cols-[minmax(11rem,auto)_1fr] gap-x-4 gap-y-0.5 py-2 border-b border-border last:border-0" data-testid="job-log-line" data-event={entry.event}>
      <LocalTime value={entry.at} clock withTime className="text-xs text-fg-muted tabular-nums" />
      <div className="min-w-0">
        <p className="text-sm text-fg [text-wrap:balance]">{text}</p>
        {entry.error && <JobErrorText error={entry.error} testId="job-log-error" />}
      </div>
    </li>
  );
}

/**
 * "Log": what happened to the job, read when opened (the list does not carry it). The toggle and the
 * panel are separate, so a table row can show the panel across all its columns.
 */
export function useJobLog(job: Pick<AdminJob, 'id' | 'maxAttempts' | 'updatedAt'>): { open: boolean; toggle: React.ReactNode; panel: React.ReactNode } {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ loading: boolean; log: AdminJobLogEntry[] | null; failed: boolean; at: string | null }>({ loading: false, log: null, failed: false, at: null });

  async function load() {
    setState((s) => ({ ...s, loading: true, failed: false }));
    const result = await readJob(job.id);
    if (result.ok) setState({ loading: false, log: result.data.log ?? [], failed: false, at: job.updatedAt });
    else setState((s) => ({ ...s, loading: false, failed: true }));
  }

  const panelId = `job-log-${job.id}`;
  const toggle = (
    <button
      type="button"
      className={`${linkClass} text-xs font-medium`}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={() => {
        const next = !open;
        setOpen(next);
        // Read again when the job changed since the last read
        if (next && (state.log === null || state.at !== job.updatedAt)) void load();
      }}
      data-testid="job-log-toggle"
    >
      {open ? t('jobs.hideLog') : t('jobs.showLog')}
    </button>
  );
  const panel = open ? (
    <section id={panelId} className="rounded border border-border bg-surface-2 px-3" aria-label={t('jobs.logTitle')} data-testid="job-log-panel">
      {state.loading && state.log === null && <p className="py-2 text-xs text-fg-muted">{t('jobs.logLoading')}</p>}
      {state.failed && (
        <p className="py-2 text-xs text-warning-fg" data-testid="job-log-failed">
          {t('jobs.logFailed')}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            {t('jobs.retry')}
          </button>
        </p>
      )}
      {state.log && state.log.length === 0 && <p className="py-2 text-xs text-fg-muted">{t('jobs.logEmpty')}</p>}
      {state.log && state.log.length > 0 && (
        <ol>
          {state.log.map((entry, i) => (
            <LogLine key={`${entry.at}-${i}`} entry={entry} max={job.maxAttempts} />
          ))}
        </ol>
      )}
    </section>
  ) : null;
  return { open, toggle, panel };
}

/** The log's toggle with its panel right under it (cards and panels). */
export function JobLog({ job }: { job: Pick<AdminJob, 'id' | 'maxAttempts' | 'updatedAt'> }) {
  const { toggle, panel } = useJobLog(job);
  return (
    <div data-testid="job-log">
      {toggle}
      {panel && <div className="mt-2">{panel}</div>}
    </div>
  );
}
