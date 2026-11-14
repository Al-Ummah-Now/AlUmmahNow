/**
 * Delivery on the web (epic #687, docs/media-delivery/PROVIDERS.md): the API decides the order and
 * returns every playable source, signed, in that order (`sources`; `playUrl` is the first). Players
 * never choose: they play the first and, when it fails, the next one, reporting each failure to
 * GET /api/videos/:id/playback?exclude=<failed…>&reason=<code> (provider health). When the list runs
 * out (or an older response had none), that request's answer is the next thing to play.
 */
import { isMediaProviderId, type MediaProviderId, type PlaybackFallbackReason, type PlaybackSource, type PlaybackSourceView } from '@al-ummah/shared-types';

export interface DeliveryView {
  source: PlaybackSource;
}

const HLS_TYPE = 'application/x-mpegURL';
const MAX_SOURCES = 8;

/** The `sources` of an API response, keeping only well-formed entries (https, known provider, once each). */
export function playbackSourcesOf(value: unknown): PlaybackSourceView[] {
  if (!Array.isArray(value)) return [];
  const out: PlaybackSourceView[] = [];
  for (const item of value) {
    const s = item as { provider?: unknown; src?: unknown } | null;
    if (!s || !isMediaProviderId(s.provider) || typeof s.src !== 'string' || !s.src.startsWith('https://')) continue;
    if (out.some((o) => o.provider === s.provider)) continue;
    out.push({ provider: s.provider, src: s.src, type: HLS_TYPE });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

/**
 * What a player plays, in order: the API's `sources`, else the single `playUrl` labelled with
 * `delivery.source` (older responses).
 */
export function playbackList(o: { playUrl?: string; sources?: PlaybackSourceView[]; delivery?: { source?: string } }): PlaybackSourceView[] {
  if (o.sources?.length) return o.sources;
  if (!o.playUrl) return [];
  const provider: MediaProviderId = isMediaProviderId(o.delivery?.source) ? o.delivery.source : 'bunny';
  return [{ provider, src: o.playUrl, type: HLS_TYPE }];
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
