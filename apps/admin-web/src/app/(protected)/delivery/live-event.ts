/**
 * The admin:media `live` event (api-videos r2-delivery.ts pushMediaLive) as the
 * Delivery page's live figures. Pure, so it is unit tested.
 */
import type { AdminLiveEvent } from '@al-ummah/shared-types';
import type { MediaLive } from '@/lib/api/types';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The figures an event carries, or null when it is not a well-formed `live` event. */
export function mediaLiveFromEvent(e: AdminLiveEvent): MediaLive | null {
  if (e.kind !== 'live' || e.truncated) return null;
  const transcoding = num(e.transcoding);
  const queued = num(e.queued);
  const at = typeof e.at === 'string' ? e.at : null;
  if (transcoding === null || queued === null || !at) return null;
  const oldestQueuedAt = typeof e.oldestQueuedAt === 'string' ? e.oldestQueuedAt : null;
  const age = oldestQueuedAt ? Math.round((Date.parse(at) - Date.parse(oldestQueuedAt)) / 1000) : NaN;
  return {
    transcoding,
    queued,
    maxTranscodes: num(e.maxTranscodes),
    oldestQueuedAt,
    oldestQueuedSeconds: Number.isFinite(age) ? Math.max(0, age) : null,
    at,
  };
}
