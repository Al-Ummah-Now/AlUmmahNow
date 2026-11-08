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
import { getOpenAuthClient } from "./openauth-client";
import { subjects } from '../auth';
import { logger } from '@/lib/logger-server';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie';
import {
  applyKnownRotations,
  computeExpiresAt,
  mergeSessionTokens,
  refreshAccountInSession,
  shouldRefresh,
  type AccountRefreshResult,
} from './token-refresh';
import { revokeTokensOnSignOut } from './revoke-on-sign-out';


// Session configuration
const MAX_ACCOUNTS = 10; // Maximum number of accounts per browser
const COOKIE_SIZE_WARNING_THRESHOLD = 3072; // 3KB (75% of 4KB limit)
const COOKIE_SIZE_MAX = 4096; // 4KB browser limit

/**
 * Reduces an API channel record to the fields the UI reads from the session.
 * The channel list endpoint returns full records (descriptions plus embedded
 * playlist/video/subscriber arrays); caching those in the cookie overflowed
 * the 4KB limit for accounts with ~4 channels, which made login fail.
 */
export function toSessionChannel(channel: Channel): Channel {
  return {
    id: channel.id,
    userId: channel.userId,
    name: channel.name,
    nameLocalized: channel.nameLocalized,
    avatarUrl: channel.avatarUrl,
    isMain: channel.isMain,
    isVerified: channel.isVerified,
    isPrivate: channel.isPrivate,
    subscribersCount: channel.subscribersCount,
    videosCount: channel.videosCount,
    dateCreated: channel.dateCreated,
    dateModified: channel.dateModified,
  } as Channel;
}

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
  /**
   * When accessToken expires (epoch ms). Missing in cookies written before it
   * existed; token-refresh.ts then reads the JWT `exp` instead.
   */
  expiresAt?: number;
  /**
   * The issuer rejected the refresh token: the account must sign in again.
   * Its tokens are never sent; getActiveSession() treats it as signed out.
   */
  needsSignIn?: boolean;
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
  /** When accessToken expires (epoch ms), when known */
  expiresAt?: number;
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
  /** The account's sign-in has ended (refresh token rejected) */
  needsSignIn?: boolean;
}

