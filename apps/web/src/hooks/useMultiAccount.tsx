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
interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

interface ChannelInfo {
  id: string;
  userId: string;  // Owner of the channel - needed for filtering by account
  name: string;
  avatarUrl?: string;
  isMain: boolean;
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
  channel: ChannelInfo | null;
  accounts: AccountInfo[];
  channels: ChannelInfo[];
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
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
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
        setChannel(sessionInfo.channel);
        setAccounts(sessionInfo.accounts);
        setChannels(sessionInfo.channels);
      } else {
        setUser(null);
        setChannel(null);
        setAccounts([]);
        setChannels([]);
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
      await switchUserAccount(userId, currentPath);
      await loadSessionData();

      // Refresh the page to update server components
      router.refresh();
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
        setChannel(sessionInfo.channel);
        setAccounts(sessionInfo.accounts);
        setChannels(sessionInfo.channels);
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
    channel,
    accounts,
    channels,
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
 * Hook to get current channel
 */
export function useCurrentChannel() {
  const { channel } = useMultiAccount();
  return channel;
}

/**
 * Hook to get all accounts
 */
export function useAccounts() {
  const { accounts } = useMultiAccount();
  return accounts;
}

/**
 * Hook to get all channels
 */
export function useChannels() {
  const { channels } = useMultiAccount();
  return channels;
}