/**
 * The video page's Processing card, Bunny and R2 side by side:
 * per-source status lines and resolution chips. Presentational, server and
 * client safe: they take the translator.
 *
 * Chips are sorted ascending by height (one helper, sortByResolution) and say
 * their state in words as well as by look: done is filled, in progress is
 * animated (not under prefers-reduced-motion) with its %, waiting is outlined,
 * failed is red with the reason in a tooltip reachable by keyboard and screen
 * reader (aria-describedby on a focusable chip, plus title for the mouse).
 */
import { chartLocale, sanitizeRungs, sortByResolution, type AdminLiveEvent, type R2RungState } from '@al-ummah/shared-types';
import type { AdminVideoR2 } from '@/lib/api/content-types';
import type { Translator } from '@/i18n/translate';
import { deliveryFormats } from '@/app/(protected)/delivery/format';
import { ISSUE_LABEL } from '@/app/(protected)/processing/labels';

export { sortByResolution };

/** Resolution labels lowest first: "360p 480p 720p 240p" → 240p, 360p, 480p, 720p. */
export function sortResolutions(labels: readonly string[]): string[] {
  return sortByResolution(labels, (l) => l);
}

export type ChipState = R2RungState;

export interface ResolutionChipData {
  name: string;
  state: ChipState;
  /** 0..1 while encoding or uploading */
  progress?: number;
  /** bits/s, bytes: where known */
  bandwidth?: number;
  bytes?: number;
  /** failed: why */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Bunny
// ---------------------------------------------------------------------------

export type BunnyState = 'queued' | 'encoding' | 'finished' | 'failed' | 'unknown';

type Processing = { status: string; encodeProgress: number | null; resolutions: string[] } | null | undefined;
type Issue = { kind: string; reason?: string; at?: string } | null | undefined;

const BUNNY_QUEUED = ['created', 'uploaded'];
const BUNNY_ENCODING = ['processing', 'transcoding'];
const BUNNY_FINISHED = ['finished', 'jit_segmenting', 'jit_playlists_created'];
const BUNNY_FAILED = ['error', 'upload_failed'];

/** Where Bunny is: a recorded processing issue (stalled, needs re-upload) counts as failed. */
export function bunnyStateOf(processing: Processing, issue?: Issue): BunnyState {
  if (issue?.kind) return 'failed';
  const s = processing?.status;
  if (!s) return 'unknown';
  if (BUNNY_FAILED.includes(s)) return 'failed';
  if (BUNNY_FINISHED.includes(s)) return 'finished';
  if (BUNNY_ENCODING.includes(s)) return 'encoding';
  if (BUNNY_QUEUED.includes(s)) return 'queued';
  return 'unknown';
}

export function bunnyInProgress(processing: Processing, issue?: Issue): boolean {
  const s = bunnyStateOf(processing, issue);
  return s === 'queued' || s === 'encoding';
}

function issueText(issue: Issue, t: Translator): string | null {
  if (!issue?.kind) return null;
  const label = Object.hasOwn(ISSUE_LABEL, issue.kind) ? t(ISSUE_LABEL[issue.kind as keyof typeof ISSUE_LABEL]) : issue.kind;
  return issue.reason ? `${label} (${issue.reason})` : label;
}

/** "Queued", "Encoding 40%", "Finished", "Failed: <reason>"; Bunny's raw status when unknown. */
export function bunnyStatusText(processing: Processing, issue: Issue, t: Translator): string {
  const state = bunnyStateOf(processing, issue);
  switch (state) {
    case 'queued':
      return t('videos.bunnyQueued');
    case 'encoding':
      return typeof processing?.encodeProgress === 'number' ? t('videos.encodeProgress', { progress: processing.encodeProgress }) : t('videos.bunnyEncoding');
    case 'finished':
      return t('videos.bunnyFinished');
    case 'failed': {
      const why = issueText(issue, t) ?? processing?.status;
      return why ? t('videos.bunnyFailedReason', { reason: why }) : t('videos.bunnyFailed');
    }
    default:
      return processing?.status ?? t('videos.bunnyUnavailable');
  }
}

/** Bunny's chips: only the resolutions it has made (its target ladder is unknown, so no pending ones). */
export function bunnyChips(processing: Processing, fallback: readonly string[] = []): ResolutionChipData[] {
  const list = processing?.resolutions.length ? processing.resolutions : fallback;
  return sortResolutions([...new Set(list.map((r) => r.trim()).filter(Boolean))]).map((name) => ({ name, state: 'done' }));
}

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

/** R2's chips: the attempt's rung states, with bitrate and size from the result where known. */
export function r2Chips(r2: AdminVideoR2 | null | undefined): ResolutionChipData[] {
  if (!r2) return [];
  const stats = new Map((r2.result?.rungs ?? []).map((r) => [r.name, r]));
  const reason = r2.failure?.error ?? r2.error;
  let chips: ResolutionChipData[];
  if (r2.rungs?.length) {
    chips = r2.rungs.map((r) => ({ name: r.name, state: r.state, ...(typeof r.progress === 'number' ? { progress: r.progress } : {}) }));
  } else if (r2.status === 'ready' && r2.result?.rungs.length) {
    chips = r2.result.rungs.map((r) => ({ name: r.name, state: 'done' as const }));
  } else {
    return [];
  }
  return sortByResolution(
    chips.map((c) => {
      const s = c.state === 'done' ? stats.get(c.name) : undefined;
      return {
        ...c,
        ...(typeof s?.bandwidth === 'number' ? { bandwidth: s.bandwidth } : {}),
        ...(typeof s?.bytes === 'number' ? { bytes: s.bytes } : {}),
        ...(c.state === 'failed' && reason ? { reason } : {}),
      };
    }),
    (c) => c.name,
  );
}

export function r2InProgress(r2: AdminVideoR2 | null | undefined): boolean {
  return r2?.status === 'queued' || r2?.status === 'transcoding';
}

/** "Original (1920×1080)", "Bunny MP4 1080p", or the file as sent. Null before a result. */
export function r2SourceText(r2: AdminVideoR2 | null | undefined, t: Translator): string | null {
  const src = r2?.result?.source;
  if (!src) return null;
  const size = src.width && src.height ? `${src.width}×${src.height}` : '';
  const file = src.file ?? '';
  if (!file || file === 'original') return t('mediaDelivery.r2SourceOriginal', { size: size || '?' });
  const mp4 = /^play_(\d{3,4}p)\.mp4$/.exec(file);
  if (mp4) return t('mediaDelivery.r2SourceBunny', { resolution: mp4[1]! });
  return size ? t('mediaDelivery.r2SourceOther', { file, size }) : file;
}

/** Seconds from queued to ready, or null. */
export function r2TimeToReadySeconds(r2: AdminVideoR2 | null | undefined): number | null {
  if (r2?.status !== 'ready' || !r2.readyAt || !r2.queuedAt) return null;
  const ms = Date.parse(r2.readyAt) - Date.parse(r2.queuedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

/**
 * A `job` event of the admin:media live channel applied to this video's R2 state.
 * `refetch` is true when the event cannot be applied alone: cut by the channel
 * (truncated), another job, or a finish (ready/failed bring a result or failure
 * details the event does not carry).
 */
export function r2FromLiveEvent(r2: AdminVideoR2 | null | undefined, event: AdminLiveEvent): { r2: AdminVideoR2 | null | undefined; refetch: boolean } {
  if (event.truncated === true) return { r2, refetch: true };
  if (!r2 || typeof event.jobId !== 'string' || event.jobId !== r2.jobId) return { r2, refetch: true };
  const status = event.status;
  if (status !== 'queued' && status !== 'transcoding' && status !== 'ready' && status !== 'failed') return { r2, refetch: true };
  const next: AdminVideoR2 = { ...r2, status };
  if (typeof event.attempt === 'number') next.attempts = event.attempt;
  if (typeof event.progress === 'number') next.progress = event.progress;
  const rungs = sanitizeRungs(event.rungs);
  if (rungs) next.rungs = rungs;
  return { r2: next, refetch: status !== r2.status && (status === 'ready' || status === 'failed') };
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

function bitrateText(bps: number, locale: string): string {
  const f = deliveryFormats(locale);
  if (bps >= 1_000_000) {
    return new Intl.NumberFormat(chartLocale(locale), { style: 'unit', unit: 'megabit-per-second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(bps / 1_000_000);
  }
  return f.kbps(bps / 1000);
}

function sizeText(n: number, locale: string): string {
  if (n >= 1024 ** 3) return deliveryFormats(locale).gb(n / 1024 ** 3);
  return new Intl.NumberFormat(chartLocale(locale), { style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: 1 }).format(n / 1024 ** 2);
}

const pct = (p: number | undefined) => Math.round(Math.min(1, Math.max(0, p ?? 0)) * 100);

/** The chip's state in words ("Uploading 40%"). */
export function chipStateText(c: ResolutionChipData, t: Translator): string {
  switch (c.state) {
    case 'done':
      return t('mediaDelivery.rungDone');
    case 'encoding':
      return typeof c.progress === 'number' ? t('mediaDelivery.rungEncoding', { progress: pct(c.progress) }) : t('mediaDelivery.rungEncodingPlain');
    case 'uploading':
      return t('mediaDelivery.rungUploading', { progress: pct(c.progress) });
    case 'failed':
      return t('mediaDelivery.rungFailed');
    default:
      return t('mediaDelivery.rungPending');
  }
}

const CHIP_BASE = 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap border';
const CHIP_LOOK: Record<ChipState, string> = {
  done: 'bg-accent text-on-accent border-accent',
  encoding: 'bg-surface-2 text-fg border-accent motion-safe:animate-pulse',
  uploading: 'bg-surface-2 text-fg border-accent motion-safe:animate-pulse',
  pending: 'bg-transparent text-fg-muted border-border border-dashed',
  failed: 'bg-danger-bg text-danger-fg border-danger-border',
};

export function ResolutionChip({ chip, t, locale, idPrefix }: { chip: ResolutionChipData; t: Translator; locale: string; idPrefix: string }) {
  const state = chipStateText(chip, t);
  const extras = [
    typeof chip.bandwidth === 'number' && chip.bandwidth > 0 ? bitrateText(chip.bandwidth, locale) : null,
    typeof chip.bytes === 'number' && chip.bytes > 0 ? sizeText(chip.bytes, locale) : null,
  ].filter(Boolean) as string[];
  const inner = (
    <>
      <span dir="ltr">{chip.name}</span>
      {chip.state === 'done' ? (
        <span className="sr-only">{state}</span>
      ) : (
        <span>· {state}</span>
      )}
      {extras.length > 0 && <span className="opacity-90">· {extras.join(' · ')}</span>}
    </>
  );
  const data = { 'data-resolution': chip.name, 'data-state': chip.state, 'data-testid': 'resolution-chip' };
  if (chip.state === 'failed') {
    const id = `${idPrefix}-${chip.name.replace(/[^A-Za-z0-9_-]/g, '')}-reason`;
    const reason = chip.reason ? t('mediaDelivery.rungFailedReason', { reason: chip.reason }) : t('mediaDelivery.rungFailedUnknown');
    return (
      <li className="relative group inline-flex">
        <button type="button" className={`${CHIP_BASE} ${CHIP_LOOK.failed} cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-focus`} aria-describedby={id} title={reason} {...data}>
          {inner}
        </button>
        <span
          role="tooltip"
          id={id}
          className="pointer-events-none absolute start-0 top-full z-10 mt-1 hidden w-64 max-w-[80vw] rounded border border-border bg-surface p-2 text-xs text-fg shadow group-hover:block group-focus-within:block whitespace-normal break-words"
        >
          {reason}
        </span>
      </li>
    );
  }
  const live = chip.state === 'encoding' || chip.state === 'uploading';
  return (
    <li className="inline-flex">
      <span className={`${CHIP_BASE} ${CHIP_LOOK[chip.state]}`} {...data} {...(live ? { 'data-progress': String(pct(chip.progress)) } : {})}>
        {inner}
      </span>
    </li>
  );
}

export function ResolutionChips({ chips, t, locale, label, idPrefix, testId }: { chips: ResolutionChipData[]; t: Translator; locale: string; label: string; idPrefix: string; testId?: string }) {
  if (!chips.length) return <p className="text-sm text-fg-muted" data-testid={testId}>{t('videos.noResolutions')}</p>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={label} data-testid={testId}>
      {chips.map((c) => <ResolutionChip key={c.name} chip={c} t={t} locale={locale} idPrefix={idPrefix} />)}
    </ul>
  );
}

/** Bunny's column: status line, overall % while encoding, and the resolutions it has made. */
export function BunnySource({ processing, issue, fallbackResolutions, t, locale }: { processing: Processing; issue?: Issue; fallbackResolutions?: readonly string[]; t: Translator; locale: string }) {
  const state = bunnyStateOf(processing, issue);
  const progress = state === 'encoding' && typeof processing?.encodeProgress === 'number' ? Math.min(100, Math.max(0, processing.encodeProgress)) : null;
  return (
    <div data-testid="video-bunny-status" data-bunny-state={state}>
      {processing || issue ? (
        <p className={`text-sm ${state === 'failed' ? 'text-danger-fg' : 'text-fg'}`} data-testid="bunny-status-line">
          <span className="text-fg-muted">{t('videos.processingStatusLine')}: </span>
          <span className="break-words">{bunnyStatusText(processing, issue, t)}</span>
        </p>
      ) : (
        <p className="text-sm text-fg-muted">{t('videos.bunnyUnavailable')}</p>
      )}
      {progress !== null && (
        <div
          role="progressbar"
          aria-label={t('videos.bunnyEncoding')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="mt-2 h-2 w-full max-w-sm overflow-hidden rounded bg-surface-2 border border-border"
          data-testid="bunny-progress"
        >
          <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="mt-3">
        <p className="text-sm text-fg-muted mb-1">{t('videos.resolutions')}</p>
        <ResolutionChips chips={bunnyChips(processing, fallbackResolutions)} t={t} locale={locale} label={t('videos.bunnyResolutions')} idPrefix="bunny" testId="bunny-resolutions" />
        {progress !== null && <p className="mt-1 text-xs text-fg-muted" data-testid="bunny-overall">{t('videos.bunnyOverall', { progress })}</p>}
      </div>
    </div>
  );
}

/** R2's extras for the status block: chips, source used, time to ready, container time. */
export function R2Extras({ r2, t, locale }: { r2: AdminVideoR2; t: Translator; locale: string }) {
  const f = deliveryFormats(locale);
  const source = r2SourceText(r2, t);
  const ready = r2TimeToReadySeconds(r2);
  const rows: { key: string; label: string; value: string }[] = [];
  if (source) rows.push({ key: 'source', label: t('mediaDelivery.r2Source'), value: source });
  if (ready !== null) rows.push({ key: 'ready', label: t('mediaDelivery.r2TimeToReady'), value: f.duration(ready) });
  if (typeof r2.containerSeconds === 'number') rows.push({ key: 'container', label: t('mediaDelivery.r2ContainerTime'), value: f.duration(r2.containerSeconds) });
  return (
    <div className="mt-3" data-testid="r2-extras">
      <p className="text-sm text-fg-muted mb-1">{t('videos.resolutions')}</p>
      <ResolutionChips chips={r2Chips(r2)} t={t} locale={locale} label={t('mediaDelivery.r2Resolutions')} idPrefix="r2" testId="r2-resolutions" />
      {rows.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {rows.map((row) => (
            <div key={row.key} data-r2-extra={row.key}>
              <dt className="text-fg-muted">{row.label}</dt>
              <dd className="text-fg tabular-nums" dir={row.key === 'source' ? 'auto' : undefined}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

