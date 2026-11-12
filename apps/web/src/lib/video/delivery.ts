/**
 * Delivery on the web (epic #687, owner decision 2026-11-12): the API decides the source and returns
 * ONE playUrl; players never choose. `delivery.source` is only a label (QoE, the admin Source row).
 * When the URL fails in the player, it asks the API once for a URL without R2
 * (fetchFallbackPlayback → GET /api/videos/:id/playback?exclude=r2&reason=<code>).
 */
import type { PlaybackFallbackReason, PlaybackSource } from '@al-ummah/shared-types';

export interface DeliveryView {
  source: PlaybackSource;
}

/** The parts of a Video.js MediaError and VHS state the classifier reads. */
export interface PlayerErrorInfo {
  /** MediaError code: 1 aborted, 2 network, 3 decode, 4 source not supported */
  code?: number;
  /** HTTP status of VHS's last failed playlist request, when known (0 = blocked, e.g. CORS) */
  status?: number;
}

/** The fallback reason for a player error (sent to the API and in the QoE beacon). */
export function fallbackReasonFor(info: PlayerErrorInfo): PlaybackFallbackReason {
  const { code, status } = info;
  if (typeof status === 'number') {
    if (status >= 500) return 'manifest_5xx';
    if (status >= 400) return 'manifest_4xx';
    if (status === 0 && code === 2) return 'cors';
  }
  if (code === 2) return 'network';
  if (code === 3) return 'decode';
  if (code === 4) return 'unsupported';
  return 'other';
}

export type DeviceClass = 'desktop' | 'mobile' | 'tablet' | 'tv' | 'other';

export function deviceClass(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): DeviceClass {
  const s = ua.toLowerCase();
  if (/smart-?tv|tizen|webos|appletv|android tv|bravia|hbbtv/.test(s)) return 'tv';
  if (/ipad|tablet|(android(?!.*mobile))/.test(s)) return 'tablet';
  if (/mobi|iphone|ipod|android/.test(s)) return 'mobile';
  if (/windows|macintosh|linux|cros/.test(s)) return 'desktop';
  return 'other';
}
