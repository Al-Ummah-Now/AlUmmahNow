/**
 * Index Initialization Helper
 * Provides utilities to initialize or rebuild video section indices
 */

import { VideoObject } from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import { IndexManager } from './indexManager';
import { processTrendingVideos } from './trendingAlgorithm';
import { logger } from './logger';

/**
 * Initialize all video section indices
 */
export async function initializeAllIndices(videoBucket: R2Bucket): Promise<void> {
  logger.info('Starting index initialization');

  try {
    const videos = await fetchAllVideos(videoBucket);
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
    const categories = getUniqueCategories(videos);
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
 * Fetch all videos from R2
 */
async function fetchAllVideos(videoBucket: R2Bucket): Promise<VideoObject[]> {
  const videoRepo = new R2Repository<VideoObject>(videoBucket);
  const allVideos: VideoObject[] = [];
  let cursor: string | undefined;
  let iterations = 0;
  const maxIterations = 50;

  while (iterations < maxIterations) {
    const result = await videoRepo.listObjects(100, cursor);
    allVideos.push(...(result.items || []));

    if (!result.cursor) break;
    cursor = result.cursor;
    iterations++;
  }

  return allVideos;
}

/**
 * Get unique categories from videos
 */
function getUniqueCategories(videos: VideoObject[]): string[] {
  const categories = new Set<string>();

  videos.forEach(video => {
    if (video.category) {
      categories.add(video.category);
    }
  });

  return Array.from(categories);
}

/**
 * Rebuild a specific index type
 */
export async function rebuildIndex(
  videoBucket: R2Bucket,
  indexType: 'recent' | 'popular' | 'trending' | 'categories',
  period?: 'all' | 'monthly' | 'weekly' | 'daily'
): Promise<void> {
  logger.info(`Rebuilding ${indexType} index`, { period });

  const videos = await fetchAllVideos(videoBucket);
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
      const categories = getUniqueCategories(videos);
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
export async function getIndexStats(videoBucket: R2Bucket): Promise<{
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

  // Count total videos
  const videos = await fetchAllVideos(videoBucket);
  stats.totalVideos = videos.length;

  return stats;
}
