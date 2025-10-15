/**
 * Video Fallback Strategy
 *
 * Implements automatic fallback from HLS to MP4 when HLS playback fails.
 * Provides quality selection and progressive enhancement strategies.
 */

import { VideoQuality } from '@/services/bunny/types';
import { VideoErrorType, VideoError } from './error-handler';

/**
 * Video source configuration
 */
export interface VideoSource {
  type: 'hls' | 'mp4';
  url: string;
  quality?: VideoQuality;
  label?: string;
}

/**
 * Fallback strategy configuration
 */
export interface FallbackConfig {
  /** Enable automatic fallback to MP4 */
  autoFallback: boolean;
  /** Preferred quality for MP4 fallback */
  preferredQuality: VideoQuality;
  /** Quality levels to try in order */
  qualityFallbackOrder: VideoQuality[];
}

/**
 * Default fallback configuration
 */
const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  autoFallback: true,
  preferredQuality: '720p',
  qualityFallbackOrder: ['720p', '480p', '360p', '1080p', '240p'],
};

/**
 * VideoFallbackStrategy class
 *
 * Manages video source fallback logic when primary source fails.
 */
export class VideoFallbackStrategy {
  private config: FallbackConfig;
  private currentSource: VideoSource | null = null;
  private availableSources: VideoSource[] = [];
  private attemptedSources: Set<string> = new Set();

  constructor(config: Partial<FallbackConfig> = {}) {
    this.config = {
      ...DEFAULT_FALLBACK_CONFIG,
      ...config,
    };
  }

  /**
   * Initialize available video sources
   *
   * @param hlsUrl - HLS playlist URL
   * @param mp4Urls - Available MP4 URLs for different qualities
   */
  initializeSources(hlsUrl: string, mp4Urls?: Record<VideoQuality, string>): void {
    this.availableSources = [];
    this.attemptedSources.clear();

    // Add HLS as primary source
    this.availableSources.push({
      type: 'hls',
      url: hlsUrl,
      label: 'Auto (HLS)',
    });

    // Add MP4 sources in preferred quality order
    if (mp4Urls) {
      for (const quality of this.config.qualityFallbackOrder) {
        const url = mp4Urls[quality];
        // Validate URL is a non-empty string
        if (url && typeof url === 'string' && url.trim().length > 0) {
          this.availableSources.push({
            type: 'mp4',
            url: url,
            quality,
            label: quality.toUpperCase(),
          });
        }
      }
    }

    // Set HLS as current source
    this.currentSource = this.availableSources[0] || null;
  }

  /**
   * Get the current video source
   */
  getCurrentSource(): VideoSource | null {
    return this.currentSource;
  }

  /**
   * Get all available video sources
   */
  getAvailableSources(): VideoSource[] {
    return [...this.availableSources];
  }

  /**
   * Get next fallback source based on error type
   *
   * @param error - The error that occurred
   * @returns Next video source to try, or null if no fallbacks available
   */
  getNextFallback(error: VideoError): VideoSource | null {
    if (!this.config.autoFallback || !error.fallbackAvailable) {
      return null;
    }

    // Mark current source as attempted
    if (this.currentSource) {
      this.attemptedSources.add(this.currentSource.url);
    }

    // For HLS errors, fallback to MP4
    if (error.type === VideoErrorType.HLS_ERROR) {
      return this.getFallbackToMp4();
    }

    // For format errors, try next available source
    if (error.type === VideoErrorType.FORMAT_ERROR) {
      return this.getNextUnattemptedSource();
    }

    // For network errors on MP4, try next quality
    if (error.type === VideoErrorType.NETWORK_ERROR && this.currentSource?.type === 'mp4') {
      return this.getNextMp4Quality();
    }

    return null;
  }

