/**
 * Index Manager for Video Sections
 * Manages pre-computed indices stored in R2 for efficient video section queries
 */

import { logger } from './logger';
import { VideoObject } from '@al-ummah/shared-types';

/**
 * Time-based index for recent videos
 */
export interface RecentVideosIndex {
  id: 'index:recent-videos';
  lastUpdated: string;
  videos: Array<{
    videoId: string;
    dateCreated: string;
    channelId: string;
    title: string;
    thumbnailUrl: string;
    views?: number;
  }>;
}

/**
 * Popularity index for different time periods
 */
export interface PopularVideosIndex {
  id: `index:popular-videos:${'all' | 'monthly' | 'weekly' | 'daily'}`;
  lastUpdated: string;
  period: 'all' | 'monthly' | 'weekly' | 'daily';
  videos: Array<{
    videoId: string;
    views: number;
    likesCount: number;
    engagementRate: number;
    dateCreated: string;
    title: string;
    thumbnailUrl: string;
    channelId: string;
  }>;
}

/**
 * Trending videos index
 */
export interface TrendingVideosIndex {
  id: 'index:trending-videos';
  lastUpdated: string;
  algorithm: 'velocity' | 'engagement' | 'hybrid';
  videos: Array<{
    videoId: string;
    trendingScore: number;
    viewsVelocity: number; // views per hour
    engagementVelocity: number; // engagement per hour
    dateCreated: string;
    title: string;
    thumbnailUrl: string;
    channelId: string;
    views: number;
    likesCount: number;
  }>;
}

/**
 * Category-specific video index
 */
export interface CategoryVideosIndex {
  id: `index:category:${string}`;
  category: string;
  lastUpdated: string;
  videos: Array<{
    videoId: string;
    dateCreated: string;
    views: number;
    likesCount: number;
    title: string;
    thumbnailUrl: string;
    channelId: string;
  }>;
}

/**
 * Index update metadata
 */
export interface IndexUpdateMetadata {
  id: 'metadata:last-index-update';
  recent: string;
  popularAll: string;
  popularMonthly: string;
  popularWeekly: string;
  popularDaily: string;
  trending: string;
  categories: Record<string, string>;
}

/**
 * Cache time-to-live values in seconds
 */
export const CACHE_TTL = {
  recent: 60,       // 1 minute (changes frequently)
  popular: 300,     // 5 minutes
  trending: 180,    // 3 minutes
  recommended: 300, // 5 minutes
  category: 600,    // 10 minutes
};

/**
 * Index staleness thresholds in minutes
 */
export const INDEX_STALENESS_THRESHOLD = {
  recent: 5,        // 5 minutes
  popular: 30,      // 30 minutes
  trending: 15,     // 15 minutes
  category: 60,     // 1 hour
};

/**
 * Index Manager class for handling pre-computed indices in R2
 */
export class IndexManager {
  constructor(private bucket: R2Bucket) {}

  /**
   * Get or create an index from R2
   */
  async getIndex<T>(indexId: string): Promise<T | null> {
    try {
      const object = await this.bucket.get(indexId);
      if (!object) {
        logger.info(`Index ${indexId} not found`);
        return null;
      }

      const index = await object.json<T>();
      return index;
    } catch (error) {
      logger.error(`Failed to get index ${indexId}`, { error });
      return null;
    }
  }

  /**
   * Save an index to R2
   */
  async saveIndex<T extends { id: string; lastUpdated: string }>(index: T): Promise<void> {
    try {
      index.lastUpdated = new Date().toISOString();
      await this.bucket.put(index.id, JSON.stringify(index), {
        httpMetadata: { contentType: 'application/json' },
      });
      logger.info(`Index ${index.id} saved successfully`);
    } catch (error) {
      logger.error(`Failed to save index ${index.id}`, { error });
      throw error;
    }
  }

  /**
   * Check if an index is stale based on its last update time
   */
  isIndexStale(lastUpdated: string, thresholdMinutes: number): boolean {
    const lastUpdateTime = new Date(lastUpdated).getTime();
    const now = Date.now();
    const ageInMinutes = (now - lastUpdateTime) / (1000 * 60);
    return ageInMinutes > thresholdMinutes;
  }

  /**
   * Get recent videos index
   */
  async getRecentVideosIndex(): Promise<RecentVideosIndex | null> {
    return this.getIndex<RecentVideosIndex>('index:recent-videos');
  }

  /**
   * Get popular videos index for a specific period
   */
  async getPopularVideosIndex(period: 'all' | 'monthly' | 'weekly' | 'daily' = 'all'): Promise<PopularVideosIndex | null> {
    const indexId = `index:popular-videos:${period}` as const;
    return this.getIndex<PopularVideosIndex>(indexId);
  }

  /**
   * Get trending videos index
   */
  async getTrendingVideosIndex(): Promise<TrendingVideosIndex | null> {
    return this.getIndex<TrendingVideosIndex>('index:trending-videos');
  }

  /**
   * Get category videos index
   */
  async getCategoryVideosIndex(category: string): Promise<CategoryVideosIndex | null> {
    const indexId = `index:category:${category}`;
    return this.getIndex<CategoryVideosIndex>(indexId);
  }

