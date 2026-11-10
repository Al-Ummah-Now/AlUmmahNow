/**
 * Pure helpers for admin jobs (no React, no server actions), shared by the
 * jobs UI and its tests.
 */
import { ADMIN_JOB_PERMISSIONS, type AdminContentPermission, type AdminJob } from '@al-ummah/shared-types';
import type { ChipTone } from './parts';

const ACTIVE = new Set(['queued', 'running', 'retrying']);

export const isActiveJob = (job: Pick<AdminJob, 'status'>) => ACTIVE.has(job.status);

export function jobTone(status: AdminJob['status']): ChipTone {
  if (status === 'failed') return 'bad';
  if (status === 'retrying') return 'warn';
  if (status === 'succeeded') return 'good';
  return 'info';
}

/** Retrying re-runs the action, so it needs that action's permissions. */
export function canRetryJob(job: Pick<AdminJob, 'kind'>, permissions: readonly AdminContentPermission[]): boolean {
  const needed = ADMIN_JOB_PERMISSIONS[job.kind] ?? ['content:delete'];
  return needed.every((p) => permissions.includes(p));
}

export function jobTargetHref(job: Pick<AdminJob, 'targetKind' | 'targetId'>): string {
  const base = job.targetKind === 'channel' ? '/channels' : job.targetKind === 'video' ? '/videos' : '/users';
  return `${base}/${encodeURIComponent(job.targetId)}`;
}
