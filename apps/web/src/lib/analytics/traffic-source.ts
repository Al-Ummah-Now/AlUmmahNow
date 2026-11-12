/**
 * Where a view came from (docs/specs/CREATOR-STUDIO.md §8.4). `document.referrer`
 * doesn't change on in-app navigation, so the previous page is tracked in
 * memory. Nothing here is stored, and only analytics-consented batches carry it.
 */

import { isTrafficSource, normalizeReferrerHost, type AnalyticsContext, type ViewTrafficSource } from '@al-ummah/shared-types';

export interface TrafficContext {
  trafficSource: ViewTrafficSource;
  referrerHost?: string;
}

/** What the browser says about this page. */
export interface PageInfo {
  referrer: string;
  hostname: string;
  host: string;
}

const SECTION_SOURCES: Record<string, ViewTrafficSource> = {
  search: 'search',
  feed: 'subscriptions',
  subscriptions: 'subscriptions',
  channels: 'channel',
  c: 'channel',
  playlist: 'playlist',
  video: 'up_next',
  explore: 'explore',
  library: 'library',
  history: 'library',
  notifications: 'notification',
};

/** A page of our own site. Pages that aren't a way to discover videos count as direct. */
export function classifyInternalPath(pathname: string): ViewTrafficSource {
  const section = pathname.split('/').filter(Boolean)[1];
  if (!section) return 'home';
  if (section.startsWith('@')) return 'channel';
  return SECTION_SOURCES[section] ?? 'direct';
}

function registrableDomain(hostname: string): string {
  return hostname.split('.').slice(-2).join('.');
}

function fromReferrer(page: PageInfo): TrafficContext {
  let referrer: URL;
  try {
    referrer = new URL(page.referrer);
  } catch {
    return { trafficSource: 'direct' };
  }
  if (referrer.host === page.host) return { trafficSource: classifyInternalPath(referrer.pathname) };
  if (registrableDomain(referrer.hostname) === registrableDomain(page.hostname)) return { trafficSource: 'direct' };
  const referrerHost = normalizeReferrerHost(referrer.hostname);
  return referrerHost ? { trafficSource: 'external', referrerHost } : { trafficSource: 'external' };
}

export function createTrafficTracker() {
  let current: string | null = null;
  let previous: string | null = null;
  let lastVideo: { id: string; context: TrafficContext } | null = null;

  return {
    record(pathname: string): void {
      if (pathname === current) return;
      previous = current;
      current = pathname;
      if (classifyInternalPath(pathname) !== 'up_next') lastVideo = null;
    },

    resolve(pathname: string, videoId: string, page: PageInfo): TrafficContext {
      if (lastVideo?.id === videoId) return lastVideo.context;
      let context: TrafficContext;
      if (lastVideo) {
        context = { trafficSource: 'up_next' };
      } else {
        // The player can resolve before the layout has recorded this navigation
        const origin = current === pathname ? previous : current;
        context = origin ? { trafficSource: classifyInternalPath(origin) } : fromReferrer(page);
      }
      lastVideo = { id: videoId, context };
      return context;
    },
  };
}

const tracker = createTrafficTracker();

export function recordNavigation(pathname: string): void {
  tracker.record(pathname);
}

/** The analytics context of a player: an embed keeps its own, the watch page resolves its source. */
export function playerAnalyticsContext(embedContext: AnalyticsContext | undefined, videoId: string, autoplay = false): AnalyticsContext {
  const auto = autoplay ? { autoplay: true } : {};
  if (embedContext) return { ...embedContext, trafficSource: 'embed', ...auto };
  if (typeof window === 'undefined') return { source: 'watch', ...auto };
  const { hostname, host, pathname } = window.location;
  return { source: 'watch', ...tracker.resolve(pathname, videoId, { referrer: document.referrer, hostname, host }), ...auto };
}

/** Validates the source a batch claims before it is forwarded to the API. */
export function trafficFromBatch(context: unknown): Partial<TrafficContext> {
  if (!context || typeof context !== 'object') return {};
  const { trafficSource, referrerHost } = context as { trafficSource?: unknown; referrerHost?: unknown };
  if (!isTrafficSource(trafficSource)) return {};
  if (trafficSource !== 'external') return { trafficSource };
  const host = normalizeReferrerHost(referrerHost);
  return host ? { trafficSource, referrerHost: host } : { trafficSource };
}
