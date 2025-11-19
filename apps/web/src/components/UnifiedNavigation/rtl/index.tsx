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

import { useState, useEffect } from 'react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useTheme } from 'next-themes';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
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
  BarChart3,
  Settings,
  Sun,
  Moon,
  Languages,
  Tv,
  Crown,
} from 'lucide-react';

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
        console.error('[UnifiedNavigation RTL] Failed to load profile:', err);
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
        } catch (err) {
          console.error(`[UnifiedNavigation RTL] Failed to load profile for ${account.userId}`);
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
    console.log('[UnifiedNavigation RTL] User changed:', {
      userId: user?.id,
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

  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  if (loading) {
    return (
      <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
    );
  }

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const switchLanguage = () => {
    const newPath = pathname?.replace('/ar', '/en') || '/';
    const params = searchParams?.toString();
    const newUrl = params ? `${newPath}?${params}` : newPath;
    router.push(newUrl);
    setIsOpen(false);
  };

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
              aria-orientation="vertical"
              dir="rtl"
            >
              {/* Quick Actions - Dark Mode & Language */}
              <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                <div className="flex gap-2">
                  <button
                    onClick={toggleTheme}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    role="menuitem"
                  >
                    {theme === 'dark' ? (
                      <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    ) : (
                      <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    )}
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {theme === 'dark' ? 'فاتح' : 'داكن'}
                    </span>
                  </button>

                  <button
                    onClick={switchLanguage}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    role="menuitem"
                  >
                    <Languages className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      English
                    </span>
                  </button>
                </div>
              </div>

              {/* Sign In */}
              <div className="p-3">
                <form action={login}>
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
    if (!newChannelName.trim()) return;

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

  const navItems = [
    {
      label: 'الملف الشخصي',
      icon: User,
      href: '/ar/profile',
    },
    {
      label: 'التحليلات',
      icon: BarChart3,
      href: '/ar/analytics',
    },
    {
      label: 'الإعدادات',
      icon: Settings,
      href: '/ar/settings',
    },
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
            aria-orientation="vertical"
            dir="rtl"
          >
            {/* Active Context Card */}
            <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-3">
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
              </div>

              {/* Active Channel Display */}
              {channel ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-md">
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
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-md">
                  <Tv className="h-4 w-4 text-gray-500" />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    لا توجد قناة نشطة
                  </span>
                </div>
              )}
            </div>

            {/* Quick Actions - Dark Mode & Language */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <div className="flex gap-2">
                <button
                  onClick={toggleTheme}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  role="menuitem"
                >
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  ) : (
                    <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  )}
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {theme === 'dark' ? 'فاتح' : 'داكن'}
                  </span>
                </button>

                <button
                  onClick={switchLanguage}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  role="menuitem"
                >
                  <Languages className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    English
                  </span>
                </button>
              </div>
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

            {/* Channels Section */}
            {channels.length > 0 && (
              <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                  قنواتك ({channels.length})
                </div>

                {/* No Channel Option */}
                <button
                  onClick={() => {
                    switchToChannel(null);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                  role="menuitem"
                >
                  <div className="h-8 w-8 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                    <Tv className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      بدون قناة
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      التصفح بدون قناة
                    </div>
                  </div>
                  {!channel && (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                  )}
                </button>

                {/* User's Channels */}
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => {
                      switchToChannel(ch.id);
                    }}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                    role="menuitem"
                  >
                    <div className="relative flex-shrink-0">
                      {ch.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ch.avatarUrl}
                          alt={getChannelName(ch.name, ch.nameLocalized)}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-purple-500 flex items-center justify-center text-white text-sm font-semibold">
                          {getChannelName(ch.name, ch.nameLocalized)[0].toUpperCase()}
                        </div>
                      )}
                      {ch.isMain && (
                        <Crown className="absolute -bottom-1 -right-1 h-3 w-3 text-yellow-500 bg-white dark:bg-gray-900 rounded-full" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {getChannelName(ch.name, ch.nameLocalized)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {ch.isMain ? 'القناة الرئيسية' : 'قناة'}
                      </div>
                    </div>
                    {channel?.id === ch.id && (
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                    )}
                  </button>
                ))}

                {/* Create Channel */}
                {!isCreatingChannel ? (
                  <button
                    onClick={() => setIsCreatingChannel(true)}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right mt-1"
                    role="menuitem"
                  >
                    <div className="h-8 w-8 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                      <Plus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    </div>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      إنشاء قناة جديدة
                    </span>
                  </button>
                ) : (
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg mt-1">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                      اسم القناة
                    </label>
                    <input
                      type="text"
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      placeholder="أدخل اسم القناة"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 text-right"
                      autoFocus
                      dir="rtl"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateChannel();
                        }
                      }}
                    />
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={handleCreateChannel}
                        disabled={!newChannelName.trim()}
                        className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md transition-colors"
                      >
                        إنشاء
                      </button>
                      <button
                        onClick={() => {
                          setIsCreatingChannel(false);
                          setNewChannelName('');
                        }}
                        className="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md transition-colors"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Account Management */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                الحسابات {accounts.length > 1 && `(${accounts.length})`}
              </div>

              {accounts.map((account) => (
                  <div
                    key={account.userId}
                    className="group relative rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <button
                      onClick={() => {
                        if (!account.isActive) {
                          switchAccount(account.userId);
                          setIsOpen(false);
                        }
                      }}
                      className="flex items-center gap-3 w-full px-3 py-2 text-right"
                      role="menuitem"
                      disabled={account.isActive}
                    >
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
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {account.displayName}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {account.email}
                        </div>
                      </div>
                      {account.isActive && (
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                      )}
                    </button>

                    {/* Remove Account (hover only, not for active) */}
                    {!account.isActive && accounts.length > 1 && (
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
                ))}
            </div>

            {/* Add Account & Sign Out */}
            <div className="p-2">
              {/* Add Account */}
              <button
                onClick={() => {
                  addAccount();
                  setIsOpen(false);
                }}
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
                    logoutAll();
                    setIsOpen(false);
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
    </div>
  );
}
