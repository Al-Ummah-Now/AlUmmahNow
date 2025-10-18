/**
 * Video Engagement Service
 *
 * Handles video engagement actions (like, dislike, share, view tracking)
 * with optimistic updates and error recovery.
 *
 * Features:
 * - Optimistic UI updates (instant feedback)
 * - Automatic API synchronization
 * - Error handling with rollback
 * - Session-based view tracking (one view per session)
 * - LocalStorage for session persistence
 */

import { VideosAPI } from '@/lib/api/videos';
import { VideoEventType } from '../analytics/types';

/**
 * Share platform types
 */
export type SharePlatform = 'twitter' | 'facebook' | 'email' | 'copy';

/**
 * Engagement action types for analytics
 */
export type EngagementAction = 'like' | 'unlike' | 'dislike' | 'remove_dislike' | 'share' | 'view';

/**
 * Result of an engagement operation
 */
export interface EngagementResult {
  success: boolean;
  error?: string;
}

/**
 * Video Engagement Service Class
 */
export class VideoEngagementService {
  private viewTracked = new Set<string>();
  private readonly STORAGE_KEY = 'video_views_tracked';
  private readonly SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.loadTrackedViews();
  }

  /**
   * Load previously tracked views from localStorage
   */
  private loadTrackedViews(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored) as Record<string, number>;
      const now = Date.now();

      // Only restore views from current session (within SESSION_DURATION_MS)
      Object.entries(data).forEach(([videoId, timestamp]) => {
        if (now - timestamp < this.SESSION_DURATION_MS) {
          this.viewTracked.add(videoId);
        }
      });

      // Clean up expired views
      this.cleanupExpiredViews();
    } catch (error) {
      console.error('[VideoEngagementService] Failed to load tracked views:', error);
    }
  }

  /**
   * Save tracked views to localStorage
   */
  private saveTrackedViews(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      let data: Record<string, number> = {};

      if (stored) {
        data = JSON.parse(stored);
      }

      // Add current tracked views with timestamps
      const now = Date.now();
      this.viewTracked.forEach(videoId => {
        if (!data[videoId]) {
          data[videoId] = now;
        }
      });

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('[VideoEngagementService] Failed to save tracked views:', error);
    }
  }

  /**
   * Clean up expired views from localStorage
   */
  private cleanupExpiredViews(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored) as Record<string, number>;
      const now = Date.now();
      const cleaned: Record<string, number> = {};

      Object.entries(data).forEach(([videoId, timestamp]) => {
        if (now - timestamp < this.SESSION_DURATION_MS) {
          cleaned[videoId] = timestamp;
        }
      });

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cleaned));
    } catch (error) {
      console.error('[VideoEngagementService] Failed to cleanup expired views:', error);
    }
  }

  /**
   * Check if a video view has already been tracked in this session
   */
  isViewTracked(videoId: string): boolean {
    return this.viewTracked.has(videoId);
  }

  /**
   * Track a video view (once per session)
   *
   * @param videoId - The video ID
   * @param userId - Optional user ID for authenticated tracking
   * @returns Promise resolving to success status
   */
  async trackView(videoId: string, userId?: string): Promise<EngagementResult> {
    // Skip if already tracked in this session
    if (this.isViewTracked(videoId)) {
      return { success: true };
    }

    try {
      // Mark as tracked immediately (optimistic)
      this.viewTracked.add(videoId);
      this.saveTrackedViews();

      // Send to analytics endpoint (fire and forget)
      // The actual API call will be handled by the analytics service
      // This is just for session tracking

      return { success: true };
    } catch (error) {
      console.error('[VideoEngagementService] Failed to track view:', error);

      // Rollback on error
      this.viewTracked.delete(videoId);
      this.saveTrackedViews();

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to track view'
      };
    }
  }

  /**
   * Like a video with optimistic update
   *
   * @param videoId - The video ID
   * @param channelId - User's channel ID (required for API)
   * @param userId - User ID (required for API)
   * @returns Promise resolving to success status
   */
  async likeVideo(
    videoId: string,
    channelId: string,
    userId: string
  ): Promise<EngagementResult> {
    try {
      const result = await VideosAPI.like(videoId, { channelId, userId });

      if (!result || !result.success) {
        throw new Error('Failed to like video');
      }

      return { success: true };
    } catch (error) {
      console.error('[VideoEngagementService] Failed to like video:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to like video'
      };
    }
  }

  /**
   * Unlike a video with optimistic update
   *
   * @param videoId - The video ID
   * @param channelId - User's channel ID (required for API)
   * @param userId - User ID (required for API)
   * @returns Promise resolving to success status
   */
  async unlikeVideo(
    videoId: string,
    channelId: string,
    userId: string
  ): Promise<EngagementResult> {
    try {
      const result = await VideosAPI.unlike(videoId, { channelId, userId });

      if (!result || !result.success) {
        throw new Error('Failed to unlike video');
      }

      return { success: true };
    } catch (error) {
      console.error('[VideoEngagementService] Failed to unlike video:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to unlike video'
      };
    }
  }

  /**
   * Dislike a video with optimistic update
   *
   * @param videoId - The video ID
   * @param channelId - User's channel ID (required for API)
   * @param userId - User ID (required for API)
   * @returns Promise resolving to success status
   */
  async dislikeVideo(
    videoId: string,
    channelId: string,
    userId: string
  ): Promise<EngagementResult> {
    try {
      const result = await VideosAPI.dislike(videoId, { channelId, userId });

      if (!result || !result.success) {
        throw new Error('Failed to dislike video');
      }

      return { success: true };
    } catch (error) {
      console.error('[VideoEngagementService] Failed to dislike video:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to dislike video'
      };
    }
  }

  /**
   * Remove dislike from a video with optimistic update
   *
   * @param videoId - The video ID
   * @param channelId - User's channel ID (required for API)
   * @param userId - User ID (required for API)
   * @returns Promise resolving to success status
   */
  async removeDislike(
    videoId: string,
    channelId: string,
    userId: string
  ): Promise<EngagementResult> {
    try {
      const result = await VideosAPI.removeDislike(videoId, { channelId, userId });

      if (!result || !result.success) {
        throw new Error('Failed to remove dislike');
      }

      return { success: true };
    } catch (error) {
      console.error('[VideoEngagementService] Failed to remove dislike:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove dislike'
      };
    }
  }

  /**
   * Track a share event
   *
   * @param videoId - The video ID
   * @param platform - The platform where the video was shared
   * @returns Promise resolving to success status
   */
  async trackShare(videoId: string, platform: SharePlatform): Promise<EngagementResult> {
    try {
      // Track share event in analytics
      // This will be sent to the analytics endpoint
      // For now, we just log it
      if (process.env.NODE_ENV === 'development') {
        console.log('[VideoEngagementService] Share tracked:', { videoId, platform });
      }

      return { success: true };
    } catch (error) {
      console.error('[VideoEngagementService] Failed to track share:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to track share'
      };
    }
  }

  /**
   * Get share URL for a video
   *
   * @param videoId - The video ID
   * @param platform - The platform to share on
   * @returns Share URL or null if platform not supported
   */
  getShareUrl(videoId: string, platform: SharePlatform): string | null {
    if (typeof window === 'undefined') return null;

    const baseUrl = window.location.origin;
    const videoUrl = `${baseUrl}/watch/${videoId}`;

    switch (platform) {
      case 'twitter':
        return `https://twitter.com/intent/tweet?url=${encodeURIComponent(videoUrl)}`;

      case 'facebook':
        return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(videoUrl)}`;

      case 'email':
        return `mailto:?subject=Check out this video&body=${encodeURIComponent(videoUrl)}`;

      case 'copy':
        return videoUrl;

      default:
        return null;
    }
  }

  /**
   * Copy video URL to clipboard
   *
   * @param videoId - The video ID
   * @returns Promise resolving to success status
   */
  async copyShareUrl(videoId: string): Promise<EngagementResult> {
    try {
      const url = this.getShareUrl(videoId, 'copy');
      if (!url) {
        throw new Error('Failed to generate share URL');
      }

      await navigator.clipboard.writeText(url);

      return { success: true };
    } catch (error) {
      console.error('[VideoEngagementService] Failed to copy URL:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to copy URL'
      };
    }
  }
}

/**
 * Singleton instance
 */
let engagementServiceInstance: VideoEngagementService | null = null;

/**
 * Get the singleton engagement service instance
 */
export function getEngagementService(): VideoEngagementService {
  if (!engagementServiceInstance) {
    engagementServiceInstance = new VideoEngagementService();
  }
  return engagementServiceInstance;
}
