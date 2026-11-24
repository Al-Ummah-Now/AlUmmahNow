import type { WatchHistoryPage } from '@/services/api/watch-history';

/**
 * Normalizes a GET /api/watch-history response into a safe WatchHistoryPage.
 * Pure and free of client-only imports so both WatchHistoryService (browser)
 * and getHomeLibrary (server) share one implementation.
 */
export function parseWatchHistoryPage(body: unknown): { page: WatchHistoryPage; malformed: boolean; entriesType: string } {
  const raw = (body && typeof body === 'object' ? body : {}) as Partial<WatchHistoryPage>;
  if (!Array.isArray(raw.entries)) {
    return {
      page: { entries: [], total: 0, hasMore: false },
      malformed: true,
      entriesType: raw.entries === null ? 'null' : typeof raw.entries,
    };
  }
  return {
    page: {
      ...raw,
      entries: raw.entries,
      total: typeof raw.total === 'number' ? raw.total : raw.entries.length,
      hasMore: raw.hasMore === true,
    } as WatchHistoryPage,
    malformed: false,
    entriesType: 'array',
  };
}
