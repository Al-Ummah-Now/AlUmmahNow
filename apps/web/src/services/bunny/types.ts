/**
 * TypeScript types and interfaces for Bunny.net Stream service
 */

/**
 * Configuration options for Bunny.net Stream service
 */
export interface BunnyConfig {
  /** Pull Zone URL (e.g., "vz-xxxxx.b-cdn.net") */
  pullZoneUrl: string;
  /** Bunny.net library ID */
  libraryId: string;
  /** API key for authenticated requests (optional) */
  apiKey?: string;
  /** Enable token-based authentication (optional, for future use) */
  tokenAuthEnabled?: boolean;
}

/**
 * Supported video quality levels
 */
export type VideoQuality = '240p' | '360p' | '480p' | '720p' | '1080p';

/**
 * Map of video quality to resolution height
 */
export const QualityResolutionMap: Record<VideoQuality, number> = {
  '240p': 240,
  '360p': 360,
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
};

/**
 * Collection of all video URLs for different qualities and formats
 */
export interface BunnyVideoUrls {
  /** HLS playlist URL for adaptive streaming */
  hls: string;
  /** MP4 direct URLs for each quality level */
  mp4: Record<VideoQuality, string>;
  /** Thumbnail URL (with optional timestamp) */
  thumbnail: string;
  /** Preview animation/GIF URL */
  preview: string;
  /** Captions/subtitles URLs */
  captions?: CaptionUrl[];
}

/**
 * Caption/subtitle URL with language information
 */
export interface CaptionUrl {
  /** Language code (e.g., "en", "ar") */
  srclang: string;
  /** Human-readable label (e.g., "English", "Arabic") */
  label: string;
  /** Caption file URL */
  url: string;
}

/**
 * Options for generating thumbnail URLs
 */
export interface ThumbnailOptions {
  /** Timestamp in seconds for thumbnail snapshot */
  timestamp?: number;
  /** Thumbnail width in pixels */
  width?: number;
  /** Thumbnail height in pixels */
  height?: number;
}

/**
 * Options for generating authenticated URLs
 */
export interface TokenOptions {
  /** Expiration time in seconds from now */
  expiresIn?: number;
  /** IP address to restrict access to */
  ipAddress?: string;
  /** Additional security token */
  token?: string;
}
