/**
 * Unified Navigation Component
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
 */

'use client';

import { useState, useEffect } from 'react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useTheme } from 'next-themes';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import Link from 'next/link';
import { login } from '@/lib/actions';
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

export function UnifiedNavigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get language context and translations
  const { t, lang, oppositeLanguage, languages } = useLanguage();

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

  // Update local state when user changes
  useEffect(() => {
    console.log('[UnifiedNavigation] User changed:', {
      userId: user?.id,
      email: user?.email,
      hasChannel: !!user?.channel,
      channelName: user?.channel?.name,
      channelsCount: user?.channels?.length || 0,
    });
    setChannel(user?.channel);
    setChannels(user?.channels || []);
  }, [user?.id, user?.channel, user?.channels]);

  const { theme, setTheme } = useTheme();

  const [isOpen, setIsOpen] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

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

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const switchLanguage = () => {
    // Smart language switching using language context
    const newPath = pathname?.replace(`/${lang}`, `/${oppositeLanguage}`) || `/${oppositeLanguage}`;
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
          aria-label={t.navigation.navigationMenu}
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
              className="absolute right-0 mt-2 w-80 rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
              role="menu"
              aria-orientation="vertical"
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
                      {theme === 'dark' ? t.navigation.light : t.navigation.dark}
                    </span>
                  </button>

                  <button
                    onClick={switchLanguage}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    role="menuitem"
                  >
                    <Languages className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {languages[oppositeLanguage].displayName}
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
                    <span className="text-sm">{t.navigation.signIn}</span>
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
      label: t.navigation.profile,
      icon: User,
      href: `/${lang}/profile`,
    },
    {
      label: t.navigation.analytics,
      icon: BarChart3,
      href: `/${lang}/analytics`,
    },
    {
      label: t.header.settings,
      icon: Settings,
      href: `/${lang}/settings`,
    },
  ];

  return (
    <div className="relative">
      {/* Trigger Button - User Avatar with Dropdown */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label={t.navigation.navigationMenu}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {/* User Avatar */}
        <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold">
          {user.displayName?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
        </div>

        {/* User Info (hidden on mobile) */}
        <div className="hidden md:block text-left">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
            {user.displayName}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">
            {channel ? channel.name : t.navigation.noChannel}
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
            className="absolute right-0 mt-2 w-80 max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
            role="menu"
            aria-orientation="vertical"
          >
            {/* Active Context Card */}
            <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-12 w-12 rounded-full bg-blue-500 flex items-center justify-center text-white text-lg font-semibold flex-shrink-0">
                  {user.displayName?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {user.displayName}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {user.email}
                  </div>
                </div>
              </div>

              {/* Active Channel Display */}
              {channel ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-md">
                  <div className="h-6 w-6 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-semibold">
                    {channel.name[0].toUpperCase()}
                  </div>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1">
                    {channel.name}
                  </span>
                  {channel.isMain && (
                    <Crown className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-md">
                  <Tv className="h-4 w-4 text-gray-500" />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {t.navigation.noActiveChannel}
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
                    {theme === 'dark' ? t.navigation.light : t.navigation.dark}
                  </span>
                </button>

                <button
                  onClick={switchLanguage}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  role="menuitem"
                >
                  <Languages className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {languages[oppositeLanguage].displayName}
                  </span>
                </button>
              </div>
            </div>

            {/* Navigation Links */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                {t.navigation.navigation.toUpperCase()}
              </div>
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
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
                {t.navigation.accounts.toUpperCase()} {accounts.length > 1 && `(${accounts.length})`}
              </div>

              {accounts.map((account) => {
                // Filter channels belonging to this account
                const accountChannels = channels.filter(ch => ch.userId === account.userId);
                const isActive = account.isActive;

                return (
                  <div key={account.userId} className="mb-2">
                    {/* Account Header */}
                    <div className="group relative rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <button
                        onClick={() => {
                          if (!isActive) {
                            switchAccount(account.userId);
                            setIsOpen(false);
                          }
                        }}
                        className="flex items-center gap-3 w-full px-3 py-2 text-left"
                        role="menuitem"
                        disabled={isActive}
                      >
                        <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                          {account.displayName?.[0]?.toUpperCase() || account.email[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {account.displayName}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {accountChannels.length} {accountChannels.length === 1 ? t.navigation.channel : t.navigation.channels}
                          </div>
                        </div>
                        {isActive && (
                          <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                        )}
                      </button>

                      {/* Remove Account (hover only, not for active) */}
                      {!isActive && accounts.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAccount(account.userId);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remove account"
                        >
                          <LogOut className="h-4 w-4 text-red-600 dark:text-red-400" />
                        </button>
                      )}
                    </div>

                    {/* Nested Channels for Active Account Only */}
                    {isActive && (
                      <div className="ml-6 mt-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
                        {/* No Channel Option */}
                        <button
                          onClick={() => {
                            switchToChannel(null);
                          }}
                          className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                          role="menuitem"
                        >
                          <div className="h-6 w-6 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                            <Tv className="h-3 w-3 text-gray-500 dark:text-gray-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
                              {t.navigation.noChannel}
                            </div>
                          </div>
                          {!channel && (
                            <Check className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                          )}
                        </button>

                        {/* Account's Channels */}
                        {accountChannels.map((ch) => (
                          <button
                            key={ch.id}
                            onClick={() => {
                              switchToChannel(ch.id);
                            }}
                            className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                            role="menuitem"
                          >
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
                                  {ch.name[0].toUpperCase()}
                                </div>
                              )}
                              {ch.isMain && (
                                <Crown className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-yellow-500 bg-white dark:bg-gray-900 rounded-full" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                                {ch.name}
                              </div>
                            </div>
                            {channel?.id === ch.id && (
                              <Check className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                            )}
                          </button>
                        ))}

                        {/* Create Channel - Only for Active Account */}
                        {!isCreatingChannel ? (
                          <button
                            onClick={() => setIsCreatingChannel(true)}
                            className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left mt-1"
                            role="menuitem"
                          >
                            <div className="h-6 w-6 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                              <Plus className="h-3 w-3 text-gray-500 dark:text-gray-400" />
                            </div>
                            <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                              {t.navigation.createChannel}
                            </span>
                          </button>
                        ) : (
                          <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded-lg mt-1">
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {t.navigation.channelName}
                            </label>
                            <input
                              type="text"
                              value={newChannelName}
                              onChange={(e) => setNewChannelName(e.target.value)}
                              placeholder={t.navigation.enterChannelName}
                              className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100"
                              autoFocus
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  handleCreateChannel();
                                }
                              }}
                            />
                            <div className="flex gap-1.5 mt-2">
                              <button
                                onClick={handleCreateChannel}
                                disabled={!newChannelName.trim()}
                                className="flex-1 px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md transition-colors"
                              >
                                {t.common.create}
                              </button>
                              <button
                                onClick={() => {
                                  setIsCreatingChannel(false);
                                  setNewChannelName('');
                                }}
                                className="flex-1 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md transition-colors"
                              >
                                {t.common.cancel}
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
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                role="menuitem"
              >
                <div className="h-8 w-8 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                  <Plus className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t.navigation.addAnotherAccount}
                </span>
              </button>

              {/* Sign Out Current */}
              <button
                onClick={() => {
                  logout();
                  setIsOpen(false);
                }}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                role="menuitem"
              >
                <div className="h-8 w-8 flex items-center justify-center flex-shrink-0">
                  <LogOut className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t.navigation.signOutOf} {user.displayName}
                </span>
              </button>

              {/* Sign Out All (if multiple accounts) */}
              {accounts.length > 1 && (
                <button
                  onClick={() => {
                    logoutAll();
                    setIsOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                  role="menuitem"
                >
                  <div className="h-8 w-8 flex items-center justify-center flex-shrink-0">
                    <LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    {t.navigation.signOutOfAll}
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
