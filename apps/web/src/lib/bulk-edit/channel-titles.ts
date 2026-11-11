'use client';

/**
 * Every title already on a channel (both languages), for "Continue numbering
 * after" in the bulk rename. Reads Studio's content list status by status,
 * bounded, leaving out the videos being renamed.
 */
import type { StudioVideoStatus } from '@al-ummah/shared-types';
import { fetchContentPage } from '@/lib/studio/content-client';
import { logger } from '@/lib/logger-client';

const STATUSES: StudioVideoStatus[] = ['published', 'scheduled', 'drafts', 'processing', 'failed'];
const PAGES_PER_STATUS = 5;

export async function loadChannelTitles(channelId: string, exclude: ReadonlySet<string> = new Set()): Promise<string[]> {
  const titles: string[] = [];
  for (const status of STATUSES) {
    let cursor: string | null | undefined;
    for (let page = 0; page < PAGES_PER_STATUS; page++) {
      const result = await fetchContentPage(channelId, { status, cursor: cursor ?? undefined, limit: 100 });
      for (const v of result.items) {
        if (exclude.has(v.id)) continue;
        titles.push(v.title, ...Object.values(v.titleLocalized ?? {}));
      }
      cursor = result.cursor;
      if (!cursor) break;
    }
  }
  logger.info('[BulkRename] Read channel titles for numbering', { channelId, count: titles.length });
  return titles.filter((t): t is string => typeof t === 'string' && t.length > 0);
}
