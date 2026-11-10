/**
 * Channel Section Types
 *
 * Types for channel sections feature - organizing channel content
 * into sections like featured videos, playlists, recent uploads, etc.
 */

import { SoftDelete, Moderation } from './common';

// ============================================================================
// Business Model - stored in R2
// ============================================================================

export interface ChannelSection extends SoftDelete, Moderation {
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

  // Type options (docs/specs/CHANNEL-SECTIONS.md §8.1)
  trailerVideoId?: string; // channel_spotlight: shown to visitors and non-subscribers
  returningVideoId?: string; // channel_spotlight: shown to subscribers
  sort?: SectionSort; // shorts
  liveFilter?: LiveFilter; // live_streams
  postMode?: PostMode; // community_posts
  /** subscribed_channels / liked_videos: the owner's opt-in to show their own data publicly */
  consent?: SectionConsent;

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

export interface ChannelSectionView extends SoftDelete, Moderation {
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
    trailerVideoId?: string;
    returningVideoId?: string;
  };
  sort?: SectionSort;
  liveFilter?: LiveFilter;
  postMode?: PostMode;
  /** True when the owner's opt-in is in place (consent types only) */
  consented?: boolean;
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
  trailerVideoId?: string;
  returningVideoId?: string;
  sort?: SectionSort;
  liveFilter?: LiveFilter;
  postMode?: PostMode;
  /** Required (true) to create subscribed_channels / liked_videos; false on update withdraws it */
  consent?: boolean;
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
  trailerVideoId?: string | null; // null clears it (the other must remain)
  returningVideoId?: string | null;
  sort?: SectionSort;
  liveFilter?: LiveFilter;
  postMode?: PostMode;
  /** Required (true) to create subscribed_channels / liked_videos; false on update withdraws it */
  consent?: boolean;
  showTimestamp?: boolean;
  showChannelName?: boolean;
}

export interface ChannelSectionReorderInput {
  sectionIds: string[]; // Min 1, max 50
}

// ============================================================================
// Type Definitions
// ============================================================================

export const CHANNEL_SECTION_TYPES = [
  'channel_spotlight',
  'featured_videos',
  'recent_uploads',
  'popular_uploads',
  'shorts',
  'live_streams',
  'liked_videos',
  'single_playlist',
  'multiple_playlists',
  'created_playlists',
  'featured_channels',
  'subscribed_channels',
  'community_posts',
] as const;

export type ChannelSectionType = (typeof CHANNEL_SECTION_TYPES)[number];

export type DisplayStyle = 'horizontal_row' | 'vertical_list';
export type SectionSort = 'latest' | 'popular';
export type LiveFilter = 'live_and_upcoming' | 'past';
export type PostMode = 'latest' | 'pinned';

export interface SectionConsent {
  grantedBy: string; // user id of the channel owner who opted in
  grantedAt: string; // ISO string
}

// ============================================================================
// Constants
// ============================================================================

export const SectionTypes = {
  CHANNEL_SPOTLIGHT: 'channel_spotlight',
  FEATURED_VIDEOS: 'featured_videos',
  RECENT_UPLOADS: 'recent_uploads',
  POPULAR_UPLOADS: 'popular_uploads',
  SHORTS: 'shorts',
  LIVE_STREAMS: 'live_streams',
  LIKED_VIDEOS: 'liked_videos',
  SINGLE_PLAYLIST: 'single_playlist',
  MULTIPLE_PLAYLISTS: 'multiple_playlists',
  CREATED_PLAYLISTS: 'created_playlists',
  FEATURED_CHANNELS: 'featured_channels',
  SUBSCRIBED_CHANNELS: 'subscribed_channels',
  COMMUNITY_POSTS: 'community_posts',
} as const;

export const DisplayStyles = {
  HORIZONTAL_ROW: 'horizontal_row',
  VERTICAL_LIST: 'vertical_list',
} as const;

/** Groups of the "Add channel section" dialog, in display order */
export const SECTION_TYPE_GROUPS: Record<'videos' | 'playlists' | 'channels' | 'community', ChannelSectionType[]> = {
  videos: ['channel_spotlight', 'featured_videos', 'recent_uploads', 'popular_uploads', 'shorts', 'live_streams', 'liked_videos'],
  playlists: ['single_playlist', 'multiple_playlists', 'created_playlists'],
  channels: ['featured_channels', 'subscribed_channels'],
  community: ['community_posts'],
};

// Auto-populated section types (content comes from the channel, no ids picked)
export const AUTO_POPULATED_TYPES: ChannelSectionType[] = [
  'recent_uploads',
  'popular_uploads',
  'shorts',
  'live_streams',
  'created_playlists',
  'subscribed_channels',
  'liked_videos',
  'community_posts',
];

// Section types requiring specific content fields
export const CONTENT_REQUIRED_TYPES: Record<string, string[]> = {
  featured_videos: ['videoIds'],
  single_playlist: ['playlistId'],
  multiple_playlists: ['playlistIds'],
  featured_channels: ['channelIds'],
};

/** Types whose title the owner must write (the default would say nothing) */
export const TITLE_REQUIRED_TYPES: ChannelSectionType[] = ['multiple_playlists', 'featured_channels'];

/** Types that show the channel owner's personal data and need their opt-in (spec §6) */
export const CONSENT_REQUIRED_TYPES: ChannelSectionType[] = ['subscribed_channels', 'liked_videos'];

/**
 * How many sections of a type a channel may have. Types not listed are
 * unlimited. `shorts` and `live_streams` are limited per option value
 * (one per sort / per live filter), see `sectionLimitKey`.
 */
export const SECTION_TYPE_LIMITS: Partial<Record<ChannelSectionType, number>> = {
  channel_spotlight: 1,
  recent_uploads: 1,
  popular_uploads: 1,
  shorts: 1,
  live_streams: 1,
  liked_videos: 1,
  created_playlists: 1,
  subscribed_channels: 1,
  community_posts: 1,
};

/** The key a section counts against in SECTION_TYPE_LIMITS (type, plus its option where limits are per option) */
export function sectionLimitKey(section: { type: string; sort?: string; liveFilter?: string }): string {
  if (section.type === 'shorts') return `shorts:${section.sort || 'latest'}`;
  if (section.type === 'live_streams') return `live_streams:${section.liveFilter || 'live_and_upcoming'}`;
  return section.type;
}

// Validation constraints
export const CHANNEL_SECTION_CONSTRAINTS = {
  MAX_SECTIONS_PER_CHANNEL: 12,
  MAX_TITLE_LENGTH: 100,
  MAX_VIDEO_IDS: 20,
  MAX_PLAYLIST_IDS: 10,
  MAX_CHANNEL_IDS: 20,
  MIN_ITEM_COUNT: 1,
  MAX_ITEM_COUNT: 20,
  DEFAULT_ITEM_COUNT: 12,
  MAX_POST_COUNT: 6,
  DEFAULT_POST_COUNT: 3,
} as const;
