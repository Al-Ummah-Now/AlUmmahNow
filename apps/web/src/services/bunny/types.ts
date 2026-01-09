/**
 * Bunny.net Stream Types
 * Re-exports shared types for Bunny.net integration
 */

// Re-export value types (enums and consts)
export {
  QualityResolutionMap,
  BunnyVideoStatus,
  BunnyTranscodingLevel,
  BunnyTranscodingIssueCode,
} from '@al-ummah/shared-types';

// Re-export pure types (interfaces and type aliases)
export type {
  VideoQuality,
  BunnyConfig,
  BunnyVideoUrls,
  BunnyCaptionUrl,
  ThumbnailOptions,
  TokenOptions,
  BunnyCollectionModel,
  BunnyVideoModel,
  BunnyCaptionModel,
  BunnyChapterModel,
  BunnyMomentModel,
  BunnyMetaTagModel,
  BunnyTranscodingMessageModel,
  BunnyUploadSignature,
  BunnyUploadProgress,
} from '@al-ummah/shared-types';

// Type alias for backwards compatibility
export type { BunnyCaptionUrl as CaptionUrl } from '@al-ummah/shared-types';
