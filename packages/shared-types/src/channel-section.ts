/**
 * Channel Section Types
 *
 * Types for channel sections feature - organizing channel content
 * into sections like featured videos, playlists, recent uploads, etc.
 */

// ============================================================================
// Business Model - stored in R2
// ============================================================================

export interface ChannelSection {
  id: string;
  channelId: string;
  userId: string;

  // Section configuration
  type: ChannelSectionType;

  // Localized content
  title: string;
  titleLocalized?: Record<string, string>;

  // Display settings
  position: number; // Zero-based ordering
  style: DisplayStyle;

  // Content references (populated based on type)
  videoIds?: string[];
  playlistId?: string;
  playlistIds?: string[];
  channelIds?: string[];

  // Item display settings
  itemCount: number;
  showTimestamp: boolean;
  showChannelName: boolean;

  // Timestamps
  dateCreated: string; // ISO string
  dateModified: string; // ISO string
}

// ============================================================================
// View Model - returned in API responses
// ============================================================================

export interface ChannelSectionView {
  id: string;
  channelId: string;
  type: string;
  title: string;
  titleLocalized?: Record<string, string>;
  position: number;
  style: string;
  itemCount: number;
  showTimestamp: boolean;
  showChannelName: boolean;
  content: {
    videoIds?: string[];
    playlistId?: string;
    playlistIds?: string[];
    channelIds?: string[];
  };
  dateCreated: string;
  dateModified: string;
}

// ============================================================================
// Input Models
// ============================================================================

export interface ChannelSectionCreateInput {
  type: ChannelSectionType;
  title: string; // Min 1, max 100 chars
  titleLocalized?: Record<string, string>;
  style?: DisplayStyle;
  videoIds?: string[]; // Max 20
  playlistId?: string;
  playlistIds?: string[]; // Max 10
  channelIds?: string[]; // Max 20
  itemCount?: number; // Min 1, max 20, default 12
  showTimestamp?: boolean;
  showChannelName?: boolean;
}

export interface ChannelSectionUpdateInput {
  title?: string; // Min 1, max 100 chars
  titleLocalized?: Record<string, string>;
  style?: DisplayStyle;
  videoIds?: string[]; // Max 20
  playlistId?: string;
  playlistIds?: string[]; // Max 10
  channelIds?: string[]; // Max 20
  itemCount?: number; // Min 1, max 20
  showTimestamp?: boolean;
  showChannelName?: boolean;
}

export interface ChannelSectionReorderInput {
  sectionIds: string[]; // Min 1, max 50
}

// ============================================================================
// Type Definitions
// ============================================================================

export type ChannelSectionType =
  | 'featured_videos'
  | 'recent_uploads'
  | 'popular_uploads'
  | 'single_playlist'
  | 'multiple_playlists'
  | 'subscribed_channels'
  | 'liked_videos';

export type DisplayStyle = 'horizontal_row' | 'vertical_list';

// ============================================================================
// Constants
// ============================================================================

export const SectionTypes = {
  FEATURED_VIDEOS: 'featured_videos',
  RECENT_UPLOADS: 'recent_uploads',
  POPULAR_UPLOADS: 'popular_uploads',
  SINGLE_PLAYLIST: 'single_playlist',
  MULTIPLE_PLAYLISTS: 'multiple_playlists',
  SUBSCRIBED_CHANNELS: 'subscribed_channels',
  LIKED_VIDEOS: 'liked_videos',
} as const;

export const DisplayStyles = {
  HORIZONTAL_ROW: 'horizontal_row',
  VERTICAL_LIST: 'vertical_list',
} as const;

// Auto-populated section types (content is automatically generated)
export const AUTO_POPULATED_TYPES: ChannelSectionType[] = [
  'recent_uploads',
  'popular_uploads',
  'subscribed_channels',
  'liked_videos',
];

// Section types requiring specific content fields
export const CONTENT_REQUIRED_TYPES: Record<string, string[]> = {
  featured_videos: ['videoIds'],
  single_playlist: ['playlistId'],
  multiple_playlists: ['playlistIds'],
};

// Validation constraints
export const CHANNEL_SECTION_CONSTRAINTS = {
  MAX_SECTIONS_PER_CHANNEL: 50,
  MAX_TITLE_LENGTH: 100,
  MAX_VIDEO_IDS: 20,
  MAX_PLAYLIST_IDS: 10,
  MAX_CHANNEL_IDS: 20,
  MIN_ITEM_COUNT: 1,
  MAX_ITEM_COUNT: 20,
  DEFAULT_ITEM_COUNT: 12,
} as const;