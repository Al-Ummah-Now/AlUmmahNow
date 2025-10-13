/**
 * BunnyStreamService - Service for generating Bunny.net Stream URLs
 * 
 * This service provides a clean abstraction over Bunny.net's URL structure
 * for generating HLS manifests, MP4 direct URLs, thumbnails, captions, and
 * authenticated URLs.
 * 
 * @example
 * ```typescript
 * const config = {
 *   pullZoneUrl: 'vz-xxxxx.b-cdn.net',
 *   libraryId: '12345',
 * };
 * const service = new BunnyStreamService(config);
 * const hlsUrl = service.getHlsUrl('video-guid');
 * ```
 */

import type {
  BunnyConfig,
  BunnyVideoUrls,
  CaptionUrl,
  ThumbnailOptions,
  TokenOptions,
  VideoQuality,
} from './types';
import { QualityResolutionMap } from './types';

export class BunnyStreamService {
  private readonly pullZoneUrl: string;
  private readonly libraryId: string;
  private readonly tokenAuthEnabled: boolean;

  /**
   * Creates a new BunnyStreamService instance
   * 
   * @param config - Configuration for Bunny.net Stream service
   * @throws {Error} If required configuration is missing
   */
  constructor(config: BunnyConfig) {
    if (!config.pullZoneUrl) {
      throw new Error('BunnyStreamService: pullZoneUrl is required');
    }
    if (!config.libraryId) {
      throw new Error('BunnyStreamService: libraryId is required');
    }

    this.pullZoneUrl = config.pullZoneUrl;
    this.libraryId = config.libraryId;
    this.tokenAuthEnabled = config.tokenAuthEnabled ?? false;
    
    // Note: apiKey is accepted in config for future use but not currently stored
  }

  /**
   * Get the base URL for video streaming
   * 
   * @param videoId - The video GUID
   * @returns The base URL for the video
   */
  private getBaseUrl(videoId: string): string {
    return `https://${this.pullZoneUrl}/${videoId}`;
  }

  /**
   * Generate HLS playlist URL for adaptive streaming
   * 
   * HLS (HTTP Live Streaming) is the recommended format for adaptive bitrate streaming.
   * The player will automatically switch between quality levels based on network conditions.
   * 
   * @param videoId - The video GUID
   * @param tokenOptions - Optional token authentication options
   * @returns The HLS playlist URL (m3u8)
   * 
   * @example
   * ```typescript
   * const hlsUrl = service.getHlsUrl('abc123-def456');
   * // Returns: https://vz-xxxxx.b-cdn.net/abc123-def456/playlist.m3u8
   * ```
   */
  getHlsUrl(videoId: string, tokenOptions?: TokenOptions): string {
    const baseUrl = this.getBaseUrl(videoId);
    const url = `${baseUrl}/playlist.m3u8`;
    
    if (this.tokenAuthEnabled && tokenOptions) {
      return this.addTokenAuth(url, tokenOptions);
    }
    
    return url;
  }

  /**
   * Generate MP4 direct URL for a specific quality level
   * 
   * MP4 URLs provide direct access to specific quality levels.
   * Useful for download links or when HLS is not supported.
   * 
   * @param videoId - The video GUID
   * @param quality - Video quality (240p, 360p, 480p, 720p, 1080p)
   * @param tokenOptions - Optional token authentication options
   * @returns The MP4 URL for the specified quality
   * 
   * @example
   * ```typescript
   * const mp4Url = service.getMp4Url('abc123-def456', '720p');
   * // Returns: https://vz-xxxxx.b-cdn.net/abc123-def456/play_720.mp4
   * ```
   */
  getMp4Url(videoId: string, quality: VideoQuality, tokenOptions?: TokenOptions): string {
    const baseUrl = this.getBaseUrl(videoId);
    const url = `${baseUrl}/play_${QualityResolutionMap[quality]}.mp4`;

    if (this.tokenAuthEnabled && tokenOptions) {
      return this.addTokenAuth(url, tokenOptions);
    }

    return url;
  }

