/**
 * A video's R2 rendition (epic #687, docs/media-delivery/R2-DELIVERY-PLAN.md):
 * the status badge (videos list and video page) and the failure details.
 * Presentational, server and client safe: they take the translator.
 */
import type { AdminVideoR2, AdminVideoR2Badge, TranscodeFailure, TranscodeStage } from '@/lib/api/content-types';
import type { MessageKey, Translator } from '@/i18n/translate';
import { deliveryFormats } from '@/app/(protected)/delivery/format';
import { Chip, type ChipTone } from './parts';

export type R2BadgeState = AdminVideoR2Badge['status'] | 'none';

const STATUS_LABEL: Record<AdminVideoR2Badge['status'], MessageKey> = {
  queued: 'mediaDelivery.statusQueued',
  transcoding: 'mediaDelivery.statusTranscoding',
  ready: 'mediaDelivery.statusReady',
  failed: 'mediaDelivery.statusFailed',
};

const TONE: Record<R2BadgeState, ChipTone> = { queued: 'warn', transcoding: 'info', ready: 'good', failed: 'bad', none: 'neutral' };

export function r2StateOf(r2: AdminVideoR2Badge | null | undefined): R2BadgeState {
  return r2 && r2.status in STATUS_LABEL ? r2.status : 'none';
}

/** The status in words: "Transcoding 40%" while it runs (progress 0..1). */
export function r2StatusText(r2: AdminVideoR2Badge | null | undefined, t: Translator): string {
  const state = r2StateOf(r2);
  if (state === 'none') return t('mediaDelivery.r2None');
  if (state === 'transcoding' && typeof r2?.progress === 'number') {
    return t('mediaDelivery.r2Progress', { progress: Math.round(Math.min(1, Math.max(0, r2.progress)) * 100) });
  }
  return t(STATUS_LABEL[state]);
}

/** "R2: Ready". Words, not colour alone, carry the state. */
export function R2Badge({ r2, t, large = false, prefix = true, testId = 'r2-badge' }: { r2: AdminVideoR2Badge | null | undefined; t: Translator; large?: boolean; /** "R2: " before the state (off under an R2 column heading) */ prefix?: boolean; testId?: string }) {
  const state = r2StateOf(r2);
  const text = r2StatusText(r2, t);
  return (
    <span data-r2-status={state} className="inline-flex">
      <Chip tone={TONE[state]} large={large} testId={testId}>
        {prefix ? t('mediaDelivery.r2Badge', { status: text }) : text}
      </Chip>
    </span>
  );
}

function bytesText(n: number, locale: string): string {
  const f = deliveryFormats(locale);
  if (n >= 1024 ** 3) return f.gb(n / 1024 ** 3);
  const mb = new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: 1 });
  return mb.format(n / 1024 ** 2);
}

/** A stage name in words; an unknown stage shows as sent. */
const STAGE_LABEL: Record<TranscodeStage, MessageKey> = {
  start: 'mediaDelivery.stageStart',
  fetch_source: 'mediaDelivery.stageFetchSource',
  probe: 'mediaDelivery.stageProbe',
  encode: 'mediaDelivery.stageEncode',
  stills: 'mediaDelivery.stageStills',
  upload: 'mediaDelivery.stageUpload',
  container: 'mediaDelivery.stageContainer',
};

export function stageText(stage: string, t: Translator): string {
  return Object.hasOwn(STAGE_LABEL, stage) ? t(STAGE_LABEL[stage as TranscodeStage]) : stage;
}

/**
 * Where and how a transcode failed: stage, error, attempt, time to failure,
 * source, container exit, and the FFmpeg stderr tail. A native disclosure, so
 * it opens with the keyboard and screen readers announce its state.
 */
