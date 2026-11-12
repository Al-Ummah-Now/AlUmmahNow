/**
 * Which source a play gets: Bunny or R2 + Cloudflare CDN (epic #687).
 *
 * The API keeps `playUrl` as Bunny's (every client that knows nothing else
 * keeps working) and adds `delivery`:
 *   source 'bunny' | 'r2'  decided by the API (stable per video)
 *   source 'draw'          drawn here, once per player load, with r2Percent
 * R2 URLs are only present when the R2 rendition is ready. A fatal R2 error
 * falls back to Bunny once (see useDeliveryPlayer in VideoPagePlayer).
 */
export interface DeliveryView {
  source: 'bunny' | 'r2' | 'draw';
  r2Percent: number;
  r2?: { playUrl: string; thumbnailUrl: string };
}

export interface DeliveryChoice {
  provider: 'bunny' | 'r2';
  src: string;
  /** Bunny's URL, when the choice is R2 */
  fallbackSrc?: string;
  poster?: string;
}

export function chooseDelivery(
  playUrl: string | undefined,
  delivery: DeliveryView | undefined,
  random: () => number = Math.random,
): DeliveryChoice {
  const bunny: DeliveryChoice = { provider: 'bunny', src: playUrl || '' };
  const r2 = delivery?.r2;
  if (!delivery || !r2?.playUrl) return bunny;
  const useR2 = delivery.source === 'r2' || (delivery.source === 'draw' && random() * 100 < delivery.r2Percent);
  if (!useR2) return bunny;
  return { provider: 'r2', src: r2.playUrl, ...(playUrl ? { fallbackSrc: playUrl } : {}), poster: r2.thumbnailUrl };
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
