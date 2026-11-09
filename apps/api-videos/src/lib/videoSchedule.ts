import type { ScheduledVideoMetadata, VideoObject } from '@al-ummah/shared-types';
import Queue, { MessageType } from './queue';
import type R2Repository from './r2Repo';

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

/** Marks the video scheduled, tells the scheduler worker, and queues the event. */
export async function writeSchedule(
  env: { queue: unknown; SCHEDULED_VIDEOS?: unknown; [binding: string]: unknown },
  repository: R2Repository<VideoObject>,
  video: VideoObject,
  options: { date: Date; timezone: string; notifyOnPublish: boolean; userId: string; now: Date },
): Promise<void> {
  const { date, timezone, notifyOnPublish, userId, now } = options;
  video.scheduledPublishDate = date.toISOString();
  video.scheduledPublishTimezone = timezone;
  video.scheduledPublishStatus = 'scheduled';
  video.scheduledBy = userId;
  video.scheduledAt = now.toISOString();
  video.isDraft = false;
  await repository.putObject(video.id, video);

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
