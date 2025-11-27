/**
 * User and profile types
 */

import { Timestamps } from './common';

export interface User extends Timestamps {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  isEmailVerified?: boolean;
  isActive?: boolean;
  roles?: UserRole[];
}

export type UserRole = 'user' | 'creator' | 'moderator' | 'admin';

export interface Profile extends Timestamps {
  id: string;
  userId: string;
  email: string;
  displayName?: string;
  displayNameLocalized?: Record<string, string>; // Multi-language display names
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  coverUrl?: string;
  bio?: string;
  bioLocalized?: Record<string, string>; // Multi-language bios
  websiteUrl?: string;
  location?: string;
  timezone?: string; // IANA timezone (e.g., 'America/New_York', 'Asia/Dubai') - defaults to browser timezone
  channelsCount?: number;
  subscribersCount?: number;
}

export interface ProfileUpdateRequest {
  displayName?: string;
  displayNameLocalized?: Record<string, string>;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  coverUrl?: string;
  bio?: string;
  bioLocalized?: Record<string, string>;
  websiteUrl?: string;
  location?: string;
  timezone?: string; // IANA timezone
}

/**
 * Auth subject from OpenAuth token
 * Matches the auth server's subjects definition
 */
export interface AuthSubject {
  type: 'user';
  properties: AuthUser;
}

/**
 * User properties from the auth token
 */
export interface AuthUser {
  id: string;
  email: string;
  roles?: string[];
}

export interface AuthHeaders {
  userId?: string;
  channelId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
