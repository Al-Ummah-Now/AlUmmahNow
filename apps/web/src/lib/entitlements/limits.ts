/** Reads plan limits for display (Epic 27). The API is what enforces them; a missing view means no hint. */

export const UNLIMITED = 'unlimited';

export interface EntitlementsView {
  plan: { slug: string; name_en: string; name_ar: string } | null;
  entitlements: Record<string, { value: boolean | number | string | string[]; source: string }>;
  usage: Record<string, { current: number; limit: number | typeof UNLIMITED; warning: boolean }>;
  degraded?: boolean;
}

export const BYTES_PER_GB = 1_000_000_000;
/** Shown while the plan has not loaded; the API has the final say. */
export const DEFAULT_MAX_CHANNEL_LINKS = 10;

export function numericLimit(view: EntitlementsView | null, key: string): number | null {
  const value = view?.entitlements[key]?.value;
  return typeof value === 'number' ? value : null;
}

/**
 * How many link rows the editor may show. A channel already above its limit
 * keeps its links (grandfathering), so the ceiling is never below what it has.
 */
export function maxLinksFor(view: EntitlementsView | null, currentCount: number): number {
  if (!view) return Math.max(DEFAULT_MAX_CHANNEL_LINKS, currentCount);
  const limit = numericLimit(view, 'channel.about.links.max');
  return limit === null ? Number.MAX_SAFE_INTEGER : Math.max(limit, currentCount);
}

export type UploadBlock = 'uploads' | 'storage' | 'duration';

/** The first limit a new upload would break, or null. Unknown values never block. */
export function uploadBlock(view: EntitlementsView | null, upload: { count: number; bytes: number; maxSeconds?: number }): UploadBlock | null {
  if (!view || view.degraded) return null;
  const minutes = numericLimit(view, 'upload.maxDurationMinutes');
  if (minutes !== null && upload.maxSeconds !== undefined && upload.maxSeconds > minutes * 60) return 'duration';
  const uploads = view.usage['upload.monthlyUploads'];
  if (uploads && uploads.limit !== UNLIMITED && uploads.current + upload.count > uploads.limit) return 'uploads';
  const storage = view.usage['storage.gb'];
  if (storage && storage.limit !== UNLIMITED && storage.current + upload.bytes / BYTES_PER_GB > storage.limit) return 'storage';
  return null;
}

/** A video file's length in seconds, or undefined when the browser cannot tell. */
export function readVideoDuration(file: File, timeoutMs = 5000): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const finish = (value?: number) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined);
    video.onerror = () => finish();
    video.src = url;
  });
}
