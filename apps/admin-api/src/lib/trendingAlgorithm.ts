/**
 * Trending Algorithm for Video Sections
 * Calculates trending scores based on velocity, engagement, and recency
 */

import { VideoObject } from '@al-ummah/shared-types';
import { logger } from './logger';

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
  return ((likes + comments) / views) * 100;
}

/**
 * Calculate view velocity (views per hour)
 */
export function calculateViewVelocity(video: VideoObject, timeWindowHours: number = 24): number {
  const views = video.views || 0;
  const ageInHours = getVideoAgeInHours(video.dateCreated || new Date().toISOString());
  const effectiveHours = Math.min(ageInHours, timeWindowHours);

  if (effectiveHours === 0) return views;
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
 * Calculate freshness bonus based on video age
 */
function calculateFreshnessBonus(ageInHours: number): number {
  if (ageInHours < 1) return 1000;
  if (ageInHours < 6) return 500;
  if (ageInHours < 24) return 200;
  if (ageInHours < 72) return 100;
  if (ageInHours < 168) return 50;
  return 10;
}

/**
 * Estimate recent views based on total views and video age
 */
function estimateRecentViews(video: VideoObject): number {
  const totalViews = video.views || 0;
  const ageInHours = getVideoAgeInHours(video.dateCreated || new Date().toISOString());

  if (ageInHours <= 24) {
    return Math.round(totalViews * 0.9);
  } else if (ageInHours <= 72) {
    return Math.round(totalViews * 0.4);
  } else if (ageInHours <= 168) {
    return Math.round(totalViews * 0.2);
  } else {
    const dailyAverage = totalViews / (ageInHours / 24);
    return Math.round(dailyAverage);
  }
}

/**
 * Calculate trending score using the hybrid algorithm
 */
export function calculateTrendingScore(
  video: VideoObject,
  algorithm: 'velocity' | 'engagement' | 'hybrid' = 'hybrid'
): number {
  const ageInHours = getVideoAgeInHours(video.dateCreated || new Date().toISOString());
  const recentViews = estimateRecentViews(video);
  const totalViews = video.views || 0;
  const engagementRate = calculateEngagementRate(video);
  const viewVelocity = calculateViewVelocity(video);
  const engagementVelocity = calculateEngagementVelocity(video);
  const freshnessBonus = calculateFreshnessBonus(ageInHours);

  let score = 0;

  switch (algorithm) {
    case 'velocity':
      score = (viewVelocity * 100) + (recentViews * 10) + freshnessBonus;
      break;
    case 'engagement':
      score = (engagementRate * 1000) + (engagementVelocity * 50) + (totalViews * 0.1) + freshnessBonus;
      break;
    case 'hybrid':
    default:
      score = (viewVelocity * 100) + (recentViews * 10) + (totalViews * 0.1) +
              (engagementRate * 500) + (engagementVelocity * 25) + freshnessBonus;
      break;
  }

  return Math.round(Math.max(0, score));
}

/**
 * Process a list of videos and return trending videos sorted by score
 */
export function processTrendingVideos(
  videos: VideoObject[],
  algorithm: 'velocity' | 'engagement' | 'hybrid' = 'hybrid',
  limit: number = 100
): TrendingVideo[] {
  logger.debug(`Processing ${videos.length} videos for trending with ${algorithm} algorithm`);

  const trendingVideos = videos
    .filter(v => v.isPublic !== false)
    .map(video => {
      const trendingScore = calculateTrendingScore(video, algorithm);
      const viewVelocity = calculateViewVelocity(video);
      const engagementVelocity = calculateEngagementVelocity(video);
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
    .filter(v => v.trendingScore > 0);

  trendingVideos.sort((a, b) => b.trendingScore - a.trendingScore);

  const rankedVideos = trendingVideos.slice(0, limit).map((video, index) => ({
    ...video,
    rank: index + 1,
  }));

  logger.debug(`Found ${rankedVideos.length} trending videos`);
  return rankedVideos;
}