export function R2FailureDetails({ failure, t, locale, last = false }: { failure: TranscodeFailure; t: Translator; locale: string; last?: boolean }) {
  const f = deliveryFormats(locale);
  const rows: { key: string; label: string; value: string; ltr?: boolean }[] = [
    { key: 'stage', label: t('mediaDelivery.failureStage'), value: failure.stageDetail ? `${stageText(failure.stage, t)} (${failure.stageDetail})` : stageText(failure.stage, t) },
    { key: 'error', label: t('mediaDelivery.failureError'), value: failure.error, ltr: true },
    { key: 'attempt', label: t('mediaDelivery.failureAttempt'), value: f.integer(failure.attempt) },
    { key: 'elapsed', label: t('mediaDelivery.failureElapsed'), value: f.duration(failure.elapsedMs / 1000) },
  ];
  const at = new Date(failure.at);
  if (!Number.isNaN(at.getTime())) {
    rows.push({ key: 'at', label: t('mediaDelivery.failureAt'), value: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(at) });
  }
  if (failure.source?.file || typeof failure.source?.bytes === 'number') {
    const file = failure.source.file ?? '';
    const size = typeof failure.source.bytes === 'number' ? bytesText(failure.source.bytes, locale) : '';
    rows.push({ key: 'source', label: t('mediaDelivery.failureSource'), value: file && size ? t('mediaDelivery.failureSourceValue', { file, size }) : file || size });
  }
  if (typeof failure.exitCode === 'number') rows.push({ key: 'exitCode', label: t('mediaDelivery.failureExitCode'), value: String(failure.exitCode), ltr: true });
  if (failure.stopReason) rows.push({ key: 'stopReason', label: t('mediaDelivery.failureStopReason'), value: failure.stopReason, ltr: true });
  if (failure.instanceId) rows.push({ key: 'instance', label: t('mediaDelivery.failureInstance'), value: failure.instanceId, ltr: true });
  const tail = failure.stderrTail?.filter((line) => typeof line === 'string') ?? [];
  return (
    <details className="mt-3 rounded border border-border bg-surface-2 p-3 text-sm" data-testid="r2-failure-details">
      <summary className="cursor-pointer font-medium text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded">
        {last ? t('mediaDelivery.failureLastDetails') : t('mediaDelivery.failureDetails')}
      </summary>
      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {rows.map((row) => (
          <div key={row.key} data-failure={row.key}>
            <dt className="text-fg-muted">{row.label}</dt>
            <dd className="text-fg break-words" dir={row.ltr ? 'ltr' : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {tail.length > 0 && (
        <div className="mt-3">
          <p className="text-fg-muted mb-1" aria-hidden="true">{t('mediaDelivery.failureStderr')}</p>
          <pre dir="ltr" aria-label={t('mediaDelivery.failureStderr')} tabIndex={0} className="max-h-64 overflow-auto rounded bg-surface p-2 text-xs text-fg whitespace-pre-wrap break-all" data-testid="r2-stderr">
            {tail.join('\n')}
          </pre>
        </div>
      )}
    </details>
  );
}

/**
 * The video page's R2 block: badge, a progress bar while transcoding, the
 * error, when it was queued/started/ready/failed, and the failure details
 * (for a failed job, or a queued/transcoding one whose earlier attempt failed).
 */
export function R2Status({ r2, t, locale }: { r2: AdminVideoR2 | null | undefined; t: Translator; locale: string }) {
  if (!r2) {
    return (
      <div data-testid="r2-status" data-r2-status="none">
        <R2Badge r2={null} t={t} large />
        <p className="mt-2 text-sm text-fg-muted">{t('mediaDelivery.r2NoneHint')}</p>
      </div>
    );
  }
  const f = deliveryFormats(locale);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const date = (v: string | undefined) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : when.format(d);
  };
  const progress = r2.status === 'transcoding' && typeof r2.progress === 'number' ? Math.round(Math.min(1, Math.max(0, r2.progress)) * 100) : null;
  const times: { key: string; label: string; value: string | null }[] = [
    { key: 'queued', label: t('mediaDelivery.r2QueuedAt'), value: date(r2.queuedAt) },
    { key: 'started', label: t('mediaDelivery.r2StartedAt'), value: date(r2.startedAt) },
    { key: 'ready', label: t('mediaDelivery.r2ReadyAt'), value: r2.status === 'ready' ? date(r2.readyAt) : null },
    { key: 'failed', label: t('mediaDelivery.r2FailedAt'), value: r2.status === 'failed' ? date(r2.failedAt) : null },
  ];
  const showFailure = r2.failure && (r2.status === 'failed' || r2.status === 'queued' || r2.status === 'transcoding');
  return (
    <div data-testid="r2-status" data-r2-status={r2.status}>
      <R2Badge r2={r2} t={t} large />
      {progress !== null && (
        <div
          role="progressbar"
          aria-label={t('mediaDelivery.statusTranscoding')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="mt-3 h-2 w-full max-w-sm overflow-hidden rounded bg-surface-2 border border-border"
          data-testid="r2-progress"
        >
          <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      )}
      {r2.status === 'failed' && r2.error && (
        <p className="mt-2 text-sm text-danger-fg break-words" data-testid="r2-error">
          {t('mediaDelivery.failureError')}: <span dir="ltr">{r2.error}</span>
        </p>
      )}
      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-fg-muted">{t('mediaDelivery.r2Access')}</dt>
          <dd className="text-fg">{r2.access === 'pub' ? t('mediaDelivery.r2AccessPub') : t('mediaDelivery.r2AccessPriv')}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t('mediaDelivery.r2Attempts')}</dt>
          <dd className="text-fg tabular-nums">{f.integer(r2.attempts)}</dd>
        </div>
        {times
          .filter((x) => x.value)
          .map((x) => (
            <div key={x.key}>
              <dt className="text-fg-muted">{x.label}</dt>
              <dd className="text-fg">{x.value}</dd>
            </div>
          ))}
      </dl>
      {showFailure && r2.failure && <R2FailureDetails failure={r2.failure} t={t} locale={locale} last={r2.status !== 'failed'} />}
    </div>
  );
}
