/**
 * Index Initialization Helper
 * Provides utilities to initialize or rebuild video section indices
 */

import { VideoObject } from '@al-ummah/shared-types';
import { IndexManager } from './indexManager';
import { processTrendingVideos } from './trendingAlgorithm';
import { logger } from './logger';

/** Minimal D1 surface the rebuild reads. */
export interface IndexSourceDb {
  prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
}

/** Most category indices one rebuild writes (each one R2 put). */
export const MAX_CATEGORIES = 50;
const TOP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Candidate videos for every index, read from the search index (SCALABILITY-AUDIT AA-4).
 *
 * The rebuild used to list the whole videos bucket and GET every object: past
 * ~1000 objects one invocation ran out of subrequests, past 5000 it silently
 * built from a truncated set, and every video (with its embedded comments)
 * was held in memory. The search index already holds each public, ready
 * video's id, title, thumbnail, views, likes, category, channel and date, so
 * each index is now its own bounded query: a few D1 reads and at most a few
 * thousand small rows, however many videos exist. Only searchable videos
 * (public, ready, not hidden or removed) can appear, as on the site.
 */
export async function loadIndexCandidates(db: IndexSourceDb, now = Date.now()): Promise<{ videos: VideoObject[]; categories: string[] }> {
  const rows = async (where: string, order: string, limit: number, ...binds: unknown[]) =>
    (await db
      .prepare(`SELECT payload FROM search_videos WHERE visible = 1 ${where} ORDER BY ${order} LIMIT ?`)
      .bind(...binds, limit)
      .all<{ payload: string }>()).results ?? [];

  const categoryRows = (await db
    .prepare(`SELECT category FROM search_videos WHERE visible = 1 AND category IS NOT NULL AND category <> ''
              GROUP BY category ORDER BY COUNT(*) DESC LIMIT ?`)
    .bind(MAX_CATEGORIES)
    .all<{ category: string }>()).results ?? [];
  const categories = categoryRows.map((r) => r.category);

  const batches = await Promise.all([
    rows('', 'created_at DESC', TOP),                                              // recent
    rows('', 'views DESC', TOP),                                                   // popular: all
    rows('AND created_at >= ?', 'views DESC', TOP, now - 30 * DAY_MS),             // popular: monthly
    rows('AND created_at >= ?', 'views DESC', TOP, now - 7 * DAY_MS),              // popular: weekly
    rows('AND created_at >= ?', 'views DESC', TOP, now - DAY_MS),                  // popular: daily
    rows('AND created_at >= ?', 'views DESC', 1000, now - 30 * DAY_MS),            // trending candidates
    ...categories.map((c) => rows('AND category = ?', 'views + created_at / 1000000.0 DESC', TOP, c)),
  ]);

  const byId = new Map<string, VideoObject>();
  for (const batch of batches) {
    for (const { payload } of batch) {
      try {
        const p = JSON.parse(payload) as Record<string, unknown>;
        if (typeof p.id !== 'string' || byId.has(p.id)) continue;
        byId.set(p.id, {
          id: p.id,
          title: p.title,
          thumbnailUrl: p.thumbnailUrl,
          views: p.views ?? 0,
          likesCount: p.likesCount ?? 0,
          commentsCount: p.commentsCount ?? 0,
          category: p.category,
          channelId: p.channelId,
          dateCreated: p.dateCreated,
          isPublic: true,
        } as unknown as VideoObject);
      } catch {
        // a malformed row is skipped; the next backfill rewrites it
      }
    }
  }
  return { videos: [...byId.values()], categories };
}

function sourceOf(db: IndexSourceDb | undefined): IndexSourceDb {
  if (!db) throw new Error('SEARCH_DB is not bound: the section indices are built from the search index');
  return db;
}

/**
 * Initialize all video section indices
 */
export async function initializeAllIndices(videoBucket: R2Bucket, searchDb: IndexSourceDb | undefined): Promise<void> {
  logger.info('Starting index initialization');

  try {
    const { videos, categories } = await loadIndexCandidates(sourceOf(searchDb));
    logger.info(`Fetched ${videos.length} videos for indexing`);

    const indexManager = new IndexManager(videoBucket);

    // Create Recent Videos index
    await indexManager.updateRecentVideosIndex(videos);
    logger.info('Recent videos index created');

    // Create Popular Videos indices for different periods
    await indexManager.updatePopularVideosIndex(videos, 'all');
    await indexManager.updatePopularVideosIndex(videos, 'monthly');
    await indexManager.updatePopularVideosIndex(videos, 'weekly');
    await indexManager.updatePopularVideosIndex(videos, 'daily');
    logger.info('Popular videos indices created');

    // Create Trending Videos index
    const trendingVideos = processTrendingVideos(videos, 'hybrid', 100);
    await indexManager.saveIndex({
      id: 'index:trending-videos',
      lastUpdated: new Date().toISOString(),
      algorithm: 'hybrid',
      videos: trendingVideos.map(t => ({
        videoId: t.videoId,
        trendingScore: t.trendingScore,
        viewsVelocity: t.viewsVelocity,
        engagementVelocity: t.engagementVelocity,
        dateCreated: t.dateCreated,
        title: t.title,
        thumbnailUrl: t.thumbnailUrl,
        channelId: t.channelId,
        views: t.views,
        likesCount: t.likesCount,
      })),
    });
    logger.info('Trending videos index created');

    // Create Category indices
    for (const category of categories) {
      await indexManager.updateCategoryVideosIndex(videos, category);
    }
    logger.info(`Created ${categories.length} category indices`);

    // Update index metadata
    await indexManager.updateIndexMetadata({
      recent: new Date().toISOString(),
      popularAll: new Date().toISOString(),
      popularMonthly: new Date().toISOString(),
      popularWeekly: new Date().toISOString(),
      popularDaily: new Date().toISOString(),
      trending: new Date().toISOString(),
      categories: categories.reduce((acc, cat) => {
        acc[cat] = new Date().toISOString();
        return acc;
      }, {} as Record<string, string>),
    });

    logger.info('All indices initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize indices', { error });
    throw error;
  }
}

