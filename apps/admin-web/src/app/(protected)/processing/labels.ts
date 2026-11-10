import type { MessageKey } from '@/i18n/translate';
import type { BunnyState, ProcessingCheckState, ProcessingIssueKind } from '@/lib/api/types';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export const PROCESSING_FILTERS = ['stuck', 'processing', 'failed', 'stalled', 'needs_reupload', 'all'] as const;
export type ProcessingFilter = (typeof PROCESSING_FILTERS)[number];

export const FILTER_LABEL: Record<ProcessingFilter, MessageKey> = {
  stuck: 'processing.filterStuck',
  processing: 'processing.filterProcessing',
  failed: 'processing.filterFailed',
  stalled: 'processing.filterStalled',
  needs_reupload: 'processing.filterNeedsReupload',
  all: 'processing.filterAll',
};

export function parseFilter(value: string | string[] | undefined): ProcessingFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (PROCESSING_FILTERS as readonly string[]).includes(v ?? '') ? (v as ProcessingFilter) : 'stuck';
}

const STATUS_LABEL: Record<string, MessageKey> = {
  initiated: 'processing.statusInitiated',
  uploading: 'processing.statusUploading',
  processing: 'processing.statusProcessing',
  ready: 'processing.statusReady',
  failed: 'processing.statusFailed',
};

export function ourStatusLabel(t: T, status?: string): string {
  return status && STATUS_LABEL[status] ? t(STATUS_LABEL[status]) : t('processing.statusReady');
}

/** Bunny video status (0 Created … 4 Finished, 5 Error, 6 UploadFailed, 7+ playable) */
export function bunnyLabel(t: T, bunny: BunnyState | null | undefined): string {
  if (bunny === null) return t('processing.bunnyMissing');
  if (!bunny || bunny.error || bunny.status === undefined) return t('processing.bunnyUnknown');
  const s = bunny.status;
  if (s >= 7) return t('processing.bunnyPlayable');
  const key = `processing.bunnyStatus${s}` as MessageKey;
  return t(key, { progress: bunny.encodeProgress ?? 0 });
}

export const ISSUE_LABEL: Record<ProcessingIssueKind, MessageKey> = {
  encode_failed: 'processing.issueEncodeFailed',
  needs_reupload: 'processing.issueNeedsReupload',
  stalled: 'processing.issueStalled',
};

export const OUTCOME_LABEL: Record<string, MessageKey> = {
  ready: 'processing.outcomeReady',
  failed: 'processing.outcomeFailed',
  needs_reupload: 'processing.outcomeNeedsReupload',
  stalled: 'processing.outcomeStalled',
  pending: 'processing.outcomePending',
};

export function checkLabel(t: T, check: ProcessingCheckState | null, format: (d: string) => string): string {
  if (!check) return t('processing.checkNone');
  if (check.finishedAt) return t('processing.checkDone', { outcome: check.outcome && OUTCOME_LABEL[check.outcome] ? t(OUTCOME_LABEL[check.outcome]) : check.outcome ?? '' });
  return t('processing.checkActive', { attempt: check.attempt + 1, date: check.nextCheckAt ? format(check.nextCheckAt) : '' });
}
