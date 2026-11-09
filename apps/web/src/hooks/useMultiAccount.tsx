/**
 * React Hook for Multi-Account and Multi-Channel Management
 *
 * This hook provides client-side access to multi-account functionality
 * and manages the state for account/channel switching.
 */

'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  addUserAccount,
  switchUserAccount,
  removeUserAccount,
  switchChannel,
  reloadUserChannels,
  reloadActiveProfile,
  createChannelForActiveUser,
  logoutCurrentAccount,
  logoutAllAccounts,
  getActiveSessionInfo,
} from '@/lib/actions/multi-account';
import type { Channel, ChannelCreateRequest } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';
import { useLanguage } from '@/hooks/useLanguage';
import { getAuthUrl } from '@/lib/runtime-config';
import {
  decideAfterSignOut,
  decideFollow,
  fetchAuthAccounts,
  mergeAccounts,
  removeAuthAccount,
  switchAuthAccount,
  switchPlan,
  type AuthAccount,
} from '@/lib/auth/auth-accounts';
import { PROBE_FLAG, loginRoutePath, probeOutcome, shouldProbe } from '@/lib/auth/silent-sign-in';

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
  /** False for an account signed in to the browser (auth server) but not to this site yet. */
  hasLocalSession?: boolean;
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
  /** True while a channel creation request is in flight */
  creatingChannel: boolean;
  reloadChannels: () => Promise<void>;
  /** Re-read the active profile (name, avatar) into the session */
  reloadProfile: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: (skipConfirmation?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

// Context
const MultiAccountContext = createContext<MultiAccountContextValue | null>(null);

/** The page's locale: the first path segment (/ar/...), en otherwise. */
function currentLocale(): 'en' | 'ar' {
  return window.location.pathname.split('/')[1] === 'ar' ? 'ar' : 'en';
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** sessionStorage that never throws (private mode, blocked storage). */
const tabStorage = {
  has(key: string): boolean {
    try {
      return window.sessionStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  },
  set(key: string): void {
    try {
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // ignore
    }
  },
};

const followKey = (userId: string) => `aun_auth_follow_${userId}`;

/**
 * Sign in silently (prompt=none) as the auth server's active account and come
 * back to this page. The callback returns here anonymous if the auth server
 * has no session, without an error page.
 */
function silentSignIn(): void {
  window.location.assign(loginRoutePath(currentPath(), currentLocale(), 'none'));
}

/**
 * Provider component for multi-account context
 */
export function MultiAccountProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [user, setUser] = useState<UserInfo | null>(null);
  // This site's own sessions (tokens held here) and the browser's accounts on
  // the auth server; the switcher shows both, merged
  const [localAccounts, setAccounts] = useState<Omit<AccountInfo, 'hasLocalSession'>[]>([]);
  const [authAccounts, setAuthAccounts] = useState<AuthAccount[] | null>(null);
  const accounts: AccountInfo[] = useMemo(() => mergeAccounts(localAccounts, authAccounts), [localAccounts, authAccounts]);
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
      const authOrigin = getAuthUrl();
      const sessionInfo = await getActiveSessionInfo();
      logger.info('[MultiAccountProvider] Session info received:', sessionInfo ? 'Has data' : 'No data');

      if (!mountedRef.current) {
        logger.info('[MultiAccountProvider] Component unmounted, aborting');
        return;
      }

      if (!sessionInfo) {
        // Client probe: signed in on another app (CMS, profile, ...)? Then sign
        // in here too, silently. Once per tab, never on a loop.
        if (shouldProbe({ hasAppSession: false, flagSet: tabStorage.has(PROBE_FLAG), pathname: window.location.pathname, authOrigin })) {
          tabStorage.set(PROBE_FLAG);
          // Anonymous visitors ask the auth server once per tab, no more
          if (probeOutcome(await fetchAuthAccounts(authOrigin)) === 'sign-in') {
            logger.info('[MultiAccountProvider] Signed in on the auth server, signing in here silently');
            silentSignIn();
            return;
          }
        }
        setAuthAccounts(null);
      } else {
        const browserAccounts = await fetchAuthAccounts(authOrigin);
        if (!mountedRef.current) return;
        setAuthAccounts(browserAccounts);

        // Follow an account switch made in another app
        const follow = decideFollow({
          authAccounts: browserAccounts,
          localActiveUserId: sessionInfo.user?.id ?? null,
          localUserIds: sessionInfo.accounts.map((a) => a.userId),
          alreadyFollowed: (id) => tabStorage.has(followKey(id)),
        });
        if (follow.kind !== 'none') {
          tabStorage.set(followKey(follow.userId));
          logger.info('[MultiAccountProvider] Following the active account of the auth server', { how: follow.kind });
          if (follow.kind === 'silent-sign-in') {
            silentSignIn();
            return;
          }
          await switchUserAccount(follow.userId, window.location.pathname);
          const switched = await getActiveSessionInfo();
          if (switched && mountedRef.current) {
            setUser(switched.user);
            setAccounts(switched.accounts);
            router.refresh();
            return;
          }
        }
      }

      if (sessionInfo) {
        setUser(sessionInfo.user);
        setAccounts(sessionInfo.accounts);
        logger.info('[MultiAccountProvider] Session loaded successfully:', {
          
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
    // router is stable from useRouter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await addUserAccount(lang);
      // This will redirect to OAuth flow
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to add account:', err);
      setError(t.errors.failedToCreate);
    }
  }, [t, lang]);

  // Switch to a different account
  const switchAccount = useCallback(async (userId: string) => {
    try {
      setError(null);
      setLoading(true);

      // The auth server's active account follows, so every other app opens
      // as this account too
      await switchAuthAccount(getAuthUrl(), userId);
      tabStorage.set(followKey(userId));

      if (switchPlan(accounts, userId) === 'silent-sign-in') {
        // Signed in to the browser but not to this site yet: get its tokens
        silentSignIn();
        return;
      }

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
      setError(t.errors.failedToSwitch);
    } finally {
      setLoading(false);
    }
  }, [accounts, loadSessionData, router, t]);

  // Remove an account
  const removeAccount = useCallback(async (userId: string) => {
    try {
      setError(null);

      // Confirm before removing
      const account = accounts.find(a => a.userId === userId);
      if (!account) return;

      const confirmed = window.confirm(
        t.navigation.removeAccountConfirm.replace('{email}', account.email)
      );

      if (!confirmed) return;

      // Signs that account out of the browser (every app), not only here
      await removeAuthAccount(getAuthUrl(), userId);
      if (account.hasLocalSession) await removeUserAccount(userId);
      await loadSessionData();

      // Refresh the page to update server components
      router.refresh();
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to remove account:', err);
      setError(t.errors.failedToDelete);
    }
  }, [accounts, loadSessionData, router, t]);

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
      setError(t.errors.failedToSwitch);
    } finally {
      setLoading(false);
    }
  }, [loadSessionData, router, t]);

  // Create a new channel. Repeated calls while a request is in flight (double
  // clicks, Enter + click) share that request instead of creating duplicates.
  const createChannelInFlight = useRef<Promise<Channel | null> | null>(null);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const createChannel = useCallback((data: ChannelCreateRequest): Promise<Channel | null> => {
    if (createChannelInFlight.current) return createChannelInFlight.current;
    const run = (async () => {
      setCreatingChannel(true);
      try {
        setError(null);

        const newChannel = await createChannelForActiveUser(data);

        if (newChannel) {
          await loadSessionData();
          router.refresh();
          return newChannel;
        }

        setError(t.errors.failedToCreate);
        return null;
      } catch (err) {
        logger.error('[MultiAccountProvider] Failed to create channel:', err);
        setError(t.errors.failedToCreate);
        return null;
      } finally {
        createChannelInFlight.current = null;
        setCreatingChannel(false);
      }
    })();
    createChannelInFlight.current = run;
    return run;
  }, [loadSessionData, router, t]);

  // Reload channels (without triggering full loading state). Calls run one
  // after another and each resolves once every earlier reload has finished:
  // two overlapping reloads (e.g. the background refresh below and a save)
  // left Server Actions in flight after the caller's await, and a navigation
  // started then could be undone by the App Router.
  const reloadChain = useRef<Promise<void>>(Promise.resolve());
  const reloadChannels = useCallback(() => {
    const run = reloadChain.current.then(async () => {
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
        setError(t.errors.failedToLoad);
      }
    });
    reloadChain.current = run;
    return run;
  }, [t]);

  // Session channels are cached at sign-in, so avatars or names changed since
  // then (or on another device) would never reach the navigation. Refresh them
  // once per tab, after the page's own requests (Server Actions run one at a
  // time, so this must not queue ahead of them).
  const signedInUserId = user?.id;
  useEffect(() => {
    if (!signedInUserId) return;
    const key = `aun_channels_refreshed_${signedInUserId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage unavailable (private mode): refresh on every load instead
    }
    const timer = window.setTimeout(() => {
      void reloadChannels();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [signedInUserId, reloadChannels]);

  // Logout current account. The last account out also ends the shared
  // sign-in on the auth server (single sign-out, #291): the browser leaves for
  // the auth server's /logout chain and comes back to the home page signed out.
  const logout = useCallback(async () => {
    try {
      setError(null);
      const authOrigin = getAuthUrl();
      const signingOut = user?.id;
      const localUserIds = localAccounts.map((a) => a.userId).filter((id) => id !== signingOut);
      // Sign this account out of the browser (every app), then here
      if (signingOut) await removeAuthAccount(authOrigin, signingOut);
      const { signOutUrl } = await logoutCurrentAccount(currentLocale());
      setUser(null);
      setAccounts([]);

      const next = decideAfterSignOut({ authAccounts: await fetchAuthAccounts(authOrigin), localUserIds, signOutUrl });
      if (next.kind === 'single-sign-out') {
        logger.info('[MultiAccountProvider] Last account logged out, starting single sign-out');
        window.location.assign(next.url);
        return;
      }
      if (next.kind === 'silent-sign-in') {
        // Another account is still signed in to the browser: use it here
        silentSignIn();
        return;
      }
      if (next.kind === 'switch-local') {
        await switchUserAccount(next.userId, window.location.pathname);
      }
      await loadSessionData();
      router.refresh();
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to logout:', err);
      setError(t.errors.genericError);
    }
  }, [user?.id, localAccounts, loadSessionData, router, t]);

  // Logout all accounts (and the shared sign-in)
  const logoutAll = useCallback(async (skipConfirmation = false) => {
    try {
      setError(null);

      // Confirmation should be handled by the UI component calling this function
      // skipConfirmation is true when UI has already shown confirmation dialog
      if (!skipConfirmation) {
        logger.warn('[MultiAccountProvider] logoutAll called without confirmation - UI should handle confirmation');
        return;
      }

      const { signOutUrl } = await logoutAllAccounts(currentLocale());
      setUser(null);
      setAccounts([]);
      logger.info('[MultiAccountProvider] All accounts logged out, starting single sign-out');
      if (signOutUrl) window.location.assign(signOutUrl);
    } catch (err) {
      logger.error('[MultiAccountProvider] Failed to logout all:', err);
      setError(t.errors.genericError);
    }
  }, [t]);

  // Refresh session data
  const refresh = useCallback(async () => {
    await loadSessionData();
  }, [loadSessionData]);

  const reloadProfile = useCallback(async () => {
    await reloadActiveProfile();
    const sessionInfo = await getActiveSessionInfo();
    if (sessionInfo) {
      setUser(sessionInfo.user);
      setAccounts(sessionInfo.accounts);
    }
  }, []);

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
    creatingChannel,
    reloadChannels,
    reloadProfile,
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