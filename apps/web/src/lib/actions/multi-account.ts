/**
 * Server Actions for Multi-Account and Multi-Channel Management
 *
 * These server actions handle account switching, channel selection,
 * and related operations for the multi-account system.
 */

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers as getHeaders, cookies as getCookies } from "next/headers";
import { getOpenAuthClient } from "../auth/openauth-client";
import { SessionManager, type AccountInfo } from '../auth/session-manager';
import { createChannel } from '../api/channels';
import type { Channel, ChannelCreateRequest } from '@al-ummah/shared-types';
import { subjects } from '../auth';
import { shouldRedirectToProfileCreation } from '../profile-helpers';
import { logger } from '@/lib/logger-server';

/**
 * Get OpenAuth client
 */
async function getAuthClient() {
  return getOpenAuthClient();
}

/**
 * Add a new user account (login with additional account)
 */
export async function addUserAccount(locale: string = 'en'): Promise<void> {
  const headers = await getHeaders();
  const host = headers.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";

  (await getCookies()).set("auth_locale", locale, { httpOnly: true, sameSite: "lax", secure: protocol === "https", path: "/", maxAge: 600 });

  const client = await getAuthClient();
  const { url } = await client.authorize(
    `${protocol}://${host}/api/callback/multi-account`,
    "code"
  );

  redirect(url);
}

/**
 * Complete the OAuth flow for adding a new account
 */