  /**
   * Generate MP4 URLs for all available quality levels
   * 
   * @param videoId - The video GUID
   * @param tokenOptions - Optional token authentication options
   * @returns Record of quality to MP4 URL
   * 
   * @example
   * ```typescript
   * const mp4Urls = service.getAllMp4Urls('abc123-def456');
   * // Returns: {
   * //   '240p': 'https://vz-xxxxx.b-cdn.net/abc123-def456/play_240.mp4',
   * //   '360p': 'https://vz-xxxxx.b-cdn.net/abc123-def456/play_360.mp4',
   * //   ...
   * // }
   * ```
   */
  getAllMp4Urls(videoId: string, tokenOptions?: TokenOptions): Record<VideoQuality, string> {
    const qualities: VideoQuality[] = ['240p', '360p', '480p', '720p', '1080p'];
    const urls = {} as Record<VideoQuality, string>;
    
    for (const quality of qualities) {
      urls[quality] = this.getMp4Url(videoId, quality, tokenOptions);
    }
    
    return urls;
  }

  /**
   * Generate thumbnail URL with optional timestamp and dimensions
   * 
   * Thumbnails can be generated at specific timestamps in the video.
   * If no timestamp is provided, the default thumbnail is returned.
   * 
   * @param videoId - The video GUID
   * @param options - Thumbnail generation options
   * @returns The thumbnail image URL
   * 
   * @example
   * ```typescript
   * // Default thumbnail
   * const thumbUrl = service.getThumbnailUrl('abc123-def456');
   * // Returns: https://vz-xxxxx.b-cdn.net/abc123-def456/thumbnail.jpg
   * 
   * // Thumbnail at 30 seconds
   * const thumbUrl = service.getThumbnailUrl('abc123-def456', { timestamp: 30 });
   * // Returns: https://vz-xxxxx.b-cdn.net/abc123-def456/thumbnail_30s.jpg
   * 
   * // Thumbnail with custom dimensions
   * const thumbUrl = service.getThumbnailUrl('abc123-def456', { width: 640, height: 360 });
   * // Returns: https://vz-xxxxx.b-cdn.net/abc123-def456/thumbnail.jpg?width=640&height=360
   * ```
   */
  getThumbnailUrl(videoId: string, options?: ThumbnailOptions): string {
    const baseUrl = this.getBaseUrl(videoId);
    let url: string;

    if (options?.timestamp !== undefined) {
      url = `${baseUrl}/thumbnail_${options.timestamp}s.jpg`;
    } else {
      url = `${baseUrl}/thumbnail.jpg`;
    }

    // Add dimension parameters if provided
    const params = new URLSearchParams();
    if (options?.width) {
      params.append('width', options.width.toString());
    }
    if (options?.height) {
      params.append('height', options.height.toString());
    }

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    return url;
  }

  /**
   * Generate preview animation URL
   * 
   * Preview animations are animated thumbnails (GIF or MP4) that show
   * a short clip from the video.
   * 
   * @param videoId - The video GUID
   * @returns The preview animation URL
   * 
   * @example
   * ```typescript
   * const previewUrl = service.getPreviewUrl('abc123-def456');
   * // Returns: https://vz-xxxxx.b-cdn.net/abc123-def456/preview.webp
   * ```
   */
  getPreviewUrl(videoId: string): string {
    const baseUrl = this.getBaseUrl(videoId);
    return `${baseUrl}/preview.webp`;
  }

  /**
   * Generate caption/subtitle URL
   * 
   * Captions are stored as separate files (typically VTT or SRT format)
   * and referenced by language code.
   * 
   * @param videoId - The video GUID
   * @param languageCode - Language code (e.g., "en", "ar")
   * @returns The caption file URL
   * 
   * @example
   * ```typescript
   * const captionUrl = service.getCaptionUrl('abc123-def456', 'en');
   * // Returns: https://vz-xxxxx.b-cdn.net/abc123-def456/captions/en.vtt
   * ```
   */
  getCaptionUrl(videoId: string, languageCode: string): string {
    const baseUrl = this.getBaseUrl(videoId);
    return `${baseUrl}/captions/${languageCode}.vtt`;
  }

