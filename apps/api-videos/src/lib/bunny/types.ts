/**
 * Bunny.net API Types
 * Re-exports shared types for Bunny.net integration
 */

// Re-export all Bunny types from shared package
export {
  BunnyCollectionModel,
  BunnyVideoModel,
  BunnyVideoStatus,
  BunnyCaptionModel,
  BunnyChapterModel,
  BunnyMomentModel,
  BunnyMetaTagModel,
  BunnyTranscodingMessageModel,
  BunnyTranscodingLevel,
  BunnyTranscodingIssueCode,
} from '@al-ummah/shared-types';

// Type aliases for backwards compatibility with existing code
export type { BunnyCollectionModel as CollectionModel } from '@al-ummah/shared-types';
export type { BunnyVideoModel as VideoModel } from '@al-ummah/shared-types';
export type { BunnyCaptionModel as CaptionModel } from '@al-ummah/shared-types';
export type { BunnyChapterModel as ChapterModel } from '@al-ummah/shared-types';
export type { BunnyMomentModel as MomentModel } from '@al-ummah/shared-types';
export type { BunnyMetaTagModel as MetaTagModel } from '@al-ummah/shared-types';
export type { BunnyTranscodingMessageModel as TranscodingMessageModel } from '@al-ummah/shared-types';
