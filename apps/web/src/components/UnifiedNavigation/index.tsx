/**
 * Unified Navigation Component
 *
 * The header's account menu: account and channel scope only. Browsing links
 * live in the sidebar (see lib/navigation/destinations). One component for
 * both reading directions.
 */

'use client';
import { logger } from '@/lib/logger-client';

import { useState, useEffect } from 'react';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useLanguage } from '@/hooks/useLanguage';
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
  BarChart3,
  Settings,
  ChevronRight,
  ArrowLeft,
  Users,
} from 'lucide-react';
import { ACCOUNT_MENU_PATHS } from '@/lib/navigation/destinations';
import { buildChannelMenu } from '@/lib/channels/menu';
import type { ChannelRole } from '@al-ummah/shared-types';

type MenuView = 'main' | 'channels' | 'accounts';
const ROW = 'flex items-center gap-3 w-full min-h-10 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-start';
const ROW_TEXT = 'text-sm font-medium text-gray-900 dark:text-gray-100';
const ROW_ICON = 'h-[18px] w-[18px] flex-shrink-0 text-gray-500 dark:text-gray-400';

export function UnifiedNavigation() {
  // Get language context and translations
  const { t, lang } = useLanguage();

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

  // Profiles depend on who is signed in, not on the session's channel list:
  // refetching on every session update (each channel reload) queued Server
  // Actions behind it that could undo a navigation started meanwhile.
  const userId = user?.id;
  const userEmail = user?.email;
  const accountsKey = accounts.map((account) => `${account.userId}:${account.email}`).join('|');

  // Fetch user profile for localized display name and avatar
  useEffect(() => {
    if (userId) {
      fetchProfile({ id: userId, email: userEmail ?? '' }, (profileData: Profile) => {
        setProfile(profileData);
      }).catch((err: Error) => {
        logger.error('[UnifiedNavigation] Failed to load profile:', err);
      });
    } else {
      setProfile(null);
    }
  }, [userId, userEmail]);

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
            }).catch(() => resolve()); // Silently fail for individual accounts
          });
        } catch (_err) {
          logger.error(`[UnifiedNavigation] Failed to load profile for ${account.userId}`);
        }
      }

      setAccountProfiles(profilesMap);
    };

    if (accounts.length > 0) {
      loadAccountProfiles();
    }
    // Keyed on the account ids and emails (accountsKey), not the array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey]);

  // Update local state when user changes
  useEffect(() => {
    logger.debug('[UnifiedNavigation] User changed:', {
      
      email: user?.email,
      hasChannel: !!user?.channel,
      channelName: user?.channel?.name,
      channelsCount: user?.channels?.length || 0,
    });
    setChannel(user?.channel);
    setChannels(user?.channels || []);
  }, [user?.id, user?.email, user?.channel, user?.channels]);

  // Get localized display name
  const getDisplayName = () => {
    if (profile?.displayNameLocalized?.[lang]) {
      return profile.displayNameLocalized[lang];
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

  // Get avatar for any account by userId
  const getAccountAvatar = (userId: string) => {
    const accountProfile = accountProfiles.get(userId);
    return accountProfile?.avatarUrl;
  };

  // Get localized channel name
  const getChannelName = (channelName: string, channelNameLocalized?: Record<string, string>) => {
    if (channelNameLocalized?.[lang]) {
      return channelNameLocalized[lang];
    }
    return channelName;
  };

  const [isOpen, setIsOpenState] = useState(false);
  const [view, setView] = useState<MenuView>('main');
  const setIsOpen = (open: boolean) => {
    setIsOpenState(open);
    setView('main');
  };
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);

  // Handle Escape key to close menu
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpenState(false);
        setView('main');
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
          className="flex items-center gap-2 rounded-lg p-2 hover:bg-white/10 transition-colors"
          aria-label={t.navigation.navigationMenu}
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
              className="absolute end-0 mt-2 w-80 rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
              role="menu"
              data-testid="nav-menu"
              aria-orientation="vertical"
            >
              {/* Sign In */}
              <div className="p-3">
                <form action={login.bind(null, lang)}>
                  <button
                    type="submit"
                    className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-lg bg-brand hover:bg-brand-hover text-on-brand font-semibold transition-all shadow-md hover:shadow-lg"
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

  const navItems = [
    ...(channels.length > 0 ? [
      { label: t.video.myVideos || 'My Videos', icon: Video, href: `/${lang}${ACCOUNT_MENU_PATHS.myVideos}` },
      { label: t.schedule?.scheduledVideos || 'Scheduled Videos', icon: Calendar, href: `/${lang}${ACCOUNT_MENU_PATHS.scheduled}` },
    ] : []),
    { label: t.navigation.analytics, icon: BarChart3, href: `/${lang}${ACCOUNT_MENU_PATHS.analytics}` },
    { label: t.header.settings, icon: Settings, href: `/${lang}${ACCOUNT_MENU_PATHS.settings}` },
  ];

  // Owned channels first, then channels where this account holds a channel
  // role (live list from /api/channels/access via useMultiAccount)
  const channelSections = user ? buildChannelMenu(channels, user.id) : [];
  const activeRole: ChannelRole | undefined = channel
    ? (channel.role ?? (!channel.userId || channel.userId === user?.id ? 'owner' : undefined))
    : undefined;
  const roleBadge = (role: ChannelRole) => (
    <span
      data-testid="nav-channel-role"
      title={t.channelRoles.yourRole.replace('{role}', t.channelRoles.roles[role])}
      className="flex-shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
    >
      <span className="sr-only">{t.channelRoles.yourRole.replace('{role}', '')}</span>
      {t.channelRoles.roles[role]}
    </span>
  );

  const displayName = getDisplayName();
  const backRow = (title: string) => (
    <button type="button" autoFocus onClick={() => { setView('main'); setIsCreatingChannel(false); }} data-testid="nav-menu-back" className={`${ROW} font-semibold`} role="menuitem">
      <ArrowLeft className={`${ROW_ICON} rtl:rotate-180`} aria-hidden="true" />
      <span className={ROW_TEXT}>{title}</span>
    </button>
  );

  return (
    <div className="relative">
      {/* Trigger Button - Avatar with Dropdown */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg p-2 hover:bg-white/10 transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid="nav-menu-trigger"
      >
        {/* Avatar: Show channel avatar if channel selected, otherwise user avatar */}
        {channel?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.avatarUrl}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : getUserAvatar() ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getUserAvatar()!}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div aria-hidden="true" className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold">
            {displayName[0]?.toUpperCase() || user.email[0].toUpperCase()}
          </div>
        )}

        {/* User Info (hidden on mobile) */}
        <div className="nav-trigger-name hidden md:block text-start">
          <div className="text-sm font-medium text-white truncate max-w-[150px]">
            {getDisplayName()}
          </div>
          <div className="text-xs text-gray-300 truncate max-w-[150px]">
            {channel ? getChannelName(channel.name, channel.nameLocalized) : t.navigation.noChannel}
          </div>
        </div>

        {/* Accessible name = visible name + channel + "Navigation menu" (label-in-name) */}
        <span className="sr-only">{t.navigation.navigationMenu}</span>
        <ChevronDown className="h-4 w-4 text-gray-300" aria-hidden="true" />
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
            className="absolute end-0 mt-2 w-80 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 z-50"
            role="menu"
            data-testid="nav-menu"
            aria-orientation="vertical"
          >
            {view === 'main' && <>
            {/* Active Context Card */}
            <div data-testid="nav-active-context" className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b border-gray-200 dark:border-gray-700">
              <Link
                data-testid="nav-profile-link"
                href={`/${lang}/profile`}
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
                    {displayName[0]?.toUpperCase() || user.email[0].toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {getDisplayName()}
                  </div>
                  {displayName !== user.email && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                      {user.email}
                    </div>
                  )}
                </div>
              </Link>

              {/* Active Channel Display */}
              {channel ? (
                <Link
                  data-testid="nav-active-channel"
                  href={`/${lang}/channels/${channel.id}`}
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-md hover:bg-white/80 dark:hover:bg-gray-800/80 transition-colors cursor-pointer"
                >
                  <div className="relative flex-shrink-0">
                    {channel.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={channel.avatarUrl}
                        alt={channel.name}
                        className="h-6 w-6 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-semibold">
                        {getChannelName(channel.name, channel.nameLocalized)[0].toUpperCase()}
                      </div>
                    )}
                    {channel.isMain && (
                      <Crown className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-brand-ink bg-white dark:bg-gray-900 rounded-full" />
                    )}
                  </div>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1">
                    {getChannelName(channel.name, channel.nameLocalized)}
                  </span>
                  {activeRole && activeRole !== 'owner' && roleBadge(activeRole)}
                </Link>
              ) : (
                <div data-testid="nav-no-active-channel" className="flex items-center gap-2 px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-md">
                  <Tv className="h-4 w-4 text-gray-500" />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {t.navigation.noActiveChannel}
                  </span>
                </div>
              )}
            </div>

            {/* Switchers open in place */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <button type="button" onClick={() => setView('channels')} data-testid="nav-switch-channel" className={ROW} role="menuitem" aria-haspopup="menu">
                <Tv className={ROW_ICON} aria-hidden="true" />
                <span className={`${ROW_TEXT} flex-1`}>{t.navigation.switchChannel}</span>
                <ChevronRight className={`${ROW_ICON} rtl:rotate-180`} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setView('accounts')} data-testid="nav-switch-account" className={ROW} role="menuitem" aria-haspopup="menu">
                <Users className={ROW_ICON} aria-hidden="true" />
                <span className={`${ROW_TEXT} flex-1`}>{t.header.switchAccount}</span>
                <ChevronRight className={`${ROW_ICON} rtl:rotate-180`} aria-hidden="true" />
              </button>
            </div>

            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={ROW}
                    role="menuitem"
                  >
                    <Icon className={ROW_ICON} aria-hidden="true" />
                    <span className={ROW_TEXT}>
                      {item.label}
                    </span>
                  </Link>
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
                className={ROW}
                role="menuitem"
              >
                <Plus className={ROW_ICON} aria-hidden="true" />
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
                data-testid="nav-sign-out"
                className={ROW}
                role="menuitem"
              >
                <LogOut className={ROW_ICON} aria-hidden="true" />
                <span className={ROW_TEXT}>{t.navigation.signOut}</span>
              </button>

              {/* Sign Out All (if multiple accounts) */}
              {accounts.length > 1 && (
                <button
                  onClick={() => {
                    setShowLogoutAllConfirm(true);
                  }}
                  className={ROW}
                  role="menuitem"
                >
                  <LogOut className="h-[18px] w-[18px] flex-shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    {t.navigation.signOutOfAll}
                  </span>
                </button>
              )}
            </div>

            </>}

            {view === 'channels' && (
              <div className="p-2" role="group" aria-label={t.navigation.switchChannel}>
                {backRow(t.navigation.switchChannel)}
                {channelSections.map((section) => (
                  <div key={section.key} role="group" aria-labelledby={`nav-channels-${section.key}`} data-testid={`nav-channel-group-${section.key}`}>
                    <p id={`nav-channels-${section.key}`} className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {section.key === 'owned' ? t.channelRoles.yourChannels : t.channelRoles.channelsYouManage}
                    </p>
                    {section.items.map((ch) => (
                      <button key={ch.id} type="button" onClick={() => switchToChannel(ch.id)} data-testid="nav-channel-option" data-channel-id={ch.id} data-role={ch.role} aria-checked={channel?.id === ch.id} className={ROW} role="menuitemradio">
                        <span className="relative flex-shrink-0">
                          {ch.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={ch.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-500 text-xs font-semibold text-white">{getChannelName(ch.name, ch.nameLocalized)[0].toUpperCase()}</span>
                          )}
                          {ch.isMain && ch.role === 'owner' && <Crown className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-white text-brand-ink dark:bg-gray-900" />}
                        </span>
                        <span className={`${ROW_TEXT} flex-1 min-w-0 truncate`}>{getChannelName(ch.name, ch.nameLocalized)}</span>
                        {ch.role !== 'owner' && roleBadge(ch.role)}
                        {channel?.id === ch.id && <Check className={ROW_ICON} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                ))}
                <button type="button" onClick={() => switchToChannel(null)} data-testid="nav-channel-option-none" aria-checked={!channel} className={ROW} role="menuitemradio">
                  <Tv className={`${ROW_ICON} mx-[5px]`} aria-hidden="true" />
                  <span className={`${ROW_TEXT} flex-1`}>{t.navigation.useWithoutChannel}</span>
                  {!channel && <Check className={ROW_ICON} aria-hidden="true" />}
                </button>
                        {/* Create Channel - Only for Active Account */}
                        {!isCreatingChannel ? (
                          <button
                            onClick={() => setIsCreatingChannel(true)}
                            data-testid="nav-create-channel"
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
                              disabled={creatingChannel}
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
                                disabled={!newChannelName.trim() || creatingChannel}
                                aria-busy={creatingChannel}
                                className="flex-1 px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md transition-colors"
                              >
                                {creatingChannel ? t.channel.creating : t.common.create}
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

            {view === 'accounts' && (
              <div className="p-2" role="group" aria-label={t.header.switchAccount}>
                {backRow(t.header.switchAccount)}
                {accounts.map((account) => {
                  const avatar = getAccountAvatar(account.userId) ?? account.avatarUrl;
                  const name = account.displayName || account.email;
                  const count = account.channelsCount || 0;
                  return (
                    <div key={account.userId} className="group relative" data-testid="nav-account" data-active={account.isActive ? 'true' : 'false'} data-local={account.hasLocalSession === false ? 'false' : 'true'} data-email={account.email}>
                      <button type="button" onClick={() => { if (!account.isActive) { switchAccount(account.userId); setIsOpen(false); } }} disabled={account.isActive} className={ROW} role="menuitem">
                        {avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatar} alt="" className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-sm font-semibold text-white">{name[0]?.toUpperCase()}</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate ${ROW_TEXT}`}>{name}</span>
                          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{/* Signed in to the browser but not here yet: its email (switching signs it in) */}{account.hasLocalSession === false ? account.email : <>{count} {count === 1 ? t.navigation.channel : t.navigation.channels}</>}</span>
                        </span>
                        {account.isActive && <Check className={ROW_ICON} aria-hidden="true" />}
                      </button>
                      {!account.isActive && accounts.length > 1 && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeAccount(account.userId); }} className="absolute end-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity" aria-label={t.navigation.removeAccount}>
                          <LogOut className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

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
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md p-6 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {t.navigation.signOutOfAll}?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {t.navigation.signOutOfAllDescription.replace('{count}', String(accounts.length))}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowLogoutAllConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={() => {
                  setShowLogoutAllConfirm(false);
                  setIsOpen(false);
                  logoutAll(true); // Pass true to skip confirmation check
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                {t.navigation.signOutOfAll}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
