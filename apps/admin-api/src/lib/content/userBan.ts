/**
 * The one videos user ban path: Users → Ban (content.router.ts) and a report's
 * `banned` outcome (lib/moderation/reportDecision.ts) both come here.
 *
 * The caller has checked the users:manage permission. The audit row goes in
 * first and is dropped again if api-videos refuses, so the log never misses a
 * ban and never records one that did not happen (same rule as `audited` in
 * content.router.ts). api-videos writes the ban and queues the job that hides
 * the user's channels, videos and live streams.
 */
import type { AdminJob, VideosBan } from '@al-ummah/shared-types';
import { callVideos, type VideosClientEnv } from './videosClient';
import { dropAudit, writeAudit } from './audit';
import { logger } from '../logger';

interface BanDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
}

export interface BanInput {
  userId: string;
  actorId: string;
  reason?: string | null;
  /** Extra audit details (the report that led to the ban). */
  details?: Record<string, unknown>;
}

export type BanResult = { ban: VideosBan; job: AdminJob };

export async function banVideosUser(env: VideosClientEnv & { REPORTS_DB: BanDb }, input: BanInput): Promise<BanResult> {
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, 1000) : undefined;
  const auditId = await writeAudit(env.REPORTS_DB, {
    kind: 'user',
    id: input.userId,
    action: 'ban',
    actorId: input.actorId,
    details: { reason: reason ?? null, ...(input.details ?? {}) },
  });
  try {
    const result = await callVideos<BanResult>(env, `/users/${encodeURIComponent(input.userId)}/ban`, {
      method: 'POST',
      json: { reason },
      actorId: input.actorId,
    });
    logger.info('[Content] Action', { kind: 'user', id: input.userId, action: 'ban', actorId: input.actorId });
    return result;
  } catch (error) {
    await dropAudit(env.REPORTS_DB, auditId).catch((e) => logger.error('[Content] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
}
