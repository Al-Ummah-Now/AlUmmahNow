/**
 * Pure helpers for admin jobs (no React, no server actions), shared by the
 * jobs UI and its tests.
 */
import { ADMIN_JOB_PERMISSIONS, type AdminContentPermission, type AdminJob, type AdminJobLogEntry } from '@al-ummah/shared-types';
import type { MessageKey } from '@/i18n/translate';
import type { ChipTone } from './parts';

const ACTIVE = new Set(['queued', 'running', 'retrying']);

export const isActiveJob = (job: Pick<AdminJob, 'status'>) => ACTIVE.has(job.status);

export function jobTone(status: AdminJob['status']): ChipTone {
  if (status === 'failed') return 'bad';
  if (status === 'retrying') return 'warn';
  if (status === 'succeeded') return 'good';
  if (status === 'cancelled') return 'neutral';
  return 'info';
}

/** Retry: a failed job, or one an admin cancelled. */
export const canRetryStatus = (job: Pick<AdminJob, 'status'>) => job.status === 'failed' || job.status === 'cancelled';
/** Cancel: a job that has not finished. */
export const canCancelStatus = (job: Pick<AdminJob, 'status'>) => ACTIVE.has(job.status);

/**
 * A job's error in plain words: what kind of problem it was, from the raw message the job stored. The
 * raw message stays available as the technical detail. Ordered from the most specific pattern.
 */
const ERROR_WORDS: Array<[RegExp, MessageKey]> = [
  [/^hidden$/, 'jobs.errorWords.hidden'],
  [/could not queue the job/i, 'jobs.errorWords.queue'],
  [/no handler for/i, 'jobs.errorWords.noHandler'],
  [/is not bound|binding/i, 'jobs.errorWords.binding'],
  [/time(d)? ?out|timeout|deadline|ETIMEDOUT/i, 'jobs.errorWords.timeout'],
  [/bunny/i, 'jobs.errorWords.bunny'],
  [/\b(401|403)\b|forbidden|unauthori[sz]ed|permission|denied/i, 'jobs.errorWords.denied'],
  [/not found|\b404\b|no such|missing|gone|deleted/i, 'jobs.errorWords.notFound'],
  [/\bD1\b|sqlite|database|constraint/i, 'jobs.errorWords.database'],
  [/\bR2\b|bucket|object storage/i, 'jobs.errorWords.storage'],
  [/fetch failed|network|ECONN|socket|\b5\d\d\b|unavailable|bad gateway|internal (server )?error/i, 'jobs.errorWords.service'],
];

export function jobErrorWords(error: string): MessageKey {
  for (const [pattern, key] of ERROR_WORDS) if (pattern.test(error)) return key;
  return 'jobs.errorWords.other';
}

/** The message key of a job log line (placeholders: attempt, max, wait). */
export function logLineKey(entry: Pick<AdminJobLogEntry, 'event' | 'retried'>): MessageKey {
  if (entry.event === 'queued') return entry.retried ? 'jobs.log.retried' : 'jobs.log.queued';
  return `jobs.log.${entry.event}` as MessageKey;
}

/** Retrying re-runs the action, so it needs that action's permissions. */
export function canRetryJob(job: Pick<AdminJob, 'kind'>, permissions: readonly AdminContentPermission[]): boolean {
  const needed = ADMIN_JOB_PERMISSIONS[job.kind] ?? ['content:delete'];
  return needed.every((p) => permissions.includes(p));
}

/** Where a job's target lives. Jobs spanning many targets open their own page. */
export function jobTargetHref(job: Pick<AdminJob, 'targetKind' | 'targetId'> & Partial<Pick<AdminJob, 'kind'>>): string {
  // The legacy profile restore covers many profiles: it lives on its own page
  if (job.kind === 'profiles.restore-legacy') return '/legacy-profiles';
  // The thumbnail shape check spans many videos: it opens Processing health
  if (job.kind === 'videos.repair-thumbnails') return '/processing';
  // The index rebuild covers a whole bucket: its flag lives on the Errors page
  if (job.kind === 'search.rebuild-ownership' || job.kind === 'search.reconcile' || job.kind === 'search.repair-objects') return '/errors';
  // The discovery ranking covers the whole site: it stays on the jobs list
  if (job.kind === 'discovery.rank') return '/jobs';
  const base = job.targetKind === 'channel' ? '/channels' : job.targetKind === 'video' ? '/videos' : '/users';
  return `${base}/${encodeURIComponent(job.targetId)}`;
}
