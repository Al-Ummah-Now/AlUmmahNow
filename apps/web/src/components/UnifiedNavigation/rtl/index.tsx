/**
 * Unified Navigation Component - RTL Variant (Arabic)
 *
 * Consolidates AccountSwitcher, ChannelSelector, and AccountNavigation
 * into a single hierarchical dropdown menu.
 *
 * Features:
 * - Account switching and management
 * - Channel selection and creation
 * - Navigation links (Profile, Analytics, Settings, Moderation)
 * - Dark mode and language toggles
 * - Sign out options
 * - RTL layout optimizations
 */

'use client';
import { logger } from '@/lib/logger-client';

import { useState, useEffect } from 'react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import Link from 'next/link';
import { login } from '@/lib/actions';
import { fetchProfile } from '@/lib/api/profiles-client';
import type { Profile } from '@/interfaces';
import {
  ChevronDown,
  Check,
  Plus,
  LogOut,
  User,
  Tv,
  Crown,
  Video,
  Calendar,
  History,
  Rss,
  Users,
  BarChart3,
  Library,
  Bell,
  Settings,
} from 'lucide-react';
import { getTranslations } from '@/lib/i18n';

const tAr = getTranslations('ar');

export function UnifiedNavigationRTL() {
  const {
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
    logout,
    logoutAll,
  } = useMultiAccount();

  const [channel, setChannel] = useState(user?.channel);
  const [channels, setChannels] = useState(user?.channels || []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accountProfiles, setAccountProfiles] = useState<Map<string, Profile>>(new Map());

  // Fetch user profile for localized display name and avatar
  useEffect(() => {
    if (user) {
      fetchProfile(user, (profileData: Profile) => {
        setProfile(profileData);
      }).catch((err: Error) => {
        logger.error('[UnifiedNavigation RTL] Failed to load profile:', err);
      });
    } else {
      setProfile(null);
    }
  }, [user]);

  // Fetch profiles for all accounts
  useEffect(() => {
    const loadAccountProfiles = async () => {
      const profilesMap = new Map<string, Profile>();

      for (const account of accounts) {
        try {
          const accountUser = { id: account.userId, email: account.email };
          await new Promise<void>((resolve) => {
            fetchProfile(accountUser, (profileData: Profile) => {
              profilesMap.set(account.userId, profileData);
              resolve();
            }).catch(() => resolve()); // Silently fail for individual profiles
          });
        } catch (_err) {
          logger.error(`[UnifiedNavigation RTL] Failed to load profile for ${account.userId}`);
        }
      }

      setAccountProfiles(profilesMap);
    };

    if (accounts.length > 0) {
      loadAccountProfiles();
    }
  }, [accounts]);

  // Update local state when user changes
  useEffect(() => {
    logger.debug('[UnifiedNavigation RTL] User changed:', {
      
      email: user?.email,
      hasChannel: !!user?.channel,
      channelName: user?.channel?.name,
      channelsCount: user?.channels?.length || 0,
    });
    setChannel(user?.channel);
    setChannels(user?.channels || []);
  }, [user?.id, user?.email, user?.channel, user?.channels]);

  // Get localized display name (Arabic)
  const getDisplayName = () => {
    if (profile?.displayNameLocalized?.['ar']) {
      return profile.displayNameLocalized['ar'];
    }
    if (profile?.displayName) {
      return profile.displayName;
    }
    return user?.displayName || user?.email || '';
  };

  // Get user avatar (always from profile, never from channel)
  const getUserAvatar = () => {
    return profile?.avatarUrl || user?.avatarUrl;
  };

  // Get account avatar from fetched profile
  const getAccountAvatar = (userId: string) => {
    const accountProfile = accountProfiles.get(userId);
    return accountProfile?.avatarUrl;
  };

  // Get localized channel name (Arabic)
  const getChannelName = (channelName: string, channelNameLocalized?: Record<string, string>) => {
    if (channelNameLocalized?.['ar']) {
      return channelNameLocalized['ar'];
    }
    return channelName;
  };

  const [isOpen, setIsOpen] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);

  // Handle Escape key to close menu
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setIsCreatingChannel(false);
        setNewChannelName('');
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  if (loading) {
    return (
      <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
    );
  }

  // Anonymous user - show menu icon with Sign In option
  if (!user) {
    return (
      <div className="relative">
        {/* Trigger Button - Menu Icon */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="قائمة التنقل"
          aria-expanded={isOpen}
          aria-haspopup="menu"
          data-testid="nav-menu-trigger"
        >
          <div className="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center">
            <User className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          </div>
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />

            {/* Menu */}
            <div
              className="absolute left-0 mt-2 w-80 rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
              role="menu"
              data-testid="nav-menu"
              aria-orientation="vertical"
              dir="rtl"
            >
              {/* Sign In */}
              <div className="p-3">
                <form action={login.bind(null, 'ar')}>
                  <button
                    type="submit"
                    className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-lg bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700 text-gray-900 font-semibold transition-all shadow-md hover:shadow-lg"
                    role="menuitem"
                  >
                    <User className="h-5 w-5" />
                    <span className="text-sm">تسجيل الدخول</span>
                  </button>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  const handleCreateChannel = async () => {
    if (!newChannelName.trim() || creatingChannel) return;

    const created = await createChannel({
      name: newChannelName.trim(),
    });

    if (created) {
      setNewChannelName('');
      setIsCreatingChannel(false);
      // Reload channels to show the newly created channel
      await reloadChannels();
    }
  };

  // Feed/history for every signed-in account; video links only with channels
  const navItems = [
    {
      label: tAr.subscriptions.subscriptionFeed,
      icon: Rss,
      href: '/ar/feed',
    },
    {
      label: tAr.feed.history,
      icon: History,
      href: '/ar/history',
    },
    {
      label: tAr.navigation.subscriptions,
      icon: Users,
      href: '/ar/subscriptions',
    },
    {
      label: tAr.navigation.analytics,
      icon: BarChart3,
      href: '/ar/analytics',
    },
    {
      label: tAr.library.title,
      icon: Library,
      href: '/ar/library',
    },
    {
      label: tAr.notificationCenter.title,
      icon: Bell,
      href: '/ar/notifications',
    },
    {
      label: tAr.header.settings,
      icon: Settings,
      href: '/ar/settings',
    },
    ...(channels.length > 0 ? [
      {
        label: tAr.video.myVideos,
        icon: Video,
        href: '/ar/dashboard/videos',
      },
      {
        label: tAr.schedule?.scheduledVideos ?? tAr.video.videos,
        icon: Calendar,
        href: '/ar/scheduled-videos',
      },
    ] : []),
  ];

  return (
    <div className="relative">
      {/* Trigger Button - Avatar with Dropdown */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="قائمة التنقل"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid="nav-menu-trigger"
      >
        {/* Avatar: Show channel avatar if channel selected, otherwise user avatar */}
        {channel?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.avatarUrl}
            alt={channel.name}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : getUserAvatar() ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getUserAvatar()!}
            alt={getDisplayName()}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold">
            {getDisplayName()[0]?.toUpperCase() || user.email[0].toUpperCase()}
          </div>
        )}

        {/* User Info (hidden on mobile) */}
        <div className="hidden md:block text-right">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
            {getDisplayName()}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">
            {channel ? getChannelName(channel.name, channel.nameLocalized) : 'بدون قناة'}
          </div>
        </div>

        <ChevronDown className="h-4 w-4 text-gray-500" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setIsOpen(false);
              setIsCreatingChannel(false);
              setNewChannelName('');
            }}
            aria-hidden="true"
          />

          {/* Menu */}
          <div
            className="absolute left-0 mt-2 w-80 max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
            role="menu"
            data-testid="nav-menu"
            aria-orientation="vertical"
            dir="rtl"
          >
            {/* Active Context Card */}
            <div data-testid="nav-active-context" className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b border-gray-200 dark:border-gray-700">
              <Link
                data-testid="nav-profile-link"
                href="/ar/profile"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 mb-3 rounded-lg p-2 -m-2 hover:bg-white/60 dark:hover:bg-gray-800/60 transition-colors cursor-pointer"
              >
                {/* User Avatar (always user, never channel) */}
                {getUserAvatar() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getUserAvatar()!}
                    alt={getDisplayName()}
                    className="h-12 w-12 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-blue-500 flex items-center justify-center text-white text-lg font-semibold flex-shrink-0">
                    {getDisplayName()[0]?.toUpperCase() || user.email[0].toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {getDisplayName()}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {user.email}
                  </div>
                </div>
              </Link>

              {/* Active Channel Display */}
              {channel ? (
                <Link
                  data-testid="nav-active-channel"
                  href={`/ar/channels/${channel.id}`}
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-md hover:bg-white/80 dark:hover:bg-gray-800/80 transition-colors cursor-pointer"
                >
                  <div className="relative flex-shrink-0">
                    {channel.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={channel.avatarUrl}
                        alt={getChannelName(channel.name, channel.nameLocalized)}
                        className="h-6 w-6 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-semibold">
                        {getChannelName(channel.name, channel.nameLocalized)[0].toUpperCase()}
                      </div>
                    )}
                    {channel.isMain && (
                      <Crown className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-yellow-500 bg-white dark:bg-gray-900 rounded-full" />
                    )}
                  </div>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1">
                    {getChannelName(channel.name, channel.nameLocalized)}
                  </span>
                </Link>
              ) : (
                <div data-testid="nav-no-active-channel" className="flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-md">
                  <Tv className="h-4 w-4 text-gray-500" />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    لا توجد قناة نشطة
                  </span>
                </div>
              )}
            </div>

            {/* Navigation Links */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                التنقل
              </div>
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                    role="menuitem"
                  >
                    <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Account Management with Nested Channels */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                الحسابات {accounts.length > 1 && `(${accounts.length})`}
              </div>

              {accounts.map((account) => {
                // For active account, use channels from local state (filtered in useEffect)
                // For inactive accounts, we can't show individual channels (only count)
                const accountChannels = account.isActive ? channels.filter(ch => ch.userId === account.userId) : [];
                const isActive = account.isActive;
                // Use channelsCount from AccountInfo which is accurate for all accounts
                const channelCount = account.channelsCount || 0;

                return (
                  <div key={account.userId} className="mb-2" data-testid="nav-account" data-active={isActive ? 'true' : 'false'}>
                    {/* Account Header */}
                    <div className="group relative rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <button
                        onClick={() => {
                          if (!isActive) {
                            switchAccount(account.userId);
                            setIsOpen(false);
                          }
                        }}
                        className="flex items-center gap-3 w-full px-3 py-2 text-right"
                        role="menuitem"
                        disabled={isActive}
                      >
                        {isActive && (
                          <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {account.displayName}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {channelCount} {channelCount === 1 ? 'قناة' : 'قنوات'}
                          </div>
                        </div>
                        {/* Show account avatar from fetched profile, with fallback */}
                        {getAccountAvatar(account.userId) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={getAccountAvatar(account.userId)!}
                            alt={account.displayName}
                            className="h-8 w-8 rounded-full object-cover flex-shrink-0"
                          />
                        ) : account.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={account.avatarUrl}
                            alt={account.displayName}
                            className="h-8 w-8 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                            {account.displayName?.[0]?.toUpperCase() || account.email[0].toUpperCase()}
                          </div>
                        )}
                      </button>

                      {/* Remove Account (hover only, not for active) */}
                      {!isActive && accounts.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAccount(account.userId);
                          }}
                          className="absolute left-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="إزالة الحساب"
                        >
                          <LogOut className="h-4 w-4 text-red-600 dark:text-red-400" />
                        </button>
                      )}
                    </div>

                    {/* Nested Channels for Active Account Only */}
                    {isActive && (
                      <div className="mr-6 mt-1 border-r-2 border-gray-200 dark:border-gray-700 pr-2">
                        {/* No Channel Option */}
                        <button
                          onClick={() => {
                            switchToChannel(null);
                          }}
                          data-testid="nav-channel-option-none"
                          aria-checked={!channel}
                          className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                          role="menuitemradio"
                        >
                          {!channel && (
                            <Check className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
                              بدون قناة
                            </div>
                          </div>
                          <div className="h-6 w-6 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                            <Tv className="h-3 w-3 text-gray-500 dark:text-gray-400" />
                          </div>
                        </button>

                        {/* Account's Channels */}
                        {accountChannels.map((ch) => (
                          <button
                            key={ch.id}
                            onClick={() => {
                              switchToChannel(ch.id);
                            }}
                            data-testid="nav-channel-option"
                            data-channel-id={ch.id}
                            aria-checked={channel?.id === ch.id}
                            className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                            role="menuitemradio"
                          >
                            {channel?.id === ch.id && (
                              <Check className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                                {getChannelName(ch.name, ch.nameLocalized)}
                              </div>
                            </div>
                            <div className="relative flex-shrink-0">
                              {ch.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={ch.avatarUrl}
                                  alt={ch.name}
                                  className="h-6 w-6 rounded-full object-cover"
                                />
                              ) : (
                                <div className="h-6 w-6 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-semibold">
                                  {getChannelName(ch.name, ch.nameLocalized)[0].toUpperCase()}
                                </div>
                              )}
                              {ch.isMain && (
                                <Crown className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-yellow-500 bg-white dark:bg-gray-900 rounded-full" />
                              )}
                            </div>
                          </button>
                        ))}

                        {/* Create Channel - Only for Active Account */}
                        {!isCreatingChannel ? (
                          <button
                            onClick={() => setIsCreatingChannel(true)}
                            data-testid="nav-create-channel"
                            className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right mt-1"
                            role="menuitem"
                          >
                            <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                              إنشاء قناة
                            </span>
                            <div className="h-6 w-6 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                              <Plus className="h-3 w-3 text-gray-500 dark:text-gray-400" />
                            </div>
                          </button>
                        ) : (
                          <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded-lg mt-1">
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              اسم القناة
                            </label>
                            <input
                              type="text"
                              value={newChannelName}
                              disabled={creatingChannel}
                              onChange={(e) => setNewChannelName(e.target.value)}
                              placeholder="أدخل اسم القناة"
                              className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 text-right"
                              autoFocus
                              dir="rtl"
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  handleCreateChannel();
                                }
                              }}
                            />
                            <div className="flex gap-1.5 mt-2">
                              <button
                                onClick={handleCreateChannel}
                                disabled={!newChannelName.trim() || creatingChannel}
                                aria-busy={creatingChannel}
                                className="flex-1 px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md transition-colors"
                              >
                                {creatingChannel ? tAr.channel.creating : tAr.common.create}
                              </button>
                              <button
                                onClick={() => {
                                  setIsCreatingChannel(false);
                                  setNewChannelName('');
                                }}
                                className="flex-1 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md transition-colors"
                              >
                                إلغاء
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add Account & Sign Out */}
            <div className="p-2">
              {/* Add Account */}
              <button
                onClick={() => {
                  addAccount();
                  setIsOpen(false);
                }}
                data-testid="nav-add-account"
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                role="menuitem"
              >
                <div className="h-8 w-8 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                  <Plus className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  إضافة حساب آخر
                </span>
              </button>

              {/* Sign Out Current */}
              <button
                onClick={() => {
                  logout();
                  setIsOpen(false);
                }}
                data-testid="nav-sign-out"
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                role="menuitem"
              >
                <div className="h-8 w-8 flex items-center justify-center flex-shrink-0">
                  <LogOut className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  تسجيل الخروج من {getDisplayName()}
                </span>
              </button>

              {/* Sign Out All (if multiple accounts) */}
              {accounts.length > 1 && (
                <button
                  onClick={() => {
                    setShowLogoutAllConfirm(true);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                  role="menuitem"
                >
                  <div className="h-8 w-8 flex items-center justify-center flex-shrink-0">
                    <LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    تسجيل الخروج من جميع الحسابات
                  </span>
                </button>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700" />
                <div className="p-3 bg-red-50 dark:bg-red-900/20">
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Logout All Confirmation Dialog */}
      {showLogoutAllConfirm && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => setShowLogoutAllConfirm(false)}
            aria-hidden="true"
          />

          {/* Dialog */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md p-6 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50" dir="rtl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              تسجيل الخروج من جميع الحسابات؟
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              سيتم تسجيل خروجك من جميع الحسابات البالغ عددها {accounts.length}.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowLogoutAllConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  setShowLogoutAllConfirm(false);
                  setIsOpen(false);
                  logoutAll(true); // Pass true to skip confirmation check
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                تسجيل الخروج من الكل
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