  /**
   * Manually switch to a specific source
   *
   * @param source - The source to switch to
   * @returns True if switch was successful
   */
  switchToSource(source: VideoSource): boolean {
    const sourceExists = this.availableSources.some(s => s.url === source.url);
    if (!sourceExists) {
      return false;
    }

    this.currentSource = source;
    this.attemptedSources.add(source.url);
    return true;
  }

  /**
   * Get preferred MP4 quality URL
   *
   * @param mp4Urls - Available MP4 URLs
   * @returns URL of preferred quality or first available quality
   */
  getPreferredMp4Url(mp4Urls: Record<VideoQuality, string>): string | null {
    // Try preferred quality first
    const preferredUrl = mp4Urls[this.config.preferredQuality];
    if (preferredUrl && typeof preferredUrl === 'string' && preferredUrl.trim().length > 0) {
      return preferredUrl;
    }

    // Try quality fallback order
    for (const quality of this.config.qualityFallbackOrder) {
      const url = mp4Urls[quality];
      if (url && typeof url === 'string' && url.trim().length > 0) {
        return url;
      }
    }

    return null;
  }

  /**
   * Check if HLS is currently being used
   */
  isUsingHls(): boolean {
    return this.currentSource?.type === 'hls';
  }

  /**
   * Check if MP4 fallback is available
   */
  hasMp4Fallback(): boolean {
    return this.availableSources.some(s => s.type === 'mp4' && !this.attemptedSources.has(s.url));
  }

  /**
   * Reset fallback state (for manual retry)
   */
  reset(): void {
    this.attemptedSources.clear();
    this.currentSource = this.availableSources[0] || null;
  }

  /**
   * Get fallback to MP4 source
   */
  private getFallbackToMp4(): VideoSource | null {
    // Find first MP4 source with preferred quality
    const preferredMp4 = this.availableSources.find(
      s => s.type === 'mp4' &&
           s.quality === this.config.preferredQuality &&
           !this.attemptedSources.has(s.url)
    );

    if (preferredMp4) {
      this.currentSource = preferredMp4;
      return preferredMp4;
    }

    // Find any unattempted MP4 source
    const anyMp4 = this.availableSources.find(
      s => s.type === 'mp4' && !this.attemptedSources.has(s.url)
    );

    if (anyMp4) {
      this.currentSource = anyMp4;
      return anyMp4;
    }

    return null;
  }

  /**
   * Get next unattempted source
   */
  private getNextUnattemptedSource(): VideoSource | null {
    const nextSource = this.availableSources.find(
      s => !this.attemptedSources.has(s.url)
    );

    if (nextSource) {
      this.currentSource = nextSource;
      return nextSource;
    }

    return null;
  }

  /**
   * Get next MP4 quality level
   */
  private getNextMp4Quality(): VideoSource | null {
    if (!this.currentSource?.quality) {
      return null;
    }

    const currentQualityIndex = this.config.qualityFallbackOrder.indexOf(
      this.currentSource.quality
    );

    // Try lower qualities
    for (let i = currentQualityIndex + 1; i < this.config.qualityFallbackOrder.length; i++) {
      const quality = this.config.qualityFallbackOrder[i];
      const source = this.availableSources.find(
        s => s.type === 'mp4' &&
             s.quality === quality &&
             !this.attemptedSources.has(s.url)
      );

      if (source) {
        this.currentSource = source;
        return source;
      }
    }

    return null;
  }
}

/**
 * Create a default fallback strategy instance
 */
export function createVideoFallbackStrategy(config?: Partial<FallbackConfig>): VideoFallbackStrategy {
  return new VideoFallbackStrategy(config);
}

/**
 * Determine if error should trigger fallback
 *
 * @param error - The video error
 * @returns True if fallback should be attempted
 */
export function shouldFallback(error: VideoError): boolean {
  return error.fallbackAvailable && (
    error.type === VideoErrorType.HLS_ERROR ||
    error.type === VideoErrorType.FORMAT_ERROR ||
    (error.type === VideoErrorType.NETWORK_ERROR && !error.retryable)
  );
}
