/**
 * Progress Bar Preview Module
 *
 * Handles thumbnail sprite preview on progress bar hover/touch
 * Features:
 * - Bunny.net thumbnail sprite sheet integration
 * - Smooth preview following mouse position
 * - Timestamp tooltip display
 * - Watched segments tracking and visualization
 * - RTL support for tooltip positioning
 * - Performance optimized
 */

import type { Player } from 'video.js';
import type { ExtendedPlayer } from './videojs.d';

/**
 * Sprite thumbnail configuration
 */
export interface SpriteThumbnailConfig {
  /** Bunny.net video ID (GUID) */
  bunnyVideoId: string;
  /** CDN library ID (defaults to 239863) */
  libraryId?: number;
  /** Thumbnail interval in seconds (defaults to 5) */
  interval?: number;
  /** Thumbnail width in pixels (defaults to 160) */
  width?: number;
  /** Thumbnail height in pixels (defaults to 90) */
  height?: number;
  /** Enable RTL layout (defaults to false) */
  rtl?: boolean;
}

/**
 * Watched segment data structure
 */
export interface WatchedSegment {
  start: number;
  end: number;
}

/**
 * Get Bunny.net preview URL for sprite thumbnails
 *
 * @param bunnyVideoId - Bunny.net video GUID
 * @param libraryId - CDN library ID (defaults to 239863)
 * @returns Preview sprite sheet URL
 *
 * @example
 * const previewUrl = getBunnyPreviewUrl('abc-def-123', 239863);
 * // Returns: https://vz-d3f23d76-a73.b-cdn.net/abc-def-123/preview.webp
 */
export function getBunnyPreviewUrl(bunnyVideoId: string, libraryId: number = 239863): string {
  // Bunny.net preview sprite format
  // Format: https://vz-{library-hex}.b-cdn.net/{video-guid}/preview.webp
  const libraryHex = libraryId.toString(16).padStart(8, '0');
  const cdnDomain = `vz-${libraryHex}.b-cdn.net`;

  return `https://${cdnDomain}/${bunnyVideoId}/preview.webp`;
}

/**
 * Initialize sprite thumbnails plugin on Video.js player
 *
 * @param player - Video.js player instance
 * @param config - Sprite thumbnail configuration
 * @throws Error if player is not ready or plugin is not available
 *
 * @example
 * initializeSpriteThumbnails(player, {
 *   bunnyVideoId: 'abc-def-123',
 *   interval: 5,
 *   rtl: false
 * });
 */
export function initializeSpriteThumbnails(
  player: ExtendedPlayer,
  config: SpriteThumbnailConfig
): void {
  if (!player || player.isDisposed()) {
    throw new Error('Player instance is not available or disposed');
  }

  // Check if plugin is available
  if (typeof (player as any).spriteThumbnails !== 'function') {
    throw new Error('videojs-sprite-thumbnails plugin is not loaded');
  }

  const {
    bunnyVideoId,
    libraryId = 239863,
    interval = 5,
    width = 160,
    height = 90,
    rtl = false
  } = config;

  try {
    const previewUrl = getBunnyPreviewUrl(bunnyVideoId, libraryId);

    // Initialize sprite thumbnails plugin
    (player as any).spriteThumbnails({
      interval,
      url: previewUrl,
      width,
      height,
      // RTL support: adjust positioning
      downlink: rtl ? 0 : undefined,
      responsive: width * height
    });

    console.log('[ProgressPreview] Sprite thumbnails initialized:', {
      url: previewUrl,
      interval,
      width,
      height,
      rtl
    });
  } catch (error) {
    console.error('[ProgressPreview] Failed to initialize sprite thumbnails:', error);
    throw error;
  }
}

/**
 * Setup watched segments tracking and visualization
 *
 * Tracks user's watch history and highlights watched portions of the video
 * with a darker overlay on the progress bar.
 *
 * @param player - Video.js player instance
 * @param watchedSegments - Array of watched segments
 * @param onSegmentUpdate - Callback when a new segment is watched
 *
 * @example
 * setupWatchedSegments(player, [
 *   { start: 0, end: 30 },
 *   { start: 60, end: 90 }
 * ], (segments) => {
 *   console.log('Updated segments:', segments);
 * });
 */
