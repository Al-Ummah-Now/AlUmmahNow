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
  role?: UserRole;
}

export type UserRole = 'user' | 'creator' | 'moderator' | 'admin';

export interface Profile extends Timestamps {
  id: string;
  userId: string;
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  coverUrl?: string;
  bio?: string;
  websiteUrl?: string;
  location?: string;
  channelsCount?: number;
  subscribersCount?: number;
}

export interface ProfileUpdateRequest {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  coverUrl?: string;
  bio?: string;
  websiteUrl?: string;
  location?: string;
}

export interface AuthSubject {
  type: 'user';
  properties: {
    userId: string;
    email: string;
    displayName?: string;
    role?: UserRole;
  };
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
