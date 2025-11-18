/**
 * Channel types
 */

import { Timestamps } from './common';

export interface Channel extends Timestamps {
  id: string;
  userId: string;
  email: string;
  name: string;
  nameLocalized?: Record<string, string>; // Multi-language names
  description?: string;
  descriptionLocalized?: Record<string, string>; // Multi-language descriptions
  avatarUrl?: string;
  coverUrl?: string;
  isMain: boolean;
  isVerified?: boolean;

  // Stats
  subscribersCount?: number;
  videosCount?: number; // Long-form videos
  shortsCount?: number; // Short-form videos
  liveStreamsCount?: number; // Past + upcoming live streams
  playlistsCount?: number; // Public playlists
  totalViews?: number;

  // Metadata
  category?: string;
  tags?: string[];
  websiteUrl?: string;
  socialLinks?: SocialLinks;

  // Timestamps
  dateCreated: string;
  dateModified: string;
}

export interface SocialLinks {
  twitter?: string;
  facebook?: string;
  instagram?: string;
  youtube?: string;
  website?: string;
}

export interface ChannelCreateRequest {
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  category?: string;
  tags?: string[];
  websiteUrl?: string;
  socialLinks?: SocialLinks;
}

export interface ChannelUpdateRequest {
  name?: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  category?: string;
  tags?: string[];
  websiteUrl?: string;
  socialLinks?: SocialLinks;
}

export interface ChannelListParams {
  limit?: number;
  cursor?: string;
  userId?: string;
  isVerified?: boolean;
  category?: string;
  sortBy?: 'dateCreated' | 'subscribersCount' | 'videosCount' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface Subscription extends Timestamps {
  id: string;
  userId: string;
  channelId: string;
  notificationsEnabled?: boolean;
}

export interface SubscriptionRequest {
  notificationsEnabled?: boolean;
}