export async function completeAddAccount(code: string): Promise<void> {
  try {
    const headers = await getHeaders();
    const host = headers.get("host");
    const protocol = host?.includes("localhost") ? "http" : "https";

    const client = await getAuthClient();
    const exchanged = await client.exchange(
      code,
      `${protocol}://${host}/api/callback/multi-account`
    );

    if (exchanged.err || !exchanged.tokens) {
      throw new Error('Failed to exchange code for tokens');
    }

    // Verify the tokens and get user info
    const verified = await client.verify(subjects, exchanged.tokens.access, {
      refresh: exchanged.tokens.refresh,
    });

    if (verified.err || !verified.subject) {
      throw new Error('Failed to verify tokens');
    }

    const userInfo = verified.subject.properties;

    // Add account to session
    // Note: OpenAuth JWT only includes id and email (see subjects.ts)
    await SessionManager.addAccount(
      {
        accessToken: exchanged.tokens.access,
        refreshToken: exchanged.tokens.refresh,
      },
      {
        id: userInfo.id,
        email: userInfo.email,
        displayName: userInfo.email, // Use email as fallback, profile API will provide actual displayName
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );

    // Load user's channels
    await SessionManager.loadUserChannels(userInfo.id);

    revalidatePath('/');
    redirect('/');
  } catch (error) {
    logger.error('[completeAddAccount] Error:', error);
    redirect('/?error=add_account_failed');
  }
}

/**
 * Switch to a different user account
 * If switching while on profile creation page, check if new account has profile
 * Returns object indicating if redirect is needed (client will handle redirect)
 */
export async function switchUserAccount(userId: string, currentPath?: string): Promise<{ needsRedirect: boolean; redirectPath?: string }> {
  try {
    await SessionManager.setActiveAccount(userId);

    // Check if we're on profile creation page
    const isOnProfileCreatePage = currentPath?.includes('/profile/create');

    if (isOnProfileCreatePage) {
      // Get the new active session to check profile
      const session = await SessionManager.getActiveSession();

      if (session) {
        const userForCheck = {
          id: session.userId,
          email: session.email,
        };

        // Check if this account needs profile creation
        const { shouldRedirect } = await shouldRedirectToProfileCreation(userForCheck);

        if (!shouldRedirect) {
          // Profile exists, tell client to redirect away from profile creation
          const locale = currentPath?.includes('/ar/') ? 'ar' : 'en';
          const targetPath = `/${locale}/profile`;

          // Revalidate before returning (client will redirect)
          revalidatePath('/');
          revalidatePath('/[locale]', 'layout');

          return { needsRedirect: true, redirectPath: targetPath };
        }
        // else: Profile doesn't exist, stay on profile creation page
      }
    }

    // Revalidate all paths to refresh the UI with new account
    revalidatePath('/');
    revalidatePath('/[locale]', 'layout');

    return { needsRedirect: false };
  } catch (error) {
    // Re-throw NEXT_REDIRECT errors (from revalidatePath/router operations) - they're expected
    // Check for both the error message and the digest property
    if (error instanceof Error && (error.message === 'NEXT_REDIRECT' || (error as Error & { digest?: string }).digest?.startsWith?.('NEXT_REDIRECT'))) {
      throw error;
    }
    logger.error('[switchUserAccount] Error:', error);
    throw new Error('Failed to switch account');
  }
}

/**
 * Remove a user account from the session
 */
export async function removeUserAccount(userId: string): Promise<void> {
  try {
    await SessionManager.removeAccount(userId);

    // Revalidate all paths to refresh the UI
    revalidatePath('/');
    revalidatePath('/[locale]', 'layout');
  } catch (error) {
    logger.error('[removeUserAccount] Error:', error);
    throw new Error('Failed to remove account');
  }
}

/**
 * Get list of all logged-in user accounts
 */
export async function listUserAccounts(): Promise<AccountInfo[]> {
  try {
    return await SessionManager.getAllSessions();
  } catch (error) {
    logger.error('[listUserAccounts] Error:', error);
    return [];
  }
}

/**
 * Switch to a different channel for the active user
 */
export async function switchChannel(channelId: string | null): Promise<void> {
  try {
    await SessionManager.setActiveChannel(channelId);

    // Revalidate all paths to refresh the UI with new channel
    revalidatePath('/');
    revalidatePath('/[locale]', 'layout');
  } catch (error) {
    logger.error('[switchChannel] Error:', error);
    throw new Error('Failed to switch channel');
  }
}

/**
 * Get channels for the active user
 */
export async function getUserChannels(): Promise<Channel[]> {
  try {
    const session = await SessionManager.getActiveSession();
    if (!session) {
      return [];
    }

    // Return cached channels from session
    return session.availableChannels;
  } catch (error) {
    logger.error('[getUserChannels] Error:', error);
    return [];
  }
}

/**
 * Reload channels for a specific user
 */
export async function reloadUserChannels(userId?: string): Promise<Channel[]> {
  try {
    const session = await SessionManager.getActiveSession();
    if (!session) {
      return [];
    }

    const targetUserId = userId || session.userId;
    return await SessionManager.loadUserChannels(targetUserId);
  } catch (error) {
    logger.error('[reloadUserChannels] Error:', error);
    return [];
  }
}

/**
 * Re-read the active account's profile (display name, avatar) into the session,
 * e.g. after the user changes their photo, so the navigation shows it.
 */
export async function reloadActiveProfile(): Promise<void> {
  try {
    const session = await SessionManager.getActiveSession();
    if (!session) return;
    await SessionManager.loadUserProfile(session.userId);
  } catch (error) {
    logger.error('[reloadActiveProfile] Error:', error);
  }
}

/**
 * Create a new channel for the active user
 */
export async function createChannelForActiveUser(
  data: ChannelCreateRequest
): Promise<Channel | null> {
  try {
    const session = await SessionManager.getActiveSession();
    if (!session) {
      throw new Error('No active session');
    }

    // Create channel via API
    const response = await createChannel(data, {
      
      channelId: session.channelId || '', // Use empty string if no channel selected
    });

    // POST /api/channels responds with { success, result: { channel } };
    // `data.channel` is kept for the ApiResponse shape the client is typed with
    const created =
      (response as { result?: { channel?: Channel } } | null)?.result?.channel ?? response?.data?.channel;

    if (created) {
      // Reload channels to include the new one
      await SessionManager.loadUserChannels(session.userId);

      // If this is the first channel, set it as active
      if (!session.channelId) {
        await SessionManager.setActiveChannel(created.id);
      }

      revalidatePath('/');
      return created;
    }

    return null;
  } catch (error) {
    logger.error('[createChannelForActiveUser] Error:', error);
    return null;
  }
}

/**
 * Logout the current active account only
 */
export async function logoutCurrentAccount(): Promise<void> {
  try {
    const session = await SessionManager.getActiveSession();
    if (!session) {
      redirect('/');
      return;
    }

    await SessionManager.removeAccount(session.userId);

    // If no accounts left, redirect to home
    const remainingAccounts = await SessionManager.getAllSessions();
    if (remainingAccounts.length === 0) {
      redirect('/');
    } else {
      revalidatePath('/');
    }
  } catch (error) {
    // Re-throw NEXT_REDIRECT errors - they're expected behavior
    if (error instanceof Error && (error.message === 'NEXT_REDIRECT' || (error as Error & { digest?: string }).digest?.startsWith?.('NEXT_REDIRECT'))) {
      throw error;
    }
    logger.error('[logoutCurrentAccount] Error:', error);
    redirect('/');
  }
}

/**
 * Logout all accounts
 */
export async function logoutAllAccounts(): Promise<void> {
  try {
    await SessionManager.clearAllSessions();
    redirect('/');
  } catch (error) {
    // Re-throw NEXT_REDIRECT errors - they're expected behavior
    if (error instanceof Error && (error.message === 'NEXT_REDIRECT' || (error as Error & { digest?: string }).digest?.startsWith?.('NEXT_REDIRECT'))) {
      throw error;
    }
    logger.error('[logoutAllAccounts] Error:', error);
    redirect('/');
  }
}

/**
 * Refresh tokens for all accounts (maintenance task)
 */
export async function refreshAllAccountTokens(): Promise<void> {
  try {
    await SessionManager.refreshAllTokens();
  } catch (error) {
    logger.error('[refreshAllAccountTokens] Error:', error);
  }
}

/**
 * Cleanup expired sessions (maintenance task)
 */
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    await SessionManager.cleanupExpiredSessions();
  } catch (error) {
    logger.error('[cleanupExpiredSessions] Error:', error);
  }
}

