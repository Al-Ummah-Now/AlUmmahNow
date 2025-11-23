'use server';

import { VideoObject, VideoCategory } from "@al-ummah/shared-types";
import { getApiUrl } from "@/lib/runtime-config";
import { logger } from '@/lib/logger-server';

const baseUrl = getApiUrl();

/**
 * Response types for section endpoints
 */
export interface VideoSectionResponse {
  success: boolean;
  data: VideoObject[];
  cursor?: string;
  metadata: {
    totalCount?: number;
    lastUpdated: string;
    fromIndex?: boolean;
  };
}

export interface PopularVideosMetadata {
  success: boolean;
  data: VideoObject[];
  cursor?: string;
  metadata: {
    totalCount?: number;
    lastUpdated: string;
    period: 'all' | 'monthly' | 'weekly' | 'daily';
    fromIndex: boolean;
  };
}

export interface TrendingVideoMetadata {
  rank: number;
  score: number;
  viewsVelocity: number;
  percentageIncrease: number;
  peakTime?: string;
}

export interface TrendingVideoObject extends VideoObject {
  trendingMetadata: TrendingVideoMetadata;
}

export interface TrendingVideosResponse {
  success: boolean;
  data: TrendingVideoObject[];
  cursor?: string;
  metadata: {
    algorithmVersion: string;
    lastCalculated: string;
    nextUpdate: string;
    fromIndex: boolean;
  };
}

export interface RecommendedVideosResponse {
  success: boolean;
  data: VideoObject[];
  cursor?: string;
  metadata: {
    strategy: 'popular' | 'category-based' | 'random';
    basedOn?: string;
    lastUpdated: string;
  };
}

/**
 * Query parameters for section endpoints
 */
export interface SectionQueryParams {
  limit?: number;
  cursor?: string;
  category?: VideoCategory;
}

export interface RecentVideosParams extends SectionQueryParams {
  channelId?: string;
  excludeChannels?: string[];
}

export interface PopularVideosParams extends SectionQueryParams {
  period?: 'all' | 'monthly' | 'weekly' | 'daily';
  minViews?: number;
}

export interface TrendingVideosParams extends SectionQueryParams {
  algorithm?: 'velocity' | 'engagement' | 'hybrid';
  timeWindow?: '6h' | '12h' | '24h' | '48h';
  region?: string;
}

export interface RecommendedVideosParams extends SectionQueryParams {
  strategy?: 'popular' | 'category-based' | 'random';
  excludeWatched?: boolean;
  seedVideoId?: string;
}

/**
 * Get recent videos
 * GET /api/videos/sections/recent
 */
export async function getRecentVideos(
  params: RecentVideosParams = {},
  headers?: { channelId?: string; userId?: string }
): Promise<VideoSectionResponse | null> {
  try {
    const queryParams = new URLSearchParams();
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.cursor) queryParams.append('cursor', params.cursor);
    if (params.channelId) queryParams.append('channelId', params.channelId);
    if (params.category) queryParams.append('category', params.category);
    if (params.excludeChannels?.length) {
      params.excludeChannels.forEach(id => queryParams.append('excludeChannels', id));
    }

    const url = `${baseUrl}/api/videos/sections/recent${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    logger.info('[getRecentVideos] Fetching from:', { url });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(headers?.channelId && { 'channelId': headers.channelId }),
        ...(headers?.userId && { 'userId': headers.userId }),
      },
    });

    if (!response.ok) {
      logger.error('[getRecentVideos] API error:', {
        status: response.status,
        statusText: response.statusText
      });
      throw new Error(`Error fetching recent videos: ${response.statusText}`);
    }

    const data = await response.json();
    logger.info('[getRecentVideos] Success:', { videoCount: data.data?.length });
    return data;
  } catch (error) {
    logger.error('[getRecentVideos] Error:', error);
    return null;
  }
}

/**
 * Get popular videos
 * GET /api/videos/sections/popular
 */
export async function getPopularVideos(
  params: PopularVideosParams = {},
  headers?: { channelId?: string; userId?: string }
): Promise<PopularVideosMetadata | null> {
  try {
    const queryParams = new URLSearchParams();
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.cursor) queryParams.append('cursor', params.cursor);
    if (params.period) queryParams.append('period', params.period);
    if (params.category) queryParams.append('category', params.category);
    if (params.minViews !== undefined) queryParams.append('minViews', params.minViews.toString());

    const url = `${baseUrl}/api/videos/sections/popular${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    logger.info('[getPopularVideos] Fetching from:', { url, params });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(headers?.channelId && { 'channelId': headers.channelId }),
        ...(headers?.userId && { 'userId': headers.userId }),
      },
    });

    if (!response.ok) {
      logger.error('[getPopularVideos] API error:', {
        status: response.status,
        statusText: response.statusText
      });
      throw new Error(`Error fetching popular videos: ${response.statusText}`);
    }

    const data = await response.json();
    logger.info('[getPopularVideos] Success:', { videoCount: data.data?.length, period: params.period });
    return data;
  } catch (error) {
    logger.error('[getPopularVideos] Error:', error);
    return null;
  }
}

