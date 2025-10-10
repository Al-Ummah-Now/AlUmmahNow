/**
 * Playlist types
 */

import { Timestamps } from './common';

export interface Playlist extends Timestamps {
  id: string;
  name: string;
  description?: string;
  userId: string;
  channelId?: string;
  thumbnailUrl?: string;

  // Stats
  videosCount?: number;
  totalDuration?: number;
  viewsCount?: number;

  // Visibility
  isPublic?: boolean;

  // Timestamps
  dateCreated: string;
  dateModified: string;
}

export interface PlaylistCreateRequest {
  name: string;
  description?: string;
  channelId?: string;
  thumbnailUrl?: string;
  isPublic?: boolean;
}

export interface PlaylistUpdateRequest {
  name?: string;
  description?: string;
  thumbnailUrl?: string;
  isPublic?: boolean;
}

export interface PlaylistListParams {
  limit?: number;
  cursor?: string;
  userId?: string;
  channelId?: string;
  isPublic?: boolean;
  sortBy?: 'dateCreated' | 'name' | 'videosCount';
  sortOrder?: 'asc' | 'desc';
}

export interface PlaylistVideo extends Timestamps {
  id: string;
  playlistId: string;
  videoId: string;
  position: number;
}

export interface PlaylistAddVideoRequest {
  videoId: string;
  position?: number;
}
