/**
 * Trending Algorithm for Video Sections
 * Calculates trending scores based on velocity, engagement, and recency
 */

import { VideoObject } from '@al-ummah/shared-types';
import { logger } from './logger';
import { isVideoPubliclyVisible } from './visibility';

/**
 * Extended video metrics for trending calculations
 */
export interface VideoMetrics {
  views: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;
  viewsLast24Hours?: number;
  viewsLast7Days?: number;
  viewsLast30Days?: number;
  engagementRate?: number;
  trendingScore?: number;
  lastTrendingUpdate?: string;
}

/**
 * Trending video data with calculated scores
 */
export interface TrendingVideo {
  videoId: string;
  trendingScore: number;
  viewsVelocity: number;
  engagementVelocity: number;
  percentageIncrease: number;
  dateCreated: string;
  title: string;
  thumbnailUrl: string;
  channelId: string;
  views: number;
  likesCount: number;
  rank?: number;
}

/**
 * Calculate the age of a video in hours
 */
function getVideoAgeInHours(dateCreated: string): number {
  const created = new Date(dateCreated).getTime();
  const now = Date.now();
  return (now - created) / (1000 * 60 * 60);
}

/**
 * Calculate engagement rate for a video
 */
export function calculateEngagementRate(video: VideoObject): number {
  const views = video.views || 0;
  const likes = video.likesCount || 0;
  const comments = video.commentsCount || 0;

  if (views === 0) return 0;

  // Engagement rate as a percentage
  return ((likes + comments) / views) * 100;
}

/**
 * Calculate view velocity (views per hour)
 */
export function calculateViewVelocity(video: VideoObject, timeWindowHours: number = 24): number {
  const views = video.views || 0;
  const ageInHours = getVideoAgeInHours(video.dateCreated || new Date().toISOString());

  // Use the minimum of video age and time window
  const effectiveHours = Math.min(ageInHours, timeWindowHours);

  if (effectiveHours === 0) return views; // Very new video, return total views

  return views / effectiveHours;
}

/**
 * Calculate engagement velocity (engagements per hour)
 */
export function calculateEngagementVelocity(video: VideoObject, timeWindowHours: number = 24): number {
  const likes = video.likesCount || 0;
  const comments = video.commentsCount || 0;
  const totalEngagement = likes + comments;

  const ageInHours = getVideoAgeInHours(video.dateCreated || new Date().toISOString());
  const effectiveHours = Math.min(ageInHours, timeWindowHours);

  if (effectiveHours === 0) return totalEngagement;

  return totalEngagement / effectiveHours;
}

/**
 * Calculate trending score using the hybrid algorithm
 */
export function calculateTrendingScore(
  video: VideoObject,
  algorithm: 'velocity' | 'engagement' | 'hybrid' = 'hybrid'
): number {
  const ageInHours = getVideoAgeInHours(video.dateCreated || new Date().toISOString());

  // Recent views (simulated - in production, this would come from analytics)
  // For MVP, we'll estimate based on total views and age
  const recentViews = estimateRecentViews(video);
  const totalViews = video.views || 0;

  // Engagement metrics
  const engagementRate = calculateEngagementRate(video);
  const viewVelocity = calculateViewVelocity(video);
  const engagementVelocity = calculateEngagementVelocity(video);

  // Freshness bonus (higher for newer videos)
  const freshnessBonus = calculateFreshnessBonus(ageInHours);

  let score = 0;

  switch (algorithm) {
    case 'velocity':
      // Focus on view velocity and recent views
      score = (viewVelocity * 100) +
              (recentViews * 10) +
              freshnessBonus;
      break;

    case 'engagement':
      // Focus on engagement metrics
      score = (engagementRate * 1000) +
              (engagementVelocity * 50) +
              (totalViews * 0.1) +
              freshnessBonus;
      break;

    case 'hybrid':
    default:
      // Balanced approach combining all factors
      score = (viewVelocity * 100) +           // Velocity weight: 100
              (recentViews * 10) +             // Recent views weight: 10
              (totalViews * 0.1) +             // Total views weight: 0.1
              (engagementRate * 500) +         // Engagement rate weight: 500
              (engagementVelocity * 25) +      // Engagement velocity weight: 25
              freshnessBonus;                  // Freshness bonus
      break;
  }

  return Math.round(Math.max(0, score));
}

/**
 * Calculate freshness bonus based on video age
 */
