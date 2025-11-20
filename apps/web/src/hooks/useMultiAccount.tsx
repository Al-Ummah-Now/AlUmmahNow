/**
 * React Hook for Multi-Account and Multi-Channel Management
 *
 * This hook provides client-side access to multi-account functionality
 * and manages the state for account/channel switching.
 */

'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  addUserAccount,
  switchUserAccount,
  removeUserAccount,
  switchChannel,
  reloadUserChannels,
  createChannelForActiveUser,
  logoutCurrentAccount,
  logoutAllAccounts,
  getActiveSessionInfo,
} from '@/lib/actions/multi-account';
import type { Channel, ChannelCreateRequest } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';

// Types
interface ChannelInfo {
  id: string;
  userId: string;  // Owner of the channel - needed for filtering by account
  name: string;
  nameLocalized?: Record<string, string>; // Multi-language channel names
  avatarUrl?: string;
  isMain: boolean;
}

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  channel: ChannelInfo | null;
  channels: ChannelInfo[];
}

interface AccountInfo {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  isActive: boolean;
  channelsCount: number;
}

interface MultiAccountContextValue {
  // State
  user: UserInfo | null;
  accounts: AccountInfo[];
  loading: boolean;
  error: string | null;

  // Actions
  addAccount: () => Promise<void>;
  switchAccount: (userId: string) => Promise<void>;
  removeAccount: (userId: string) => Promise<void>;
  switchToChannel: (channelId: string | null) => Promise<void>;
  createChannel: (data: ChannelCreateRequest) => Promise<Channel | null>;
  reloadChannels: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: (skipConfirmation?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

// Context
const MultiAccountContext = createContext<MultiAccountContextValue | null>(null);

/**
 * Provider component for multi-account context
 */
export function MultiAccountProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load initial session data
  const loadSessionData = useCallback(async () => {
    // Prevent concurrent loads
    if (loadingRef.current) {
      logger.info('[MultiAccountProvider] Already loading, skipping duplicate call');
      return;
    }

    try {
      loadingRef.current = true;
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      logger.info('[MultiAccountProvider] Fetching session info...');
      const sessionInfo = await getActiveSessionInfo();
      logger.info('[MultiAccountProvider] Session info received:', sessionInfo ? 'Has data' : 'No data');

      if (!mountedRef.current) {
        logger.info('[MultiAccountProvider] Component unmounted, aborting');
        return;
      }

      if (sessionInfo) {
        setUser(sessionInfo.user);
        setAccounts(sessionInfo.accounts);
        logger.info('[MultiAccountProvider] Session loaded successfully:', {
          userId: sessionInfo.user?.id,
          email: sessionInfo.user?.email,
          accountsCount: sessionInfo.accounts.length
        });
      } else {
        setUser(null);
        setAccounts([]);
        logger.info('[MultiAccountProvider] No session found');
      }

      // Dispatch event to notify other components (like CookieSizeMonitor)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('session-updated'));
      }
    } catch (err) {
      if (!mountedRef.current) return;
      logger.error('[MultiAccountProvider] Failed to load session:', err);
      setUser(null);
      setAccounts([]);
      setError(err instanceof Error ? err.message : 'Failed to load session data');
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
      }
      logger.info('[MultiAccountProvider] Loading complete, loading state set to false');
    }
  }, []); // router is stable from useRouter() and doesn't need to be a dependency

  // Load data on mount
  useEffect(() => {
    loadSessionData();
  }, [loadSessionData]);

  // Listen for navigation events to detect OAuth callback returns
  useEffect(() => {
    const handleRouteChange = () => {
      logger.info('[MultiAccountProvider] Route changed, reloading session data');
      loadSessionData();
    };

    // Listen for popstate (browser back/forward)
    window.addEventListener('popstate', handleRouteChange);

    // Listen for custom navigation events (for client-side navigation)
    window.addEventListener('session-login', handleRouteChange);

    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('session-login', handleRouteChange);
    };
  }, [loadSessionData]);

  // Detect OAuth callback redirect with session_updated query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasSessionUpdate = params.get('session_updated') === 'true';

    if (!hasSessionUpdate) {
      return;
    }

    logger.info('[MultiAccountProvider] Session updated parameter detected');

    // Clean up URL immediately
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('session_updated');
    window.history.replaceState({}, '', newUrl.toString());

    // The session will load via the normal loadSessionData on mount
    // Just trigger a router refresh after a short delay to ensure everything is ready
    const timeoutId = setTimeout(() => {
      logger.info('[MultiAccountProvider] Calling router.refresh() after OAuth callback');
      router.refresh();
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [router]);

  // Add a new account
  const addAccount = useCallback(async () => {
    try {
      setError(null);
      await addUserAccount();
      // This will redirect to OAuth flow
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to add account:', err);
      setError('Failed to add account');
    }
  }, []);

  // Switch to a different account
  const switchAccount = useCallback(async (userId: string) => {
    try {
      setError(null);
      setLoading(true);

      // Get current pathname to pass to server action for profile check
      const currentPath = window.location.pathname;
      const result = await switchUserAccount(userId, currentPath);

      logger.info('[MultiAccountProvider] Account switched successfully');
      logger.info('[MultiAccountProvider] Current path:', currentPath);
      logger.info('[MultiAccountProvider] Redirect needed?', result.needsRedirect);
      logger.info('[MultiAccountProvider] Redirect path:', result.redirectPath);

      // Reload session data to get new user/channels
      await loadSessionData();

      if (result.needsRedirect && result.redirectPath) {
        // Navigate to redirect path (e.g., from /profile/create to home if new user has profile)
        logger.info('[MultiAccountProvider] Navigating to:', result.redirectPath);
        router.push(result.redirectPath);
      } else {
        // Stay on current page but refresh to re-run ProfileGuard and server components
        logger.info('[MultiAccountProvider] Refreshing current page');
        router.refresh();
      }
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to switch account:', err);
      setError('Failed to switch account');
    } finally {
      setLoading(false);
    }
  }, [loadSessionData, router]);

  // Remove an account
  const removeAccount = useCallback(async (userId: string) => {
    try {
      setError(null);

      // Confirm before removing
      const account = accounts.find(a => a.userId === userId);
      if (!account) return;

      const confirmed = window.confirm(
        `Remove account ${account.email}? This will log you out of this account.`
      );

      if (!confirmed) return;

      await removeUserAccount(userId);
      await loadSessionData();

      // Refresh the page to update server components
      router.refresh();
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to remove account:', err);
      setError('Failed to remove account');
    }
  }, [accounts, loadSessionData, router]);

  // Switch to a different channel
  const switchToChannel = useCallback(async (channelId: string | null) => {
    try {
      setError(null);
      setLoading(true);

      await switchChannel(channelId);
      await loadSessionData();

      // Refresh the page to update server components
      router.refresh();
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to switch channel:', err);
      setError('Failed to switch channel');
    } finally {
      setLoading(false);
    }
  }, [loadSessionData, router]);

  // Create a new channel
  const createChannel = useCallback(async (data: ChannelCreateRequest): Promise<Channel | null> => {
    try {
      setError(null);

      const newChannel = await createChannelForActiveUser(data);

      if (newChannel) {
        await loadSessionData();
        router.refresh();
        return newChannel;
      }

      return null;
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to create channel:', err);
      setError('Failed to create channel');
      return null;
    }
  }, [loadSessionData, router]);

  // Reload channels (without triggering full loading state)
  const reloadChannels = useCallback(async () => {
    try {
      setError(null);

      await reloadUserChannels();

      // Update session data WITHOUT setting loading state
      // This prevents UI flicker when reloading channels
      const sessionInfo = await getActiveSessionInfo();
      if (sessionInfo) {
        setUser(sessionInfo.user);
        setAccounts(sessionInfo.accounts);
      }
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to reload channels:', err);
      setError('Failed to reload channels');
    }
  }, []);

  // Logout current account
  const logout = useCallback(async () => {
    try {
      setError(null);

      // Check if this is the last account BEFORE logging out
      const isLastAccount = accounts.length <= 1;
      logger.info('[MultiAccountProvider] Logging out, is last account:', isLastAccount);

      try {
        await logoutCurrentAccount();
      } catch (serverError) {
        // Next.js redirect errors are expected - they indicate successful server-side redirect
        const isRedirectError = serverError instanceof Error &&
          (serverError.message === 'NEXT_REDIRECT' ||
           (serverError as Error & { digest?: string }).digest?.startsWith?.('NEXT_REDIRECT'));

        if (!isRedirectError) {
          throw serverError;
        }
        logger.info('[MultiAccountProvider] Server redirect detected (expected behavior)');
      }

      // Clear local state immediately
      setUser(null);
      setAccounts([]);

      // If this was the last account, force navigation to home
      if (isLastAccount) {
        logger.info('[MultiAccountProvider] Last account logged out, navigating to home');
        const locale = window.location.pathname.includes('/ar') ? 'ar' : 'en';
        router.push(`/${locale}`);
      } else {
        // Reload session data to get updated accounts list
        await loadSessionData();
        router.refresh();
      }
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to logout:', err);
      setError('Failed to logout');
    }
  }, [accounts, loadSessionData, router]);

  // Logout all accounts
  const logoutAll = useCallback(async (skipConfirmation = false) => {
    try {
      setError(null);

      // Confirmation should be handled by the UI component calling this function
      // skipConfirmation is true when UI has already shown confirmation dialog
      if (!skipConfirmation) {
        logger.warn('[MultiAccountProvider] logoutAll called without confirmation - UI should handle confirmation');
        return;
      }

      try {
        await logoutAllAccounts();
      } catch (serverError) {
        // Next.js redirect errors are expected - they indicate successful server-side redirect
        const isRedirectError = serverError instanceof Error &&
          (serverError.message === 'NEXT_REDIRECT' ||
           (serverError as Error & { digest?: string }).digest?.startsWith?.('NEXT_REDIRECT'));

        if (!isRedirectError) {
          throw serverError;
        }
        logger.info('[MultiAccountProvider] Server redirect detected (expected behavior)');
      }

      // Clear local state immediately
      setUser(null);
      setAccounts([]);

      // Force navigation to home
      logger.info('[MultiAccountProvider] All accounts logged out, navigating to home');
      const locale = window.location.pathname.includes('/ar') ? 'ar' : 'en';
      router.push(`/${locale}`);
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to logout all:', err);
      setError('Failed to logout');
    }
  }, [router]);

  // Refresh session data
  const refresh = useCallback(async () => {
    await loadSessionData();
  }, [loadSessionData]);

  const value: MultiAccountContextValue = {
    user,
    accounts,
    loading,
    error,
    addAccount,
    switchAccount,
    removeAccount,
    switchToChannel,
    createChannel,
    reloadChannels,
    logout,
    logoutAll,
    refresh,
  };

  return (
    <MultiAccountContext.Provider value={value}>
      {children}
    </MultiAccountContext.Provider>
  );
}

/**
 * Hook to use multi-account context
 */
export function useMultiAccount() {
  const context = useContext(MultiAccountContext);

  if (!context) {
    throw new Error('useMultiAccount must be used within MultiAccountProvider');
  }

  return context;
}

/**
 * Hook to get current user
 */
export function useCurrentUser() {
  const { user } = useMultiAccount();
  return user;
}

/**
 * Hook to get current channel (selected channel for active user)
 */
export function useCurrentChannel() {
  const { user } = useMultiAccount();
  return user?.channel || null;
}

/**
 * Hook to get all accounts
 */
export function useAccounts() {
  const { accounts } = useMultiAccount();
  return accounts;
}

/**
 * Hook to get all channels (channels for active user only)
 */
export function useChannels() {
  const { user } = useMultiAccount();
  return user?.channels || [];
}