/**
 * Rebuild a specific index type
 */
export async function rebuildIndex(
  videoBucket: R2Bucket,
  searchDb: IndexSourceDb | undefined,
  indexType: 'recent' | 'popular' | 'trending' | 'categories',
  period?: 'all' | 'monthly' | 'weekly' | 'daily'
): Promise<void> {
  logger.info(`Rebuilding ${indexType} index`, { period });

  const { videos, categories } = await loadIndexCandidates(sourceOf(searchDb));
  const indexManager = new IndexManager(videoBucket);

  switch (indexType) {
    case 'recent':
      await indexManager.updateRecentVideosIndex(videos);
      break;

    case 'popular':
      if (period) {
        await indexManager.updatePopularVideosIndex(videos, period);
      } else {
        await indexManager.updatePopularVideosIndex(videos, 'all');
        await indexManager.updatePopularVideosIndex(videos, 'monthly');
        await indexManager.updatePopularVideosIndex(videos, 'weekly');
        await indexManager.updatePopularVideosIndex(videos, 'daily');
      }
      break;

    case 'trending':
      const trendingVideos = processTrendingVideos(videos, 'hybrid', 100);
      await indexManager.saveIndex({
        id: 'index:trending-videos',
        lastUpdated: new Date().toISOString(),
        algorithm: 'hybrid',
        videos: trendingVideos.map(t => ({
          videoId: t.videoId,
          trendingScore: t.trendingScore,
          viewsVelocity: t.viewsVelocity,
          engagementVelocity: t.engagementVelocity,
          dateCreated: t.dateCreated,
          title: t.title,
          thumbnailUrl: t.thumbnailUrl,
          channelId: t.channelId,
          views: t.views,
          likesCount: t.likesCount,
        })),
      });
      break;

    case 'categories':
      for (const category of categories) {
        await indexManager.updateCategoryVideosIndex(videos, category);
      }
      break;
  }

  logger.info(`${indexType} index rebuilt successfully`);
}

/**
 * Get index statistics
 */
export async function getIndexStats(videoBucket: R2Bucket, searchDb?: IndexSourceDb): Promise<{
  indices: Array<{
    name: string;
    lastUpdated: string;
    count: number;
    stale: boolean;
  }>;
  totalVideos: number;
}> {
  const indexManager = new IndexManager(videoBucket);
  const stats: any = { indices: [], totalVideos: 0 };

  // Check recent index
  const recentIndex = await indexManager.getRecentVideosIndex();
  if (recentIndex) {
    stats.indices.push({
      name: 'recent',
      lastUpdated: recentIndex.lastUpdated,
      count: recentIndex.videos.length,
      stale: indexManager.isIndexStale(recentIndex.lastUpdated, 5),
    });
  }

  // Check popular indices
  const periods: Array<'all' | 'monthly' | 'weekly' | 'daily'> = ['all', 'monthly', 'weekly', 'daily'];
  for (const period of periods) {
    const popularIndex = await indexManager.getPopularVideosIndex(period);
    if (popularIndex) {
      stats.indices.push({
        name: `popular-${period}`,
        lastUpdated: popularIndex.lastUpdated,
        count: popularIndex.videos.length,
        stale: indexManager.isIndexStale(popularIndex.lastUpdated, 30),
      });
    }
  }

  // Check trending index
  const trendingIndex = await indexManager.getTrendingVideosIndex();
  if (trendingIndex) {
    stats.indices.push({
      name: 'trending',
      lastUpdated: trendingIndex.lastUpdated,
      count: trendingIndex.videos.length,
      stale: indexManager.isIndexStale(trendingIndex.lastUpdated, 15),
    });
  }

  // Count of indexable videos: one D1 count instead of reading every video
  if (searchDb) {
    const count = (await searchDb.prepare('SELECT COUNT(*) AS n FROM search_videos WHERE visible = 1').bind().all<{ n: number }>()).results?.[0];
    stats.totalVideos = Number(count?.n ?? 0);
  }

  return stats;
}
