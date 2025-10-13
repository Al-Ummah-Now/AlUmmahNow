/**
 * Bunny.net Stream Service
 * 
 * This module provides a clean abstraction for generating Bunny.net Stream URLs
 * including HLS manifests, MP4 direct URLs, thumbnails, captions, and previews.
 */

export { BunnyStreamService, createBunnyStreamService } from './stream.service';
export type {
  BunnyConfig,
  BunnyVideoUrls,
  CaptionUrl,
  ThumbnailOptions,
  TokenOptions,
  VideoQuality,
} from './types';
export { QualityResolutionMap } from './types';
