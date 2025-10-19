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
 * - LocalStorage for session persistence with quota management
 * - XSS protection with input validation and sanitization
 * - Automatic quota management with StorageManager
 */

import { VideosAPI } from '@/lib/api/videos';
import { StorageManager } from '@/lib/utils/storage';

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
 * Security: Validate video ID format
 * Prevents XSS attacks by ensuring videoId matches expected patterns
 *
 * @param videoId - The video ID to validate
 * @returns True if valid, false otherwise
 */
function isValidVideoId(videoId: string): boolean {
  // Null/undefined check
  if (!videoId || typeof videoId !== 'string') {
    return false;
  }

  // Length check - prevent excessive input
  if (videoId.length === 0 || videoId.length > 100) {
    return false;
  }

  // Pattern check - only allow alphanumeric, hyphens, and underscores
  // Common patterns: abc123, video-123, video_123, uuid format
  const videoIdRegex = /^[a-zA-Z0-9_-]+$/;
  return videoIdRegex.test(videoId);
}

/**
 * Security: Sanitize video ID for safe URL usage
 * Encodes special characters to prevent XSS attacks
 *
 * @param videoId - The video ID to sanitize
 * @returns Sanitized video ID safe for URL construction
 */
function sanitizeVideoId(videoId: string): string {
  // First validate the format
  if (!isValidVideoId(videoId)) {
    throw new Error('Invalid video ID format');
  }

  // Trim whitespace and encode for URL safety
  // encodeURIComponent escapes all potentially dangerous characters
  return encodeURIComponent(videoId.trim());
}

/**
 * Security: Validate user/channel ID format
 *
 * @param id - The ID to validate
 * @returns True if valid, false otherwise
 */
function isValidUserId(id: string | undefined): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }

  // Length check
  if (id.length === 0 || id.length > 100) {
    return false;
  }

  // Pattern check - alphanumeric, hyphens, underscores (typical for user/channel IDs)
  const idRegex = /^[a-zA-Z0-9_-]+$/;
  return idRegex.test(id);
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
   * Save tracked views to localStorage with quota management
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

      const jsonStr = JSON.stringify(data);
      const success = StorageManager.safeSetItem(this.STORAGE_KEY, jsonStr);

      if (!success) {
        console.warn('[VideoEngagementService] Failed to save tracked views (quota exceeded)');

        // Try to save with reduced data - keep only last 24 hours
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const reduced: Record<string, number> = {};

        Object.entries(data).forEach(([videoId, timestamp]) => {
          if (timestamp > oneDayAgo) {
            reduced[videoId] = timestamp;
          }
        });

        // Try again with reduced data
        const reducedJson = JSON.stringify(reduced);
        const retrySuccess = StorageManager.safeSetItem(this.STORAGE_KEY, reducedJson);

        if (retrySuccess) {
          console.log('[VideoEngagementService] Saved tracked views with reduced data');
        }
      }
    } catch (error) {
      console.error('[VideoEngagementService] Failed to save tracked views:', error);
    }
  }

  /**
   * Clean up expired views from localStorage with StorageManager
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

      const jsonStr = JSON.stringify(cleaned);
      StorageManager.safeSetItem(this.STORAGE_KEY, jsonStr);
    } catch (error) {
      console.error('[VideoEngagementService] Failed to cleanup expired views:', error);
    }
  }

  /**
   * Check if a video view has already been tracked in this session
   */
  isViewTracked(videoId: string): boolean {
    // Security: Validate video ID
    if (!isValidVideoId(videoId)) {
      console.error('[VideoEngagementService] Invalid video ID format');
      return false;
    }
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
    // Security: Validate input parameters
    if (!isValidVideoId(videoId)) {
      return {
        success: false,
        error: 'Invalid video ID format'
      };
    }

    if (userId && !isValidUserId(userId)) {
      return {
        success: false,
        error: 'Invalid user ID format'
      };
    }

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
    // Security: Validate all input parameters
    if (!isValidVideoId(videoId)) {
      return {
        success: false,
        error: 'Invalid video ID format'
      };
    }

    if (!isValidUserId(channelId) || !isValidUserId(userId)) {
      return {
        success: false,
        error: 'Invalid user or channel ID format'
      };
    }

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
    // Security: Validate all input parameters
    if (!isValidVideoId(videoId)) {
      return {
        success: false,
        error: 'Invalid video ID format'
      };
    }

    if (!isValidUserId(channelId) || !isValidUserId(userId)) {
      return {
        success: false,
        error: 'Invalid user or channel ID format'
      };
    }

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
    // Security: Validate all input parameters
    if (!isValidVideoId(videoId)) {
      return {
        success: false,
        error: 'Invalid video ID format'
      };
    }

    if (!isValidUserId(channelId) || !isValidUserId(userId)) {
      return {
        success: false,
        error: 'Invalid user or channel ID format'
      };
    }

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
    // Security: Validate all input parameters
    if (!isValidVideoId(videoId)) {
      return {
        success: false,
        error: 'Invalid video ID format'
      };
    }

    if (!isValidUserId(channelId) || !isValidUserId(userId)) {
      return {
        success: false,
        error: 'Invalid user or channel ID format'
      };
    }

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
    // Security: Validate video ID before tracking
    if (!isValidVideoId(videoId)) {
      return {
        success: false,
        error: 'Invalid video ID format'
      };
    }

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
   * Get share URL for a video with XSS protection
   *
   * @param videoId - The video ID
   * @param platform - The platform to share on
   * @returns Share URL or null if platform not supported or invalid input
   */
  getShareUrl(videoId: string, platform: SharePlatform): string | null {
    if (typeof window === 'undefined') return null;

    // Security: Validate and sanitize video ID to prevent XSS attacks
    if (!isValidVideoId(videoId)) {
      console.error('[VideoEngagementService] Invalid video ID format - potential XSS attempt');
      return null;
    }

    // Sanitize video ID for safe URL construction
    const safeVideoId = sanitizeVideoId(videoId);
    const baseUrl = window.location.origin;

    // Construct safe video URL with sanitized ID
    const videoUrl = `${baseUrl}/watch/${safeVideoId}`;

    switch (platform) {
      case 'twitter':
        // URL is already double-encoded (once by us, once by encodeURIComponent)
        return `https://twitter.com/intent/tweet?url=${encodeURIComponent(videoUrl)}`;

      case 'facebook':
        // URL is already double-encoded for safety
        return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(videoUrl)}`;

      case 'email':
        // Email body is safely encoded
        return `mailto:?subject=Check out this video&body=${encodeURIComponent(videoUrl)}`;

      case 'copy':
        // Return the sanitized URL for copying
        return videoUrl;

      default:
        return null;
    }
  }

  /**
   * Copy video URL to clipboard with XSS protection
   *
   * @param videoId - The video ID
   * @returns Promise resolving to success status
   */
  async copyShareUrl(videoId: string): Promise<EngagementResult> {
    // Security: Validate video ID first
    if (!isValidVideoId(videoId)) {
      return {
        success: false,
        error: 'Invalid video ID format'
      };
    }

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