  /**
   * Update recent videos index from a list of videos
   */
  async updateRecentVideosIndex(videos: VideoObject[]): Promise<void> {
    // Sort by date created (newest first) and take top 100
    const sortedVideos = videos
      .filter(v => v.isPublic !== false) // Only public videos
      .sort((a, b) => {
        const dateA = new Date(a.dateCreated || 0).getTime();
        const dateB = new Date(b.dateCreated || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, 100);

    const index: RecentVideosIndex = {
      id: 'index:recent-videos',
      lastUpdated: new Date().toISOString(),
      videos: sortedVideos.map(v => ({
        videoId: v.id,
        dateCreated: v.dateCreated || new Date().toISOString(),
        channelId: v.channelId || '',
        title: v.title || '',
        thumbnailUrl: v.thumbnailUrl || '',
        views: v.views || 0,
      })),
    };

    await this.saveIndex(index);
  }

  /**
   * Update popular videos index for a specific period
   */
  async updatePopularVideosIndex(videos: VideoObject[], period: 'all' | 'monthly' | 'weekly' | 'daily' = 'all'): Promise<void> {
    // Filter videos based on period
    const now = Date.now();
    const filteredVideos = videos.filter(v => {
      if (v.isPublic === false) return false; // Only public videos
      if (period === 'all') return true;

      const videoDate = new Date(v.dateCreated || 0).getTime();
      const ageInDays = (now - videoDate) / (1000 * 60 * 60 * 24);

      switch (period) {
        case 'daily': return ageInDays <= 1;
        case 'weekly': return ageInDays <= 7;
        case 'monthly': return ageInDays <= 30;
        default: return true;
      }
    });

    // Calculate engagement rate and sort by views
    const videosWithMetrics = filteredVideos.map(v => {
      const views = v.views || 0;
      const likesCount = v.likesCount || 0;
      const commentsCount = v.commentsCount || 0;
      const engagementRate = views > 0 ? ((likesCount + commentsCount) / views) : 0;

      return {
        videoId: v.id,
        views,
        likesCount,
        engagementRate,
        dateCreated: v.dateCreated || new Date().toISOString(),
        title: v.title || '',
        thumbnailUrl: v.thumbnailUrl || '',
        channelId: v.channelId || '',
      };
    });

    // Sort by views and take top 100
    videosWithMetrics.sort((a, b) => b.views - a.views);

    const index: PopularVideosIndex = {
      id: `index:popular-videos:${period}`,
      lastUpdated: new Date().toISOString(),
      period,
      videos: videosWithMetrics.slice(0, 100),
    };

    await this.saveIndex(index);
  }

  /**
   * Update trending videos index
   */
  async updateTrendingVideosIndex(videos: VideoObject[], algorithm: 'velocity' | 'engagement' | 'hybrid' = 'hybrid'): Promise<void> {
    // This will be implemented using the trending algorithm
    // For now, we'll use a simple placeholder
    const videosWithScores = videos
      .filter(v => v.isPublic !== false) // Only public videos
      .map(v => ({
        videoId: v.id,
        trendingScore: 0, // Will be calculated by trending algorithm
        viewsVelocity: 0,
        engagementVelocity: 0,
        dateCreated: v.dateCreated || new Date().toISOString(),
        title: v.title || '',
        thumbnailUrl: v.thumbnailUrl || '',
        channelId: v.channelId || '',
        views: v.views || 0,
        likesCount: v.likesCount || 0,
      }));

    const index: TrendingVideosIndex = {
      id: 'index:trending-videos',
      lastUpdated: new Date().toISOString(),
      algorithm,
      videos: videosWithScores.slice(0, 100),
    };

    await this.saveIndex(index);
  }

  /**
   * Update category videos index
   */
  async updateCategoryVideosIndex(videos: VideoObject[], category: string): Promise<void> {
    // Filter videos by category
    const categoryVideos = videos
      .filter(v => v.isPublic !== false && v.category === category)
      .sort((a, b) => {
        // Sort by a combination of recency and popularity
        const scoreA = (a.views || 0) + (new Date(a.dateCreated || 0).getTime() / 1000000);
        const scoreB = (b.views || 0) + (new Date(b.dateCreated || 0).getTime() / 1000000);
        return scoreB - scoreA;
      })
      .slice(0, 100);

    const index: CategoryVideosIndex = {
      id: `index:category:${category}`,
      category,
      lastUpdated: new Date().toISOString(),
      videos: categoryVideos.map(v => ({
        videoId: v.id,
        dateCreated: v.dateCreated || new Date().toISOString(),
        views: v.views || 0,
        likesCount: v.likesCount || 0,
        title: v.title || '',
        thumbnailUrl: v.thumbnailUrl || '',
        channelId: v.channelId || '',
      })),
    };

    await this.saveIndex(index);
  }

  /**
   * Get index update metadata
   */
  async getIndexUpdateMetadata(): Promise<IndexUpdateMetadata | null> {
    return this.getIndex<IndexUpdateMetadata>('metadata:last-index-update');
  }

  /**
   * Update index metadata
   */
  async updateIndexMetadata(updates: Partial<IndexUpdateMetadata>): Promise<void> {
    const existing = await this.getIndexUpdateMetadata();
    const metadata: IndexUpdateMetadata = {
      id: 'metadata:last-index-update',
      recent: updates.recent || existing?.recent || '',
      popularAll: updates.popularAll || existing?.popularAll || '',
      popularMonthly: updates.popularMonthly || existing?.popularMonthly || '',
      popularWeekly: updates.popularWeekly || existing?.popularWeekly || '',
      popularDaily: updates.popularDaily || existing?.popularDaily || '',
      trending: updates.trending || existing?.trending || '',
      categories: { ...existing?.categories, ...updates.categories },
    };

    await this.bucket.put(metadata.id, JSON.stringify(metadata), {
      httpMetadata: { contentType: 'application/json' },
    });
  }
}