/**
 * React Hook for Multi-Account and Multi-Channel Management
 *
 * This hook provides client-side access to multi-account functionality
 * and manages the state for account/channel switching.
 */

'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
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

// Types
interface ChannelInfo {
  id: string;
  userId: string;  // Owner of the channel - needed for filtering by account
  name: string;
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
  logoutAll: () => Promise<void>;
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

  // Load initial session data
  const loadSessionData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const sessionInfo = await getActiveSessionInfo();

      if (sessionInfo) {
        setUser(sessionInfo.user);
        setAccounts(sessionInfo.accounts);
      } else {
        setUser(null);
        setAccounts([]);
      }

      // Dispatch event to notify other components (like CookieSizeMonitor)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('session-updated'));
      }
    } catch (err) {
      console.error('[MultiAccountProvider] Failed to load session:', err);
      setError('Failed to load session data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data on mount
  useEffect(() => {
    loadSessionData();
  }, [loadSessionData]);

  // Add a new account
  const addAccount = useCallback(async () => {
    try {
      setError(null);
      await addUserAccount();
      // This will redirect to OAuth flow
    } catch (err) {
      console.error('[MultiAccountProvider] Failed to add account:', err);
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

      console.log('[MultiAccountProvider] Account switched successfully');
      console.log('[MultiAccountProvider] Current path:', currentPath);
      console.log('[MultiAccountProvider] Redirect needed?', result.needsRedirect);
      console.log('[MultiAccountProvider] Redirect path:', result.redirectPath);

      // Reload session data to get new user/channels
      await loadSessionData();

      if (result.needsRedirect && result.redirectPath) {
        // Navigate to redirect path (e.g., from /profile/create to home if new user has profile)
        console.log('[MultiAccountProvider] Navigating to:', result.redirectPath);
        router.push(result.redirectPath);
      } else {
        // Stay on current page but refresh to re-run ProfileGuard and server components
        console.log('[MultiAccountProvider] Refreshing current page');
        router.refresh();
      }
    } catch (err) {
      console.error('[MultiAccountProvider] Failed to switch account:', err);
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
      console.error('[MultiAccountProvider] Failed to remove account:', err);
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
      console.error('[MultiAccountProvider] Failed to switch channel:', err);
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
      console.error('[MultiAccountProvider] Failed to create channel:', err);
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
      console.error('[MultiAccountProvider] Failed to reload channels:', err);
      setError('Failed to reload channels');
    }
  }, []);

  // Logout current account
  const logout = useCallback(async () => {
    try {
      setError(null);

      await logoutCurrentAccount();
      await loadSessionData();

      // Refresh or redirect based on remaining accounts
      if (accounts.length <= 1) {
        router.push('/login');
      } else {
        router.refresh();
      }
    } catch (err) {
      console.error('[MultiAccountProvider] Failed to logout:', err);
      setError('Failed to logout');
    }
  }, [accounts.length, loadSessionData, router]);

  // Logout all accounts
  const logoutAll = useCallback(async () => {
    try {
      setError(null);

      const confirmed = window.confirm('Logout from all accounts?');
      if (!confirmed) return;

      await logoutAllAccounts();
      router.push('/login');
    } catch (err) {
      console.error('[MultiAccountProvider] Failed to logout all:', err);
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