/** Result of SessionManager.refreshAccount */
export type RefreshAccountResult =
  | AccountRefreshResult
  /** The token was still fresh (or another request already renewed it) */
  | 'fresh'
  /** Cookies cannot be written here (Server Component render): not refreshed */
  | 'read-only';

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
      // Another request in this isolate may have rotated a refresh token this
      // cookie still holds; use the newer pair (persisted on the next write)
      applyKnownRotations(sessionData);
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

    // Never write an older token pair over a newer one: the cookie may have
    // been rewritten (e.g. by a token refresh) since `data` was read
    mergeSessionTokens(this.parseSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value), data);
    applyKnownRotations(data);

    // Serialize to JSON
    const jsonValue = JSON.stringify(data);

    // Nothing changed (e.g. the periodic channel refresh): skip the write. A
    // cookie set in a Server Action makes Next re-render the whole route, which
    // refetched the page's data and churned the DOM under the user's taps.
    if (cookieStore.get(SESSION_COOKIE_NAME)?.value === jsonValue) {
      return;
    }

    // Check cookie size
    this.checkCookieSize(jsonValue, data);

    cookieStore.set(SESSION_COOKIE_NAME, jsonValue, sessionCookieOptions());
  }

  private static parseSessionCookie(value: string | undefined): SessionData | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as SessionData;
    } catch {
      return null;
    }
  }

  /** The session cookie as it is now in this request (no legacy migration). */
  private static async readStoredSession(): Promise<SessionData | null> {
    const cookieStore = await cookies();
    return this.parseSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  }

  /**
   * True when this context may write cookies (Route Handler, Server Action).
   * Checked BEFORE spending a refresh token: a rotated token that cannot be
   * saved is lost, and the old one dies after the issuer's 60 s reuse window.
   */
  private static async canWriteCookies(): Promise<boolean> {
    try {
      const cookieStore = await cookies();
      const current = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      if (current === undefined) return false;
      cookieStore.set(SESSION_COOKIE_NAME, current, sessionCookieOptions());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Saves a clean-up of the session where cookies are writable (Route
   * Handlers, Server Actions) and skips it during a Server Component render,
   * where cookies().set() throws. Reads must never fail because a write is not
   * allowed: that turned signed-in renders into signed-out ones (#288).
   */
  private static async persistIfWritable(data: SessionData | null): Promise<void> {
    try {
      await this.setSessionData(data);
    } catch (error) {
      logger.debug('[SessionManager] Session clean-up not saved (read-only cookies in this render)', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
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
    logger.debug(`[SessionManager] Cookie size: ${sizeInKB} KB (${usagePercent}% of 4KB limit) | Accounts: ${accountCount}`);

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

      // verify() refreshes an expired token, rotating the refresh token: keep
      // the new pair (the old refresh token stops working after 60 s)
      const migratedTokens = 'tokens' in verified && verified.tokens
        ? { access: verified.tokens.access, refresh: verified.tokens.refresh, expiresIn: verified.tokens.expiresIn }
        : { access: accessToken.value, refresh: refreshToken.value, expiresIn: undefined };

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
            accessToken: migratedTokens.access,
            refreshToken: migratedTokens.refresh,
            expiresAt: computeExpiresAt(migratedTokens.access, migratedTokens.expiresIn),
            channels: [],
            activeChannelId: null,
            lastActivity: Date.now(),
          },
        },
      };

      // Save new structure (only possible outside a Server Component render;
      // the session is valid for this request either way)
      await this.persistIfWritable(sessionData);
      try {
        cookieStore.delete('access_token');
        cookieStore.delete('refresh_token');
      } catch {
        // Read-only cookies: the legacy cookies are migrated on a later write
        return sessionData;
      }

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
    return getOpenAuthClient();
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

    const existing = sessionData.accounts[userInfo.id];

    // Check max accounts limit (signing in again to a stored account adds none)
    if (!existing && Object.keys(sessionData.accounts).length >= MAX_ACCOUNTS) {
      throw new Error(`Maximum ${MAX_ACCOUNTS} accounts allowed`);
    }

    // Add the account, or refresh the tokens of one signed in before (keeping
    // its channels and channel choice until loadUserChannels refreshes them)
    const channels = (existing?.channels ?? []).filter(c => c.userId === userInfo.id);
    const activeChannelId = existing?.activeChannelId && channels.some(c => c.id === existing.activeChannelId)
      ? existing.activeChannelId
      : null;
    sessionData.accounts[userInfo.id] = {
      userId: userInfo.id,
      email: userInfo.email,
      displayName: existing?.displayName || userInfo.displayName || userInfo.email,
      avatarUrl: existing?.avatarUrl,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: computeExpiresAt(tokens.accessToken, tokens.expiresIn),
      channels,
      activeChannelId,
      lastActivity: Date.now(),
    };

    // The account that just signed in is the one the user is now using, and
    // the session's channel must be one of its channels
    sessionData.activeUserId = userInfo.id;
    sessionData.activeChannelId = activeChannelId;

    await this.setSessionData(sessionData);

    // One after the other: each reads the session, changes it and writes it
    // back, so in parallel the later write dropped the earlier one's changes
    await this.loadUserChannels(userInfo.id);
    await this.loadUserProfile(userInfo.id);
  }

  /**
   * Remove an account from the session
   */
  static async removeAccount(userId: string): Promise<void> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return;

    const removed = sessionData.accounts[userId];
    if (removed) await revokeTokensOnSignOut([removed]);
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

    // The account's sign-in ended (refresh token rejected): signed out, so its
    // dead token is never sent. Signing in again replaces the account.
    if (activeAccount.needsSignIn) {
      logger.info('[SessionManager.getActiveSession] Active account needs to sign in again', {
        userId: activeAccount.userId,
      });
      return null;
    }

    logger.debug('[SessionManager.getActiveSession] TRACE BEFORE FILTER:', {
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
        logger.debug('[SessionManager] Cleaning channels for user:', {
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
      await this.persistIfWritable(sessionData);
    }

    logger.debug('[SessionManager.getActiveSession] TRACE AFTER FILTER:', {
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
        ...(account.needsSignIn ? { needsSignIn: true } : {}),
      };
    });

    return {
      userId: activeAccount.userId,
      accessToken: activeAccount.accessToken,
      refreshToken: activeAccount.refreshToken,
      expiresAt: activeAccount.expiresAt,
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
        ...(account.needsSignIn ? { needsSignIn: true } : {}),
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
        account.channels = Array.isArray(response.data) ? response.data.map(toSessionChannel) : [];

        // Set first channel as active if none selected AND channels exist
        // Clear active channel if no channels exist
        if (account.channels.length > 0) {
          if (account.activeChannelId && !account.channels.some(c => c.id === account.activeChannelId)) {
            account.activeChannelId = null;
          }
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
          url: buildApiUrl('/api/profile'),
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
   * Refresh one account's tokens when they expire soon (or always, with
   * `force`) and save them. Safe to call from anywhere:
   * - in a Server Component render (read-only cookies) it does nothing, since
   *   a rotated refresh token that cannot be saved would be lost;
   * - concurrent calls share one /token request (token-refresh.ts);
   * - on `invalid_grant` it adopts a newer pair another request stored, and
   *   only otherwise marks the account `needsSignIn`.
   *
   * `staleAccessToken`: the token an API just answered 401 for. When the
   * session already holds a different, fresh token, that one is used without
   * refreshing again.
   */
  static async refreshAccount(
    userId: string,
    options: { force?: boolean; staleAccessToken?: string } = {},
  ): Promise<{ result: RefreshAccountResult; account: UserSession | null }> {
    const sessionData = await this.getSessionData();
    const account = sessionData?.accounts[userId];
    if (!sessionData || !account) return { result: 'missing', account: null };
    if (account.needsSignIn) return { result: 'needs-sign-in', account };

    const alreadyRenewed = options.staleAccessToken !== undefined && account.accessToken !== options.staleAccessToken;
    if (!shouldRefresh(account) && (!options.force || alreadyRenewed)) {
      return { result: 'fresh', account };
    }

    if (!(await this.canWriteCookies())) {
      logger.debug('[SessionManager.refreshAccount] Read-only cookies here; not refreshing', { userId });
      return { result: 'read-only', account };
    }

    const result = await refreshAccountInSession(sessionData, userId, {
      reread: () => this.readStoredSession(),
    });

    if (result === 'refreshed') {
      account.lastActivity = Date.now();
      await this.setSessionData(sessionData);
      logger.info('[SessionManager.refreshAccount] Tokens refreshed', { userId, expiresAt: account.expiresAt });
    } else if (result === 'needs-sign-in') {
      await this.setSessionData(sessionData);
      logger.warn('[SessionManager.refreshAccount] Refresh token rejected; account needs to sign in again', { userId });
    } else if (result === 'failed') {
      logger.warn('[SessionManager.refreshAccount] Token refresh failed temporarily; keeping current token', { userId });
    }

    return { result, account: sessionData.accounts[userId] ?? null };
  }

  /**
   * Refresh the active account when its token expires soon, then return the
   * active session (null when signed out or the sign-in ended). For Route
   * Handlers, which the middleware does not run for.
   */
  static async ensureFreshActiveSession(): Promise<SessionContext | null> {
    const sessionData = await this.getSessionData();
    if (sessionData?.accounts[sessionData.activeUserId]) {
      await this.refreshAccount(sessionData.activeUserId);
    }
    return this.getActiveSession();
  }

  /**
   * After an API answered 401 for `staleAccessToken`: refresh (once) and
   * return the access token to retry with, or null when there is none.
   * Without `userId`, the account holding that token (else the active one).
   */
  static async refreshAfterUnauthorized(userId: string | undefined, staleAccessToken: string): Promise<string | null> {
    let targetUserId = userId;
    if (!targetUserId) {
      const sessionData = await this.getSessionData();
      if (!sessionData) return null;
      targetUserId = Object.values(sessionData.accounts).find(a => a.accessToken === staleAccessToken)?.userId
        ?? sessionData.activeUserId;
    }
    const { result, account } = await this.refreshAccount(targetUserId, { force: true, staleAccessToken });
    if ((result === 'refreshed' || result === 'fresh') && account && !account.needsSignIn && account.accessToken !== staleAccessToken) {
      return account.accessToken;
    }
    return null;
  }

  /**
   * Refresh token for a specific user when it expires soon.
   * True when the account holds a usable token afterwards.
   */
  static async refreshTokenForUser(userId: string): Promise<boolean> {
    try {
      const { result } = await this.refreshAccount(userId);
      return result === 'refreshed' || result === 'fresh' || result === 'read-only' || result === 'failed';
    } catch (error) {
      logger.error(`[SessionManager] Token refresh failed for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * The user's access token, refreshed first when it expires soon; null when
   * the account is gone or must sign in again.
   */
  static async getValidAccessToken(userId: string): Promise<string | null> {
    try {
      const { account } = await this.refreshAccount(userId);
      if (!account || account.needsSignIn) return null;
      return account.accessToken;
    } catch (error) {
      logger.error('[SessionManager.getValidAccessToken] Failed', { userId, error });
      return null;
    }
  }

  /**
   * Refresh tokens for all accounts
   */
  static async refreshAllTokens(): Promise<void> {
    const sessionData = await this.getSessionData();
    if (!sessionData) return;

    // One after the other: each saves the whole cookie
    for (const userId of Object.keys(sessionData.accounts)) {
      await this.refreshTokenForUser(userId);
    }
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
    const sessionData = await this.getSessionData();
    if (sessionData) await revokeTokensOnSignOut(Object.values(sessionData.accounts));
    await this.setSessionData(null);
  }
}