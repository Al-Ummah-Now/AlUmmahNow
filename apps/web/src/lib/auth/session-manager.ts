/**
 * Session Manager for Multi-Account and Multi-Channel Support
 *
 * This service manages multiple user accounts and channels in HttpOnly cookies.
 * It provides a centralized way to handle account switching, channel selection,
 * and token management for all authenticated users.
 *
 * Security: Uses HttpOnly + Secure + SameSite cookies (no encryption).
 * Tokens are protected by HTTPS in transit and HttpOnly prevents XSS access.
 */

import { cookies } from 'next/headers';
import type { Channel, User } from '@al-ummah/shared-types';
import { createClient } from "@openauthjs/openauth/client";
import { subjects } from '../auth';
import { logger } from '@/lib/logger-server';


// Session configuration
const SESSION_COOKIE_NAME = 'al_ummah_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
const MAX_ACCOUNTS = 10; // Maximum number of accounts per browser
const COOKIE_SIZE_WARNING_THRESHOLD = 3072; // 3KB (75% of 4KB limit)
const COOKIE_SIZE_MAX = 4096; // 4KB browser limit

// Types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}

export interface UserSession {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken: string;
  channels: Channel[];
  activeChannelId: string | null;
  lastActivity: number;
}

export interface SessionData {
  activeUserId: string;
  activeChannelId: string | null;
  accounts: Record<string, UserSession>;
}

export interface SessionContext {
  // Active user info
  userId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  displayName: string;
  avatarUrl?: string;

  // Active channel info (if selected)
  channelId?: string;
  channelName?: string;
  channel?: Channel;

  // Available accounts and channels
  availableAccounts: AccountInfo[];
  availableChannels: Channel[];
}

export interface AccountInfo {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  isActive: boolean;
  channelsCount: number;
}

/**
 * Main SessionManager class
 */