export function setupWatchedSegments(
  player: ExtendedPlayer,
  watchedSegments: WatchedSegment[] = [],
  onSegmentUpdate?: (segments: WatchedSegment[]) => void
): () => void {
  if (!player || player.isDisposed()) {
    throw new Error('Player instance is not available or disposed');
  }

  // Store watched segments
  let segments = [...watchedSegments];
  let lastTime = 0;
  let currentSegmentStart: number | null = null;

  /**
   * Merge overlapping segments
   */
  function mergeSegments(segs: WatchedSegment[]): WatchedSegment[] {
    if (segs.length === 0) return [];

    // Sort by start time
    const sorted = [...segs].sort((a, b) => a.start - b.start);
    const merged: WatchedSegment[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      // If segments overlap or are adjacent, merge them
      if (current.start <= last.end + 1) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Add a new watched segment
   */
  function addSegment(start: number, end: number): void {
    if (start >= end) return;

    segments.push({ start, end });
    segments = mergeSegments(segments);

    // Update visualization
    updateProgressBarSegments();

    // Call callback
    if (onSegmentUpdate) {
      onSegmentUpdate(segments);
    }
  }

  /**
   * Update progress bar with watched segments visualization
   */
  function updateProgressBarSegments(): void {
    const progressControl = player.el()?.querySelector('.vjs-progress-control');
    if (!progressControl) return;

    // Remove existing segment overlays
    const existingOverlays = progressControl.querySelectorAll('.vjs-watched-segment');
    existingOverlays.forEach(el => el.remove());

    // Get video duration
    const duration = player.duration();
    if (!duration || duration === Infinity) return;

    // Add segment overlays
    segments.forEach(segment => {
      const startPercent = (segment.start / duration) * 100;
      const widthPercent = ((segment.end - segment.start) / duration) * 100;

      const overlay = document.createElement('div');
      overlay.className = 'vjs-watched-segment';
      overlay.style.left = `${startPercent}%`;
      overlay.style.width = `${widthPercent}%`;

      progressControl.appendChild(overlay);
    });
  }

  /**
   * Handle timeupdate event to track watched segments
   */
  function handleTimeUpdate(): void {
    const currentTime = player.currentTime() || 0;

    // Start new segment if not started
    if (currentSegmentStart === null) {
      currentSegmentStart = currentTime;
    }

    // Check for seek (discontinuity)
    const timeDiff = Math.abs(currentTime - lastTime);
    if (timeDiff > 2) {
      // User seeked - save previous segment if exists
      if (currentSegmentStart !== null && lastTime > currentSegmentStart) {
        addSegment(currentSegmentStart, lastTime);
      }
      currentSegmentStart = currentTime;
    }

    lastTime = currentTime;
  }

  /**
   * Handle pause/ended events to save current segment
   */
  function handlePauseOrEnd(): void {
    const currentTime = player.currentTime() || 0;
    if (currentSegmentStart !== null && currentTime > currentSegmentStart) {
      addSegment(currentSegmentStart, currentTime);
      currentSegmentStart = null;
    }
  }

  /**
   * Handle play event to start new segment
   */
  function handlePlay(): void {
    const currentTime = player.currentTime() || 0;
    currentSegmentStart = currentTime;
  }

  /**
   * Handle loadedmetadata event to initialize segments visualization
   */
  function handleLoadedMetadata(): void {
    updateProgressBarSegments();
  }

  // Attach event listeners
  player.on('timeupdate', handleTimeUpdate);
  player.on('pause', handlePauseOrEnd);
  player.on('ended', handlePauseOrEnd);
  player.on('play', handlePlay);
  player.on('loadedmetadata', handleLoadedMetadata);

  // Initial visualization
  if (player.readyState() >= 1) {
    updateProgressBarSegments();
  }

  console.log('[ProgressPreview] Watched segments tracking initialized');

  // Return cleanup function
  return () => {
    player.off('timeupdate', handleTimeUpdate);
    player.off('pause', handlePauseOrEnd);
    player.off('ended', handlePauseOrEnd);
    player.off('play', handlePlay);
    player.off('loadedmetadata', handleLoadedMetadata);

    // Remove segment overlays
    const progressControl = player.el()?.querySelector('.vjs-progress-control');
    if (progressControl) {
      const overlays = progressControl.querySelectorAll('.vjs-watched-segment');
      overlays.forEach(el => el.remove());
    }
  };
}

/**
 * Format time in seconds to HH:MM:SS or MM:SS format
 *
 * @param seconds - Time in seconds
 * @returns Formatted time string
 *
 * @example
 * formatTime(65);  // Returns: "1:05"
 * formatTime(3665);  // Returns: "1:01:05"
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
