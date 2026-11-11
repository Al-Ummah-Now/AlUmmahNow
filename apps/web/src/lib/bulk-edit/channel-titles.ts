'use client';

/**
 * Every title already on a channel (both languages), for "Continue numbering
 * after" in the bulk rename. Reads Studio's content list, all statuses at
 * once, a few pages each, every request with a time limit: titles that came
 * back in time are used even if a status was slow (QA, 2026-11-11: reading
 * the statuses one after another took over a minute).
 */
import type { StudioVideoStatus } from '@al-ummah/shared-types';
import { fetchContentPage, type ContentPage } from '@/lib/studio/content-client';
import { logger } from '@/lib/logger-client';

const STATUSES: StudioVideoStatus[] = ['published', 'scheduled', 'drafts', 'processing', 'failed'];
export const PAGES_PER_STATUS = 3;
export const REQUEST_TIMEOUT_MS = 12_000;

type PageLoader = (channelId: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) => Promise<ContentPage>;

async function pageWithin(load: PageLoader, channelId: string, params: Record<string, string | number | undefined>, ms: number): Promise<ContentPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await load(channelId, params, controller.signal);
  } catch (error) {
    logger.warn('[BulkRename] A page of channel titles was not read', { status: params.status, timedOut: controller.signal.aborted, error: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadChannelTitles(
  channelId: string,
  exclude: ReadonlySet<string> = new Set(),
  options: { load?: PageLoader; timeoutMs?: number } = {},
): Promise<string[]> {
  const load = options.load ?? fetchContentPage;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const perStatus = await Promise.all(STATUSES.map(async (status) => {
    const titles: string[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < PAGES_PER_STATUS; page++) {
      const result = await pageWithin(load, channelId, { status, cursor: cursor ?? undefined, limit: 100 }, timeoutMs);
      if (!result) break;
      for (const v of result.items) {
        if (exclude.has(v.id)) continue;
        titles.push(v.title, ...Object.values(v.titleLocalized ?? {}));
      }
      cursor = result.cursor;
      if (!cursor) break;
    }
    return titles;
  }));
  const titles = perStatus.flat().filter((t): t is string => typeof t === 'string' && t.length > 0);
  logger.info('[BulkRename] Read channel titles for numbering', { channelId, count: titles.length });
  return titles;
}
