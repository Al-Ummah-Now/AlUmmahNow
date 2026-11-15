/** Labels and tones of the Backfill page (statuses come from api-videos lib/media/backfill). */
import { type BackfillItemState, type BackfillRun, type BackfillRunStatus, type BackfillSkipReason, type BunnyRemovalStatus } from '@al-ummah/shared-types';
import type { ChipTone } from '@/components/content/parts';
import type { MessageKey, Translator } from '@/i18n/translate';

export const RUN_STATUS_LABEL: Record<BackfillRunStatus, MessageKey> = {
  estimating: 'mediaBackfill.runEstimating',
  estimated: 'mediaBackfill.runEstimated',
  running: 'mediaBackfill.runRunning',
  paused: 'mediaBackfill.runPaused',
  cancelled: 'mediaBackfill.runCancelled',
  done: 'mediaBackfill.runDone',
  stopped_budget: 'mediaBackfill.runStoppedBudget',
  failed: 'mediaBackfill.runFailed',
};

export const RUN_TONE: Record<BackfillRunStatus, ChipTone> = {
  estimating: 'info',
  estimated: 'neutral',
  running: 'info',
  paused: 'warn',
  cancelled: 'neutral',
  done: 'good',
  stopped_budget: 'warn',
  failed: 'bad',
};

export const ITEM_STATES: BackfillItemState[] = ['pending', 'copying', 'transcoding', 'verifying', 'verified', 'failed', 'skipped', 'cancelled'];

export const ITEM_STATE_LABEL: Record<BackfillItemState, MessageKey> = {
  pending: 'mediaBackfill.itemPending',
  copying: 'mediaBackfill.itemCopying',
  transcoding: 'mediaBackfill.itemTranscoding',
  verifying: 'mediaBackfill.itemVerifying',
  verified: 'mediaBackfill.itemVerified',
  failed: 'mediaBackfill.itemFailed',
  skipped: 'mediaBackfill.itemSkipped',
  cancelled: 'mediaBackfill.itemCancelled',
};

export const ITEM_TONE: Record<BackfillItemState, ChipTone> = {
  pending: 'neutral',
  copying: 'info',
  transcoding: 'info',
  verifying: 'info',
  verified: 'good',
  failed: 'bad',
  skipped: 'neutral',
  cancelled: 'neutral',
};

export const SKIP_LABEL: Record<BackfillSkipReason, MessageKey> = {
  deleted: 'mediaBackfill.skipDeleted',
  live: 'mediaBackfill.skipLive',
  not_found: 'mediaBackfill.skipNotFound',
  no_source: 'mediaBackfill.skipNoSource',
  already_verified: 'mediaBackfill.skipAlreadyVerified',
  has_rendition: 'mediaBackfill.skipHasRendition',
  not_ready: 'mediaBackfill.skipNotReady',
  held: 'mediaBackfill.skipHeld',
};

export const STEP_LABEL = {
  copy: 'mediaBackfill.stepCopy',
  transcode: 'mediaBackfill.stepTranscode',
  verify: 'mediaBackfill.stepVerify',
} as const satisfies Record<string, MessageKey>;

export const REMOVAL_LABEL: Record<BunnyRemovalStatus, MessageKey> = {
  scheduled: 'mediaBackfill.removalScheduled',
  removing: 'mediaBackfill.removalRemoving',
  removed: 'mediaBackfill.removalRemoved',
  cancelled: 'mediaBackfill.removalCancelled',
  failed: 'mediaBackfill.removalFailed',
};

export const REMOVAL_TONE: Record<BunnyRemovalStatus, ChipTone> = { scheduled: 'warn', removing: 'info', removed: 'good', cancelled: 'neutral', failed: 'bad' };

/** Polled while the run estimates or works through videos. */
export const isLive = (status: BackfillRunStatus) => status === 'estimating' || status === 'running';

/** A danger action the size of the primary/secondary buttons beside it. */
export const dangerLargeButtonClass =
  'inline-block bg-danger-bg text-danger-fg border border-danger-border font-medium py-3 px-6 rounded transition-opacity hover:opacity-90 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus disabled:opacity-60 disabled:cursor-not-allowed';

/** A run's scope in one line (runs list and run header). */
export function scopeText(run: BackfillRun, t: Translator): string {
  const s = run.scope;
  const base =
    s.kind === 'all' ? t('mediaBackfill.scopeAll')
    : s.kind === 'channel' ? t('mediaBackfill.scopeChannelOf', { id: s.channelId ?? '' })
    : s.kind === 'dates' ? t('mediaBackfill.scopeDatesOf', { from: s.from ?? '…', to: s.to ?? '…' })
    : t('mediaBackfill.scopeVideosOf', { count: s.videoIds?.length ?? 0 });
  return s.onlyMissing ? `${base} · ${t('mediaBackfill.onlyMissing')}` : base;
}
