import { Timestamps } from './common';

/**
 * Channel Section - Matches YouTube Data API v3 structure
 */
export interface ChannelSection extends Timestamps {
  id: string;
  channelId: string;

  // Snippet (basic metadata)
  type: ChannelSectionType;
  title?: string; // Required only for multiplePlaylists, multipleChannels
  position: number; // Zero-based ordering

  // Content Details
  playlists?: string[]; // Playlist IDs (for singlePlaylist, multiplePlaylists)
  channels?: string[]; // Channel IDs (for multipleChannels)

  // Timestamps
  dateCreated: string;
  dateModified: string;
}

/**
 * YouTube's exact 10 section types
 */
export type ChannelSectionType =
  | 'allPlaylists'
  | 'completedEvents'
  | 'liveEvents'
  | 'multipleChannels'
  | 'multiplePlaylists'
  | 'popularUploads'
  | 'recentUploads'
  | 'singlePlaylist'
  | 'subscriptions'
  | 'upcomingEvents';

/**
 * Create channel section request
 */
export interface ChannelSectionCreateRequest {
  type: ChannelSectionType;
  title?: string; // Max 100 chars, required for multiplePlaylists/multipleChannels
  position?: number; // If omitted, add to end
  playlists?: string[]; // Required for singlePlaylist (exactly 1), multiplePlaylists (1+)
  channels?: string[]; // Required for multipleChannels (1+)
}

/**
 * Update channel section request
 */
export interface ChannelSectionUpdateRequest {
  title?: string;
  playlists?: string[];
  channels?: string[];
}

/**
 * Reorder sections request
 */
export interface ChannelSectionReorderRequest {
  sectionId: string;
  newPosition: number;
}

/**
 * List channel sections params
 */
export interface ChannelSectionListParams {
  channelId: string;
}

/**
 * Validation rules matching YouTube's constraints
 */
export const CHANNEL_SECTION_CONSTRAINTS = {
  MAX_SECTIONS_PER_CHANNEL: 10,
  MAX_TITLE_LENGTH: 100,
  TITLE_REQUIRED_FOR_TYPES: ['multiplePlaylists', 'multipleChannels'] as const,
  PLAYLISTS_REQUIRED_FOR_TYPES: ['singlePlaylist', 'multiplePlaylists'] as const,
  CHANNELS_REQUIRED_FOR_TYPES: ['multipleChannels'] as const,
  SINGLE_PLAYLIST_EXACT_COUNT: 1, // singlePlaylist must have exactly 1 playlist
} as const;