  /**
   * Generate URLs for multiple captions
   * 
   * @param videoId - The video GUID
   * @param captions - Array of caption configurations
   * @returns Array of caption URLs with metadata
   * 
   * @example
   * ```typescript
   * const captions = service.getCaptionUrls('abc123-def456', [
   *   { srclang: 'en', label: 'English' },
   *   { srclang: 'ar', label: 'Arabic' }
   * ]);
   * // Returns: [
   * //   { srclang: 'en', label: 'English', url: 'https://...' },
   * //   { srclang: 'ar', label: 'Arabic', url: 'https://...' }
   * // ]
   * ```
   */
  getCaptionUrls(
    videoId: string,
    captions: Array<{ srclang: string; label: string }>
  ): CaptionUrl[] {
    return captions.map(caption => ({
      srclang: caption.srclang,
      label: caption.label,
      url: this.getCaptionUrl(videoId, caption.srclang),
    }));
  }

  /**
   * Generate all video URLs in a single object
   * 
   * Convenience method that returns all URL types for a video.
   * 
   * @param videoId - The video GUID
   * @param captions - Optional caption configurations
   * @param tokenOptions - Optional token authentication options
   * @returns Object containing all video URLs
   * 
   * @example
   * ```typescript
   * const urls = service.getAllUrls('abc123-def456', [
   *   { srclang: 'en', label: 'English' }
   * ]);
   * // Returns: {
   * //   hls: 'https://...',
   * //   mp4: { '240p': '...', '360p': '...', ... },
   * //   thumbnail: 'https://...',
   * //   preview: 'https://...',
   * //   captions: [{ srclang: 'en', label: 'English', url: '...' }]
   * // }
   * ```
   */
  getAllUrls(
    videoId: string,
    captions?: Array<{ srclang: string; label: string }>,
    tokenOptions?: TokenOptions
  ): BunnyVideoUrls {
    return {
      hls: this.getHlsUrl(videoId, tokenOptions),
      mp4: this.getAllMp4Urls(videoId, tokenOptions),
      thumbnail: this.getThumbnailUrl(videoId),
      preview: this.getPreviewUrl(videoId),
      captions: captions ? this.getCaptionUrls(videoId, captions) : undefined,
    };
  }

  /**
   * Add token authentication to URL (for future use)
   * 
   * This is a placeholder for future token-based authentication.
   * Bunny.net supports token authentication with expiration and IP restrictions.
   * 
   * @param url - The base URL
   * @param _options - Token authentication options (unused in placeholder implementation)
   * @returns URL with authentication parameters
   * @private
   */
  private addTokenAuth(url: string, _options: TokenOptions): string {
    // Placeholder for future implementation
    // Token authentication would involve:
    // 1. Generating a signature based on the URL and secret key
    // 2. Adding expiration timestamp
    // 3. Optionally adding IP restrictions
    // For now, return the URL as-is
    return url;
  }

  /**
   * Get configuration information
   * 
   * @returns Current service configuration (without sensitive data)
   */
  getConfig(): Omit<BunnyConfig, 'apiKey'> {
    return {
      pullZoneUrl: this.pullZoneUrl,
      libraryId: this.libraryId,
      tokenAuthEnabled: this.tokenAuthEnabled,
    };
  }
}

/**
 * Factory function to create BunnyStreamService from environment variables
 * 
 * @returns BunnyStreamService instance configured from environment
 * @throws {Error} If required environment variables are missing
 * 
 * @example
 * ```typescript
 * // Requires environment variables:
 * // NEXT_PUBLIC_BUNNY_PULL_ZONE_URL
 * // NEXT_PUBLIC_BUNNY_LIBRARY_ID
 * const service = createBunnyStreamService();
 * ```
 */
export function createBunnyStreamService(): BunnyStreamService {
  const pullZoneUrl = process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE_URL;
  const libraryId = process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID;

  if (!pullZoneUrl) {
    throw new Error('NEXT_PUBLIC_BUNNY_PULL_ZONE_URL environment variable is required');
  }
  if (!libraryId) {
    throw new Error('NEXT_PUBLIC_BUNNY_LIBRARY_ID environment variable is required');
  }

  return new BunnyStreamService({
    pullZoneUrl,
    libraryId,
    apiKey: process.env.NEXT_PUBLIC_BUNNY_API_KEY,
    tokenAuthEnabled: process.env.NEXT_PUBLIC_BUNNY_TOKEN_AUTH === 'true',
  });
}