/**
 * Get active session info for client components
 */
export async function getActiveSessionInfo() {
  logger.info('[getActiveSessionInfo] Called - fetching active session');

  const session = await SessionManager.getActiveSession();

  if (!session) {
    logger.warn('[getActiveSessionInfo] No active session found');
    return null;
  }

  logger.info('[getActiveSessionInfo] Session found:', {
    
    email: session.email,
    hasChannel: !!session.channel,
    channelsCount: session.availableChannels.length,
    accountsCount: session.availableAccounts.length,
  });

  // Filter channels to only include those belonging to the active user
  const userChannels = session.availableChannels.filter(ch => ch.userId === session.userId);

  const channelData = session.channel ? {
    id: session.channel.id,
    userId: session.channel.userId,
    name: session.channel.name,
    nameLocalized: session.channel.nameLocalized,
    avatarUrl: session.channel.avatarUrl,
    isMain: session.channel.isMain,
  } : null;

  logger.debug('[getActiveSessionInfo] TRACE', {

    email: session.email,
    'session.channel': session.channel ? session.channel.name : null,
    'channelData': channelData ? channelData.name : null,
    userChannelsCount: userChannels.length,
  });

  const result = {
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
      channel: channelData,
      channels: userChannels.map(ch => ({
        id: ch.id,
        userId: ch.userId,
        name: ch.name,
        nameLocalized: ch.nameLocalized,
        avatarUrl: ch.avatarUrl,
        isMain: ch.isMain,
      })),
    },
    accounts: session.availableAccounts.map(acc => ({
      userId: acc.userId,
      email: acc.email,
      displayName: acc.displayName,
      avatarUrl: acc.avatarUrl,
      isActive: acc.isActive,
      channelsCount: acc.channelsCount,
    })),
  };

  logger.info('[getActiveSessionInfo] Returning session info successfully');
  return result;
}

/**
 * Get session cookie size information
 * Useful for monitoring and debugging cookie size issues
 */
export async function getSessionCookieSize() {
  try {
    return await SessionManager.getCookieSizeInfo();
  } catch (error) {
    logger.error('[getSessionCookieSize] Error:', error);
    return null;
  }
}