/**
 * Get trending videos
 * GET /api/videos/sections/trending
 */
export async function getTrendingVideos(
  params: TrendingVideosParams = {},
  headers?: { channelId?: string; userId?: string }
): Promise<TrendingVideosResponse | null> {
  try {
    const queryParams = new URLSearchParams();
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.cursor) queryParams.append('cursor', params.cursor);
    if (params.algorithm) queryParams.append('algorithm', params.algorithm);
    if (params.timeWindow) queryParams.append('timeWindow', params.timeWindow);
    if (params.category) queryParams.append('category', params.category);
    if (params.region) queryParams.append('region', params.region);

    const url = `${baseUrl}/api/videos/sections/trending${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    logger.info('[getTrendingVideos] Fetching from:', { url, params });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(headers?.channelId && { 'channelId': headers.channelId }),
        ...(headers?.userId && { 'userId': headers.userId }),
      },
    });

    if (!response.ok) {
      logger.error('[getTrendingVideos] API error:', {
        status: response.status,
        statusText: response.statusText
      });
      throw new Error(`Error fetching trending videos: ${response.statusText}`);
    }

    const data = await response.json();
    logger.info('[getTrendingVideos] Success:', { videoCount: data.data?.length, algorithm: params.algorithm });
    return data;
  } catch (error) {
    logger.error('[getTrendingVideos] Error:', error);
    return null;
  }
}

/**
 * Get recommended videos
 * GET /api/videos/sections/recommended
 */
export async function getRecommendedVideos(
  params: RecommendedVideosParams = {},
  headers?: { channelId?: string; userId?: string }
): Promise<RecommendedVideosResponse | null> {
  try {
    const queryParams = new URLSearchParams();
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.cursor) queryParams.append('cursor', params.cursor);
    if (params.strategy) queryParams.append('strategy', params.strategy);
    if (params.excludeWatched !== undefined) queryParams.append('excludeWatched', params.excludeWatched.toString());
    if (params.seedVideoId) queryParams.append('seedVideoId', params.seedVideoId);

    const url = `${baseUrl}/api/videos/sections/recommended${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    logger.info('[getRecommendedVideos] Fetching from:', { url, params, userId: headers?.userId });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(headers?.channelId && { 'channelId': headers.channelId }),
        ...(headers?.userId && { 'userId': headers.userId }),
      },
    });

    if (!response.ok) {
      logger.error('[getRecommendedVideos] API error:', {
        status: response.status,
        statusText: response.statusText
      });
      throw new Error(`Error fetching recommended videos: ${response.statusText}`);
    }

    const data = await response.json();
    logger.info('[getRecommendedVideos] Success:', {
      videoCount: data.data?.length,
      strategy: params.strategy,
      basedOn: data.metadata?.basedOn
    });
    return data;
  } catch (error) {
    logger.error('[getRecommendedVideos] Error:', error);
    return null;
  }
}

/**
 * Get videos by category
 * GET /api/videos/sections/by-category/:category
 */
export async function getCategoryVideos(
  category: VideoCategory,
  params: SectionQueryParams = {},
  headers?: { channelId?: string; userId?: string }
): Promise<VideoSectionResponse | null> {
  try {
    const queryParams = new URLSearchParams();
    queryParams.append('category', category);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.cursor) queryParams.append('cursor', params.cursor);

    const url = `${baseUrl}/api/videos/sections/by-category/${category}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    logger.info('[getCategoryVideos] Fetching from:', { url, category });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(headers?.channelId && { 'channelId': headers.channelId }),
        ...(headers?.userId && { 'userId': headers.userId }),
      },
    });

    if (!response.ok) {
      logger.error('[getCategoryVideos] API error:', {
        status: response.status,
        statusText: response.statusText
      });
      throw new Error(`Error fetching category videos: ${response.statusText}`);
    }

    const data = await response.json();
    logger.info('[getCategoryVideos] Success:', { videoCount: data.data?.length, category });
    return data;
  } catch (error) {
    logger.error('[getCategoryVideos] Error:', error);
    return null;
  }
}