export class SessionManager {
  /**
   * Get the current session data from cookies
   */
  private static async getSessionData(): Promise<SessionData | null> {
    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

      if (!sessionCookie?.value) {
        // Try to migrate from legacy cookies
        return await this.migrateFromLegacy();
      }

      // Parse JSON from cookie
      const sessionData = JSON.parse(sessionCookie.value) as SessionData;
      return sessionData;
    } catch (error) {
      logger.error('[SessionManager] Failed to get session data:', error);
      return null;
    }
  }

  /**
   * Save session data to cookies
   */
  private static async setSessionData(data: SessionData | null): Promise<void> {
    const cookieStore = await cookies();

    if (!data) {
      cookieStore.delete(SESSION_COOKIE_NAME);
      return;
    }

    // Serialize to JSON
    const jsonValue = JSON.stringify(data);

    // Check cookie size
    this.checkCookieSize(jsonValue, data);

    cookieStore.set(SESSION_COOKIE_NAME, jsonValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });
  }

  /**
   * Check cookie size and warn if approaching limits
   */
  private static checkCookieSize(jsonValue: string, data: SessionData): void {
    const sizeInBytes = new Blob([jsonValue]).size;
    const sizeInKB = (sizeInBytes / 1024).toFixed(2);
    const accountCount = Object.keys(data.accounts).length;

    // Calculate usage percentage
    const usagePercent = ((sizeInBytes / COOKIE_SIZE_MAX) * 100).toFixed(1);

    // Always log size for monitoring
    logger.info(`[SessionManager] Cookie size: ${sizeInKB} KB (${usagePercent}% of 4KB limit) | Accounts: ${accountCount}`);

    // Warn if approaching limit
    if (sizeInBytes >= COOKIE_SIZE_WARNING_THRESHOLD) {
      logger.warn(
        `[SessionManager] ⚠️  Cookie size warning: ${sizeInKB} KB / 4 KB (${usagePercent}%)\nConsider reducing data or implementing server-side session storage.`,
        { accountCount }
      );
    }

    // Error if exceeding limit
    if (sizeInBytes >= COOKIE_SIZE_MAX) {
      const breakdown = this.getCookieSizeBreakdown(data);
      logger.error(
        `[SessionManager] 🚨 Cookie size EXCEEDED: ${sizeInKB} KB / 4 KB\nBrowser may reject this cookie!`,
        { breakdown }
      );
      throw new Error(
        `Session cookie size (${sizeInKB} KB) exceeds browser limit (4 KB). ` +
        `Remove accounts or reduce data. Current accounts: ${accountCount}`
      );
    }
  }

  /**
   * Get detailed size breakdown of cookie data
   */
  private static getCookieSizeBreakdown(data: SessionData): Record<string, string> {
    const breakdown: Record<string, string> = {};

    // Calculate size of each account
    Object.entries(data.accounts).forEach(([userId, account]) => {
      const accountSize = new Blob([JSON.stringify(account)]).size;
      breakdown[`account_${userId}`] = `${(accountSize / 1024).toFixed(2)} KB`;
    });

    // Calculate size of metadata
    const metadataSize = new Blob([JSON.stringify({
      activeUserId: data.activeUserId,
      activeChannelId: data.activeChannelId,
    })]).size;
    breakdown['metadata'] = `${(metadataSize / 1024).toFixed(2)} KB`;

    return breakdown;
  }

  /**
   * Get current session cookie size info
   */
  static async getCookieSizeInfo(): Promise<{
    sizeBytes: number;
    sizeKB: string;
    usagePercent: string;
    accountCount: number;
    isNearLimit: boolean;
    isOverLimit: boolean;
    breakdown?: Record<string, string>;
  } | null> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return null;

    const jsonValue = JSON.stringify(sessionData);
    const sizeBytes = new Blob([jsonValue]).size;
    const sizeKB = (sizeBytes / 1024).toFixed(2);
    const usagePercent = ((sizeBytes / COOKIE_SIZE_MAX) * 100).toFixed(1);
    const accountCount = Object.keys(sessionData.accounts).length;

    return {
      sizeBytes,
      sizeKB,
      usagePercent,
      accountCount,
      isNearLimit: sizeBytes >= COOKIE_SIZE_WARNING_THRESHOLD,
      isOverLimit: sizeBytes >= COOKIE_SIZE_MAX,
      breakdown: this.getCookieSizeBreakdown(sessionData),
    };
  }

  /**
   * Migrate from legacy single-account cookies
   */
  private static async migrateFromLegacy(): Promise<SessionData | null> {
    try {
      const cookieStore = await cookies();
      const accessToken = cookieStore.get('access_token');
      const refreshToken = cookieStore.get('refresh_token');

      if (!accessToken?.value || !refreshToken?.value) {
        return null;
      }

      // Verify and extract user info from token
      const client = await this.getAuthClient();
      const verified = await client.verify(subjects, accessToken.value, {
        refresh: refreshToken.value,
      });

      if (verified.err || !verified.subject) {
        return null;
      }

      const userInfo = verified.subject.properties;
      const userId = userInfo.id; // Extract userId from JWT subject

      // Create new session structure
      // Note: OpenAuth JWT only includes id and email (see subjects.ts)
      const sessionData: SessionData = {
        activeUserId: userId,
        activeChannelId: null,
        accounts: {
          [userId]: {
            userId,
            email: userInfo.email,
            displayName: userInfo.email, // Use email as fallback, profile API will provide actual displayName
            accessToken: accessToken.value,
            refreshToken: refreshToken.value,
            channels: [],
            activeChannelId: null,
            lastActivity: Date.now(),
          },
        },
      };

      // Save new structure
      await this.setSessionData(sessionData);

      // Delete legacy cookies
      cookieStore.delete('access_token');
      cookieStore.delete('refresh_token');

      // Load profile and channels in background (don't await to speed up migration)
      this.loadUserProfile(userId).catch(err =>
        logger.error('[SessionManager] Background profile load failed:', err)
      );
      this.loadUserChannels(userId).catch(err =>
        logger.error('[SessionManager] Background channels load failed:', err)
      );

      return sessionData;
    } catch (error) {
      logger.error('[SessionManager] Migration failed:', error);
      return null;
    }
  }

  /**
   * Get OpenAuth client instance
   */
  private static async getAuthClient() {
    return createClient({
      clientID: process.env.ClientId!,
      issuer: process.env.Issuer!,
    });
  }

  /**
   * Add a new account to the session
   */
  static async addAccount(tokens: AuthTokens, userInfo: User): Promise<void> {
    const sessionData = await this.getSessionData() || {
      activeUserId: userInfo.id,
      activeChannelId: null,
      accounts: {},
    };

    // Check max accounts limit
    if (Object.keys(sessionData.accounts).length >= MAX_ACCOUNTS) {
      throw new Error(`Maximum ${MAX_ACCOUNTS} accounts allowed`);
    }

    // Add or update account
    sessionData.accounts[userInfo.id] = {
      userId: userInfo.id,
      email: userInfo.email,
      displayName: userInfo.displayName || userInfo.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      channels: [],
      activeChannelId: null,
      lastActivity: Date.now(),
    };

    // Set as active if first account
    if (Object.keys(sessionData.accounts).length === 1) {
      sessionData.activeUserId = userInfo.id;
    }

    await this.setSessionData(sessionData);

    // Load user's profile (to get actual displayName) and channels in parallel
    await Promise.all([
      this.loadUserProfile(userInfo.id),
      this.loadUserChannels(userInfo.id),
    ]);
  }

  /**
   * Remove an account from the session
   */
  static async removeAccount(userId: string): Promise<void> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return;

    delete sessionData.accounts[userId];

    // If removed account was active, switch to another
    if (sessionData.activeUserId === userId) {
      const remainingUserIds = Object.keys(sessionData.accounts);
      if (remainingUserIds.length > 0) {
        sessionData.activeUserId = remainingUserIds[0];
        sessionData.activeChannelId = sessionData.accounts[remainingUserIds[0]].activeChannelId;
      } else {
        // No accounts left, clear session
        await this.setSessionData(null);
        return;
      }
    }

    await this.setSessionData(sessionData);
  }

  /**
   * Switch to a different user account
   */
  static async setActiveAccount(userId: string): Promise<void> {
    const sessionData = await this.getSessionData();
    if (!sessionData || !sessionData.accounts[userId]) {
      throw new Error('Account not found');
    }

    sessionData.activeUserId = userId;
    const targetAccount = sessionData.accounts[userId];

    // Validate and set active channel
    if (targetAccount.activeChannelId) {
      // Check if the stored channel still exists for this user
      const channelStillExists = targetAccount.channels.find(c => c.id === targetAccount.activeChannelId);
      if (channelStillExists) {
        sessionData.activeChannelId = targetAccount.activeChannelId;
      } else {
        // Stored channel no longer exists, reset to first/main channel or null
        const mainChannel = targetAccount.channels.find(c => c.isMain) || targetAccount.channels[0];
        targetAccount.activeChannelId = mainChannel?.id || null;
        sessionData.activeChannelId = mainChannel?.id || null;
      }
    } else {
      // No stored channel, try to set first/main channel or null
      const mainChannel = targetAccount.channels.find(c => c.isMain) || targetAccount.channels[0];
      targetAccount.activeChannelId = mainChannel?.id || null;
      sessionData.activeChannelId = mainChannel?.id || null;
    }

    sessionData.accounts[userId].lastActivity = Date.now();

    await this.setSessionData(sessionData);

    // Refresh profile in background to ensure latest data
    this.loadUserProfile(userId).catch(err =>
      logger.error('[SessionManager] Background profile refresh failed on account switch:', err)
    );
  }

  /**
   * Set the active channel for the current user
   */
  static async setActiveChannel(channelId: string | null): Promise<void> {
    const sessionData = await this.getSessionData();
    if (!sessionData) {
      throw new Error('No active session');
    }

    const activeAccount = sessionData.accounts[sessionData.activeUserId];
    if (!activeAccount) {
      throw new Error('Active account not found');
    }

    // Verify channel belongs to user
    if (channelId && !activeAccount.channels.find(c => c.id === channelId)) {
      throw new Error('Channel does not belong to user');
    }

    activeAccount.activeChannelId = channelId;
    sessionData.activeChannelId = channelId;
    activeAccount.lastActivity = Date.now();

    await this.setSessionData(sessionData);
  }

  /**
   * Get the active session context
   */
  static async getActiveSession(): Promise<SessionContext | null> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return null;

    const activeAccount = sessionData.accounts[sessionData.activeUserId];
    if (!activeAccount) return null;

    logger.info('[SessionManager.getActiveSession] TRACE BEFORE FILTER:', {
      userId: activeAccount.userId,
      email: activeAccount.email,
      'sessionData.activeChannelId': sessionData.activeChannelId,
      'activeAccount.activeChannelId': activeAccount.activeChannelId,
      'activeAccount.channels': activeAccount.channels.map(c => ({ id: c.id, name: c.name, userId: c.userId })),
    });

    // IMPORTANT: Filter out channels that don't belong to their respective users for ALL accounts
    // This can happen if old session data has stale channels from before fixes
    let sessionNeedsUpdate = false;

    Object.values(sessionData.accounts).forEach(account => {
      const accountChannels = account.channels.filter(c => c.userId === account.userId);

      if (accountChannels.length !== account.channels.length) {
        logger.info('[SessionManager] Cleaning channels for user:', {
          userId: account.userId,
          email: account.email,
          before: account.channels.length,
          after: accountChannels.length,
          removed: account.channels.filter(c => c.userId !== account.userId).map(c => c.name),
        });
        account.channels = accountChannels;
        sessionNeedsUpdate = true;
      }
    });

    // Find active channel - MUST belong to active user
    const activeChannel = activeAccount.channels.find(
      c => c.id === sessionData.activeChannelId
    );

    // If activeChannelId doesn't match any channel for this user, clear it
    if (sessionData.activeChannelId && !activeChannel) {
      logger.info('[SessionManager] Active channel ID does not belong to current user, clearing it');
      sessionData.activeChannelId = null;
      activeAccount.activeChannelId = null;
      sessionNeedsUpdate = true;
    }

    // Save updated session data if we made changes
    if (sessionNeedsUpdate) {
      await this.setSessionData(sessionData);
    }

    logger.info('[SessionManager.getActiveSession] TRACE AFTER FILTER:', {
      userId: activeAccount.userId,
      email: activeAccount.email,
      'sessionData.activeChannelId': sessionData.activeChannelId,
      'activeAccount.activeChannelId': activeAccount.activeChannelId,
      'activeChannel': activeChannel ? activeChannel.name : null,
      'activeAccount.channels.length': activeAccount.channels.length,
    });

    // Build account info for all accounts
    // IMPORTANT: Filter channels for each account to ensure counts are accurate
    const availableAccounts: AccountInfo[] = Object.values(sessionData.accounts).map(account => {
      // Filter channels to only those belonging to this account
      const accountChannels = account.channels.filter(c => c.userId === account.userId);

      return {
        userId: account.userId,
        email: account.email,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        isActive: account.userId === sessionData.activeUserId,
        channelsCount: accountChannels.length,
      };
    });

    return {
      userId: activeAccount.userId,
      accessToken: activeAccount.accessToken,
      refreshToken: activeAccount.refreshToken,
      email: activeAccount.email,
      displayName: activeAccount.displayName,
      avatarUrl: activeAccount.avatarUrl,
      channelId: activeChannel?.id,
      channelName: activeChannel?.name,
      channel: activeChannel,
      availableAccounts,
      availableChannels: activeAccount.channels,
    };
  }

  /**
   * Get all sessions
   */
  static async getAllSessions(): Promise<AccountInfo[]> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return [];

    return Object.values(sessionData.accounts).map(account => {
      // Filter channels to only those belonging to this account (same as getActiveSession)
      const accountChannels = account.channels.filter(c => c.userId === account.userId);

      return {
        userId: account.userId,
        email: account.email,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        isActive: account.userId === sessionData.activeUserId,
        channelsCount: accountChannels.length,
      };
    });
  }

  /**
   * Get session for a specific user
   */
  static async getSessionForUser(userId: string): Promise<UserSession | null> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return null;

    return sessionData.accounts[userId] || null;
  }

  /**
   * Load channels for a user
   */
  static async loadUserChannels(userId: string): Promise<Channel[]> {
    const sessionData = await this.getSessionData();
    if (!sessionData || !sessionData.accounts[userId]) {
      throw new Error('User session not found');
    }

    const account = sessionData.accounts[userId];

    try {
      // Import dynamically to avoid circular dependency
      const { apiRequestServer, buildApiUrl, buildQueryParams } = await import('../api/api-client');

      // Fetch channels for this specific user using their own access token
      const queryString = buildQueryParams({ });
      const response = await apiRequestServer<{ data: Channel[]; cursor: string; limit: number }>(
        {
          method: 'GET',
          url: buildApiUrl(`/api/channels${queryString}`),
          functionName: 'SessionManager.loadUserChannels'
        },
        async () => ({
          userId: account.userId,
          accessToken: account.accessToken,  // Use this user's token, not active user's token
        }),
        false  // Don't require auth (we're providing the token explicitly)
      );

      if (response?.data) {
        account.channels = Array.isArray(response.data) ? response.data : [];

        // Set first channel as active if none selected AND channels exist
        // Clear active channel if no channels exist
        if (account.channels.length > 0) {
          if (!account.activeChannelId) {
            const mainChannel = account.channels.find(c => c.isMain) || account.channels[0];
            account.activeChannelId = mainChannel.id;

            if (sessionData.activeUserId === userId) {
              sessionData.activeChannelId = mainChannel.id;
            }
          }
        } else {
          // No channels - clear active channel ID
          account.activeChannelId = null;
          if (sessionData.activeUserId === userId) {
            sessionData.activeChannelId = null;
          }
        }

        await this.setSessionData(sessionData);
        return account.channels;
      }
    } catch (error) {
      logger.error('[SessionManager] Failed to load channels:', error);
    }

    return [];
  }

  /**
   * Load profile for a user and update displayName
   */
  static async loadUserProfile(userId: string): Promise<void> {
    const sessionData = await this.getSessionData();
    if (!sessionData || !sessionData.accounts[userId]) {
      logger.error('[SessionManager] User session not found for profile load');
      return;
    }

    const account = sessionData.accounts[userId];

    try {
      // Import dynamically to avoid circular dependency
      const { apiRequestServer, buildApiUrl } = await import('../api/api-client');

      // Fetch user's profile directly from API
      // Note: profiles API only exports getProfileCurrent() which uses auth context
      // We need to fetch by specific userId, so we call the API directly
      const profile = await apiRequestServer<unknown>(
        {
          method: 'GET',
          url: buildApiUrl(`/api/profiles/${userId}`),
          functionName: 'SessionManager.loadUserProfile'
        },
        async () => ({
          userId: account.userId,
          accessToken: account.accessToken,
        }),
        true // require auth
      );

      if (profile) {
        // Update displayName and avatarUrl from profile
        // Handle different response formats (direct profile object or wrapped)
        const profileResponse = profile as Record<string, unknown>;
        const profileData = ('profile' in profileResponse ? profileResponse.profile : profileResponse) as Record<string, unknown>;

        account.displayName = (profileData.displayName as string) || (profileData.email as string) || account.email;
        account.avatarUrl = profileData.avatarUrl as string | undefined;
        await this.setSessionData(sessionData);
        logger.info('[SessionManager] Updated profile for user', {
          userId,
          displayName: account.displayName,
          hasAvatar: !!account.avatarUrl
        });
      }
    } catch (error) {
      logger.error('[SessionManager] Failed to load profile:', error);
      // Keep using email as displayName fallback
    }
  }

  /**
   * Refresh token for a specific user
   */
  static async refreshTokenForUser(userId: string): Promise<boolean> {
    const sessionData = await this.getSessionData();
    if (!sessionData || !sessionData.accounts[userId]) {
      return false;
    }

    const account = sessionData.accounts[userId];

    try {
      const client = await this.getAuthClient();
      const verified = await client.verify(subjects, account.accessToken, {
        refresh: account.refreshToken,
      });

      // Check if verification was successful and tokens were refreshed
      if (!verified.err && 'tokens' in verified && verified.tokens) {
        account.accessToken = verified.tokens.access;
        account.refreshToken = verified.tokens.refresh;
        account.lastActivity = Date.now();
        await this.setSessionData(sessionData);
        return true;
      }
    } catch (error) {
      logger.error(`[SessionManager] Token refresh failed for user ${userId}:`, error);
    }

    return false;
  }

  /**
   * Refresh tokens for all accounts
   */
  static async refreshAllTokens(): Promise<void> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return;

    const refreshPromises = Object.keys(sessionData.accounts).map(userId =>
      this.refreshTokenForUser(userId)
    );

    await Promise.allSettled(refreshPromises);
  }

  /**
   * Cleanup expired sessions (30 days of inactivity)
   */
  static async cleanupExpiredSessions(): Promise<void> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return;

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    let hasChanges = false;

    Object.entries(sessionData.accounts).forEach(([userId, account]) => {
      if (account.lastActivity < thirtyDaysAgo) {
        delete sessionData.accounts[userId];
        hasChanges = true;

        // Update active user if needed
        if (sessionData.activeUserId === userId) {
          const remainingUserIds = Object.keys(sessionData.accounts);
          if (remainingUserIds.length > 0) {
            sessionData.activeUserId = remainingUserIds[0];
            sessionData.activeChannelId = sessionData.accounts[remainingUserIds[0]].activeChannelId;
          }
        }
      }
    });

    if (hasChanges) {
      if (Object.keys(sessionData.accounts).length === 0) {
        await this.setSessionData(null);
      } else {
        await this.setSessionData(sessionData);
      }
    }
  }

  /**
   * Clear all sessions (logout all accounts)
   */
  static async clearAllSessions(): Promise<void> {
    await this.setSessionData(null);
  }
}