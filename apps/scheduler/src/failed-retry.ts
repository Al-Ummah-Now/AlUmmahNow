/**
 * Retry of a scheduled publish that failed for good, from the admin Errors
 * page: admin-api (service binding SCHEDULER) POSTs /failed/retry with the
 * internal API key. The entry moves from failed/ back onto the schedule,
 * due now, with a fresh retry count; the next cron run publishes it.
 */
import type { ScheduledVideoMetadata } from '@al-ummah/shared-types';
import type { Env } from './types';
import { buildScheduleKey, FAILED_PREFIX } from './publisher';
import { logger } from './lib/logger';

export type FailedRetryOutcome = 'rescheduled' | 'not_found';

/** Needs-action key of a scheduled publish that failed for good. */
export function scheduledPublishKey(videoId: string): string {
  return `scheduled-publish:${videoId}`.slice(0, 160);
}

export async function retryFailedSchedule(
  bucket: R2Bucket,
  input: { videoId: string; scheduledPublishDate: string },
  now = new Date()
): Promise<FailedRetryOutcome> {
  const when = new Date(input.scheduledPublishDate);
  if (Number.isNaN(when.getTime())) return 'not_found';
  const failedKey = `${FAILED_PREFIX}${buildScheduleKey(when, input.videoId)}`;
  const entry = await bucket.get(failedKey);
  if (!entry) return 'not_found';
  const metadata = (await entry.json()) as ScheduledVideoMetadata;
  // Back on the schedule: the last failure is cleared
  const next: ScheduledVideoMetadata = { ...metadata, retryCount: 0, scheduledPublishDate: now.toISOString() };
  delete next.error;
  // New entry first, then remove the failed one: a crash in between leaves both (publishing is idempotent)
  await bucket.put(buildScheduleKey(now, input.videoId), JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  await bucket.delete(failedKey);
  logger.info(`Failed schedule of video ${input.videoId} put back on the schedule by an admin`);
  return 'rescheduled';
}

async function resolveKey(binding: Env['INTERNAL_API_KEY']): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) || '';
  } catch {
    return '';
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Internal HTTP API of the scheduler (service binding only; it has no routes). */
export async function handleSchedulerRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/failed/retry') return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const expected = await resolveKey(env.INTERNAL_API_KEY);
  const given = request.headers.get('X-API-Key') ?? '';
  let diff = expected.length === given.length && expected ? 0 : 1;
  for (let i = 0; i < Math.min(expected.length, given.length); i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  if (diff !== 0) return json({ error: 'Unauthorized' }, 401);

  const body = (await request.json().catch(() => null)) as { videoId?: unknown; scheduledPublishDate?: unknown } | null;
  if (!body || typeof body.videoId !== 'string' || !/^[\w-]{1,64}$/.test(body.videoId) || typeof body.scheduledPublishDate !== 'string') {
    return json({ error: 'videoId and scheduledPublishDate are required' }, 400);
  }
  const outcome = await retryFailedSchedule(env.SCHEDULED_VIDEOS, { videoId: body.videoId, scheduledPublishDate: body.scheduledPublishDate });
  return json({ status: outcome }, outcome === 'rescheduled' ? 200 : 404);
}
