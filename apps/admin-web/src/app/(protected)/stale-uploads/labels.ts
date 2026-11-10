/**
 * Pure helpers of the Stale uploads page (unit tested in test/stale-uploads.test.ts).
 */
import type { MessageKey, Translator } from '@/i18n/translate';
import type { StaleUploadItem, StaleUploadStatus, StaleUploadTarget } from '@/lib/api/types';

export const STALE_FILTERS = ['open', 'would_delete', 'failed', 'kept', 'checking', 'deleted', 'all'] as const;
export type StaleFilter = (typeof STALE_FILTERS)[number];

export const FILTER_LABEL: Record<StaleFilter, MessageKey> = {
  open: 'staleUploads.filterOpen',
  would_delete: 'staleUploads.filterWouldDelete',
  failed: 'staleUploads.filterFailed',
  kept: 'staleUploads.filterKept',
  checking: 'staleUploads.filterChecking',
  deleted: 'staleUploads.filterDeleted',
  all: 'staleUploads.filterAll',
};

export function parseStaleFilter(value: string | string[] | undefined): StaleFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (STALE_FILTERS as readonly string[]).includes(v ?? '') ? (v as StaleFilter) : 'open';
}

/** The status query admin-api understands ("all" sends none). */
export function statusQuery(filter: StaleFilter): string | undefined {
  return filter === 'all' ? undefined : filter;
}

export const TYPE_LABEL: Record<StaleUploadTarget, MessageKey> = {
  abandoned: 'staleUploads.typeAbandoned',
  orphan: 'staleUploads.typeOrphan',
};

export const STATE_LABEL: Record<StaleUploadStatus, MessageKey> = {
  checking: 'staleUploads.stateChecking',
  would_delete: 'staleUploads.stateWouldDelete',
  deleted: 'staleUploads.stateDeleted',
  kept: 'staleUploads.stateKept',
  skipped: 'staleUploads.stateSkipped',
  failed: 'staleUploads.stateFailed',
};

/** Chip colours per state, from the admin theme tokens. */
export const STATE_TONE: Record<StaleUploadStatus, string> = {
  checking: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  would_delete: 'bg-chip-pending-bg text-chip-pending-fg',
  deleted: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  kept: 'bg-chip-resolved-bg text-chip-resolved-fg',
  skipped: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  failed: 'bg-danger-bg text-danger-fg',
};

/** Bunny Stream status (lib/bunny/schema.json) in words; null = Bunny has no such video. */
export function bunnyLabel(t: Translator, bunny: StaleUploadItem['bunny']): string {
  if (!bunny) return t('staleUploads.bunnyMissing');
  const status = bunny.status;
  switch (status) {
    case 0:
      return t('staleUploads.bunnyCreated');
    case 1:
      return t('staleUploads.bunnyUploaded');
    case 2:
      return t('staleUploads.bunnyProcessing');
    case 3:
      return t('staleUploads.bunnyTranscoding');
    case 4:
      return t('staleUploads.bunnyFinished');
    case 5:
      return t('staleUploads.bunnyError');
    case 6:
      return t('staleUploads.bunnyUploadFailed');
    default:
      return typeof status === 'number' && status >= 7 ? t('staleUploads.bunnyPlayable', { status }) : t('staleUploads.bunnyUnknown', { status: String(status ?? '?') });
  }
}

/** When the item came to exist: Bunny's creation date, else the record's. */
export function createdAt(item: StaleUploadItem): string | undefined {
  return item.bunny?.dateUploaded || item.record?.dateCreated || undefined;
}

/** Compact age ("40 min", "26 h", "9 d"). */
export function formatAge(t: Translator, from: string | undefined, now: number): string {
  const at = Date.parse(from || '');
  if (!Number.isFinite(at)) return t('staleUploads.unknown');
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 120) return t('staleUploads.ageMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 72) return t('staleUploads.ageHours', { count: hours });
  return t('staleUploads.ageDays', { count: Math.floor(hours / 24) });
}

/** Which actions make sense for an item. */
export function actionsFor(item: StaleUploadItem): { delete: boolean; keep: boolean; retry: boolean } {
  return {
    delete: item.status !== 'deleted' && item.status !== 'checking',
    keep: item.status !== 'deleted' && item.status !== 'kept',
    retry: item.status === 'failed' || item.status === 'kept' || item.status === 'skipped' || item.status === 'would_delete',
  };
}