function calculateFreshnessBonus(ageInHours: number): number {
  // Logarithmic decay - newer videos get higher bonus
  // Videos older than 7 days get minimal bonus
  if (ageInHours < 1) return 1000;        // Brand new videos
  if (ageInHours < 6) return 500;         // Less than 6 hours old
  if (ageInHours < 24) return 200;        // Less than a day old
  if (ageInHours < 72) return 100;        // Less than 3 days old
  if (ageInHours < 168) return 50;        // Less than a week old
  return 10;                              // Older videos
}

/**
 * Estimate recent views based on total views and video age
 * In production, this would use actual analytics data
 */
function estimateRecentViews(video: VideoObject): number {
  const totalViews = video.views || 0;
  const ageInHours = getVideoAgeInHours(video.dateCreated || new Date().toISOString());

  if (ageInHours <= 24) {
    // For videos less than 24 hours old, most views are recent
    return Math.round(totalViews * 0.9);
  } else if (ageInHours <= 72) {
    // For videos 1-3 days old
    return Math.round(totalViews * 0.4);
  } else if (ageInHours <= 168) {
    // For videos 3-7 days old
    return Math.round(totalViews * 0.2);
  } else {
    // For older videos, estimate based on view velocity
    const dailyAverage = totalViews / (ageInHours / 24);
    return Math.round(dailyAverage);
  }
}

/**
 * Calculate percentage increase in views
 */
export function calculatePercentageIncrease(currentViews: number, previousViews: number): number {
  if (previousViews === 0) return currentViews > 0 ? 100 : 0;
  return Math.round(((currentViews - previousViews) / previousViews) * 100);
}

/**
 * Process a list of videos and return trending videos sorted by score
 */
export function processTrendingVideos(
  videos: VideoObject[],
  algorithm: 'velocity' | 'engagement' | 'hybrid' = 'hybrid',
  limit: number = 100
): TrendingVideo[] {
  logger.info(`Processing ${videos.length} videos for trending with ${algorithm} algorithm`);

  // Calculate trending scores for all videos
  const trendingVideos = videos
    .filter(v => isVideoPubliclyVisible(v)) // Only public videos
    .map(video => {
      const trendingScore = calculateTrendingScore(video, algorithm);
      const viewVelocity = calculateViewVelocity(video);
      const engagementVelocity = calculateEngagementVelocity(video);

      // For percentage increase, we'd need historical data
      // For MVP, we'll estimate based on velocity
      const percentageIncrease = viewVelocity > 0 ? Math.min(100, Math.round(viewVelocity * 10)) : 0;

      return {
        videoId: video.id,
        trendingScore,
        viewsVelocity: viewVelocity,
        engagementVelocity,
        percentageIncrease,
        dateCreated: video.dateCreated || new Date().toISOString(),
        title: video.title || '',
        thumbnailUrl: video.thumbnailUrl || '',
        channelId: video.channelId || '',
        views: video.views || 0,
        likesCount: video.likesCount || 0,
      };
    })
    .filter(v => v.trendingScore > 0); // Only include videos with positive scores

  // Sort by trending score (highest first)
  trendingVideos.sort((a, b) => b.trendingScore - a.trendingScore);

  // Add rank and limit results
  const rankedVideos = trendingVideos.slice(0, limit).map((video, index) => ({
    ...video,
    rank: index + 1,
  }));

  logger.info(`Found ${rankedVideos.length} trending videos`);

  return rankedVideos;
}

/**
 * Get trending videos for a specific category
 */
export function processCategoryTrendingVideos(
  videos: VideoObject[],
  category: string,
  algorithm: 'velocity' | 'engagement' | 'hybrid' = 'hybrid',
  limit: number = 50
): TrendingVideo[] {
  const categoryVideos = videos.filter(v => v.category === category);
  return processTrendingVideos(categoryVideos, algorithm, limit);
}

/**
 * Get trending videos within a specific time window
 */
export function processTimeWindowTrendingVideos(
  videos: VideoObject[],
  timeWindowHours: number,
  algorithm: 'velocity' | 'engagement' | 'hybrid' = 'hybrid',
  limit: number = 100
): TrendingVideo[] {
  const now = Date.now();
  const windowStart = now - (timeWindowHours * 60 * 60 * 1000);

  // Filter videos created within the time window
  const recentVideos = videos.filter(v => {
    const created = new Date(v.dateCreated || 0).getTime();
    return created >= windowStart;
  });

  return processTrendingVideos(recentVideos, algorithm, limit);
}