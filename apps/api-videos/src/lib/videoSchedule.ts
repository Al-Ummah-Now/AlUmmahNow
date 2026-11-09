import type { ScheduledVideoMetadata, VideoObject } from '@al-ummah/shared-types';
import Queue, { MessageType } from './queue';

const MIN_LEAD_MS = 5 * 60 * 1000;
const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;

export type ScheduleDateProblem = 'invalid' | 'too_soon' | 'too_far';

export function scheduleDateProblem(date: Date, now: Date): ScheduleDateProblem | null {
  if (Number.isNaN(date.getTime())) return 'invalid';
  if (date.getTime() < now.getTime() + MIN_LEAD_MS) return 'too_soon';
  if (date.getTime() > now.getTime() + MAX_LEAD_MS) return 'too_far';
  return null;
}

/** Date as the viewer's zone shows it; falls back to UTC for an unknown zone. */
export function formatLocalDate(date: Date, timezone: string): string {
  try {
    return date.toLocaleString('en-US', { timeZone: timezone });
  } catch {
    return date.toISOString();
  }
}

/** Why a video can't be scheduled, checked on the fresh copy inside a conditional write. */
export function scheduleRefusal(video: VideoObject): 'Already published' | 'Already scheduled' | null {
  if (video.isPublic) return 'Already published';
  if (video.scheduledPublishStatus === 'scheduled' || video.scheduledPublishStatus === 'publishing') return 'Already scheduled';
  return null;
}

/** Marks the fresh copy scheduled (run it inside R2Repository.updateObjectOrReject). */
export function applySchedule(video: VideoObject, options: { date: Date; timezone: string; userId: string; now: Date }): void {
  video.scheduledPublishDate = options.date.toISOString();
  video.scheduledPublishTimezone = options.timezone;
  video.scheduledPublishStatus = 'scheduled';
  video.scheduledBy = options.userId;
  video.scheduledAt = options.now.toISOString();
  video.isDraft = false;
}

/** Tells the scheduler worker about a schedule already saved on the video, and queues the event. */
export async function announceSchedule(
  env: { queue: unknown; SCHEDULED_VIDEOS?: unknown; [binding: string]: unknown },
  video: VideoObject,
  options: { date: Date; timezone: string; notifyOnPublish: boolean; userId: string },
): Promise<void> {
  const { date, timezone, notifyOnPublish, userId } = options;
  const metadata: ScheduledVideoMetadata = {
    videoId: video.id,
    title: video.title,
    channelId: video.channelId || '',
    userId: video.userId,
    scheduledPublishDate: date.toISOString(),
    timezone,
    localScheduledDate: formatLocalDate(date, timezone),
    notifyOnPublish,
    retryCount: 0,
  };

  const bucket = (env.SCHEDULED_VIDEOS || env['scheduled-videos']) as R2Bucket | undefined;
  if (!bucket) throw new Error('Scheduled videos bucket not configured');
  const pad = (value: number) => String(value).padStart(2, '0');
  const key = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}/${pad(date.getUTCHours())}/${video.id}.json`;
  await bucket.put(key, JSON.stringify(metadata), { httpMetadata: { contentType: 'application/json' } });

  await new Queue(env.queue as never).send(MessageType.VideoEdit, {
    videoId: video.id,
    userId,
    channelId: video.channelId,
    timestamp: new Date().toISOString(),
    action: 'schedule',
    scheduledDate: date.toISOString(),
  });
}
