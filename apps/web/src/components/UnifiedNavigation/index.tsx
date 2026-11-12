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
import { MenuBackdrop } from './MenuBackdrop';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { mayCreateChannel, refreshCreatorAccess, useCreatorAccess } from '@/hooks/useCreatorAccess';
import { useLanguage } from '@/hooks/useLanguage';
import Link from '@/components/common/AppLink';
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
  Settings,
  ChevronRight,
  ArrowLeft,
  Users,
  PenLine,
  FileText,
} from 'lucide-react';
import { ACCOUNT_MENU_PATHS } from '@/lib/navigation/destinations';
import { useOptionalAuth } from '@/components/AuthProvider/authContext';
import { getAuthProfileUrl, getAuthUrl, getCmsUrl, getWwwUrl } from '@/lib/runtime-config';
import { appLinks, type AppLinkId } from '@al-ummah/shared-types';
import { cmsLinks, isScholar } from '@/lib/scholars/sites';
import { buildChannelMenu } from '@/lib/channels/menu';
import type { ChannelRole } from '@al-ummah/shared-types';
import { userDisplayName } from '@/lib/display-name';

type MenuView = 'main' | 'channels' | 'accounts';

export function UnifiedNavigation() {
  // Get language context and translations
  const { t, lang } = useLanguage();
  const { user: authUser } = useOptionalAuth();

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
    setChannel(user?.channel);
    setChannels(user?.channels || []);
  }, [user?.id, user?.email, user?.channel, user?.channels]);

  // Get localized display name
  // The user's name (display name, else first + last); the email only as the last resort. The active channel is shown separately
  const getDisplayName = () => userDisplayName(profile, lang) || userDisplayName({ displayName: user?.displayName }, lang, user?.email);

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
  const canCreateChannel = mayCreateChannel(useCreatorAccess());
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
    // Same footprint as the button: the header must not shift when it arrives
    return <span className="aun-acct-btn" aria-hidden="true"><span className="aun-avatar" /></span>;
  }

  // Anonymous user - show menu icon with Sign In option
  if (!user) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="aun-acct-btn"
          aria-label={t.navigation.navigationMenu}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          data-testid="nav-menu-trigger"
        >
          <span className="aun-avatar" aria-hidden="true"><User className="h-4 w-4" /></span>
          <ChevronDown className="aun-caret" aria-hidden="true" />
        </button>
        {isOpen && (
          <>
            <MenuBackdrop onClose={() => setIsOpen(false)} />
            <div className="aun-menu" role="menu" data-testid="nav-menu" aria-orientation="vertical">
              <form action={login.bind(null, lang)}>
                <button type="submit" className="aun-menu-item" role="menuitem">
                  <User className="aun-menu-icon" aria-hidden="true" />
                  <span className="aun-menu-text">{t.navigation.signIn}</span>
                </button>
              </form>
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
    // One more channel (or a refusal): the tier's channel allowance may have changed
    void refreshCreatorAccess();
  };

  // Scholars write articles in the CMS (SSO: no second sign-in), AlUmmahNowCMS docs/SCHOLARS.md
  const cms = isScholar(authUser?.roles) ? cmsLinks(getCmsUrl(), lang) : null;
  const navItems = [
    ...(cms ? [
      { label: t.navigation.writeArticle, icon: PenLine, href: cms.write },
      { label: t.navigation.myArticles, icon: FileText, href: cms.articles },
    ] : []),
    // Studio is the creator home: videos, scheduling and analytics all live there
    ...(channels.length > 0 ? [
      { label: t.studio.title, icon: Video, href: `/${lang}${ACCOUNT_MENU_PATHS.studio}` },
    ] : []),
    { label: t.header.settings, icon: Settings, href: `/${lang}${ACCOUNT_MENU_PATHS.settings}` },
  ];
  // The other Al Ummah Now apps this account may open (docs/design/NAV.md), same order everywhere
  const otherApps = appLinks({
    current: 'videos',
    roles: authUser?.roles,
    lang,
    urls: { www: getWwwUrl(), profile: getAuthProfileUrl(), cms: getCmsUrl(), auth: getAuthUrl() },
  });
  const appLabel: Record<AppLinkId, string> = {
    www: t.navigation.appWww,
    videos: t.navigation.appVideos,
    profile: t.navigation.appProfile,
    cms: t.navigation.appCms,
    admin: t.navigation.appAdmin,
    'auth-admin': t.navigation.appAuthAdmin,
  };
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
      className="aun-acct-current flex-none"
    >
      <span className="sr-only">{t.channelRoles.yourRole.replace('{role}', '')}</span>
      {t.channelRoles.roles[role]}
    </span>
  );
  const displayName = getDisplayName();
  const initial = (displayName[0] || user.email[0] || '?').toUpperCase();
  const avatar = (src: string | undefined | null, letter: string, size = '') =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={`aun-avatar ${size}`} />
    ) : (
      <span className={`aun-avatar ${size}`} aria-hidden="true">{letter}</span>
    );
  const backRow = (title: string) => (
    <button type="button" autoFocus onClick={() => { setView('main'); setIsCreatingChannel(false); }} data-testid="nav-menu-back" className="aun-menu-item" role="menuitem">
      <ArrowLeft className="aun-menu-icon aun-flip" aria-hidden="true" />
      <span className="aun-menu-text font-semibold">{title}</span>
    </button>
  );
  const sep = <div className="aun-menu-sep" role="separator" />;
  return (
    <div className="relative">
      {/* Avatar + display name (the name hides on phones and stays the accessible name) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="aun-acct-btn"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid="nav-menu-trigger"
      >
        {avatar(channel?.avatarUrl || getUserAvatar(), initial)}
        <span className="aun-acct-name nav-trigger-name" dir="auto">{displayName}</span>
        <span className="sr-only">{t.navigation.navigationMenu}</span>
        <ChevronDown className="aun-caret" aria-hidden="true" />
      </button>
      {isOpen && (
        <>
          <MenuBackdrop
            onClose={() => {
              setIsOpen(false);
              setIsCreatingChannel(false);
              setNewChannelName('');
            }}
          />
          <div className="aun-menu" role="menu" data-testid="nav-menu" aria-orientation="vertical">
            {view === 'main' && <>
            {/* Who: the account (to the profile) and, as context, the active channel */}
            <div data-testid="nav-active-context">
              <Link
                data-testid="nav-profile-link"
                href={`/${lang}/profile`}
                onClick={() => setIsOpen(false)}
                className="aun-menu-item aun-menu-who"
              >
                {avatar(getUserAvatar(), initial, 'aun-avatar--lg')}
                <span className="aun-menu-who-text">
                  <span className="aun-menu-who-name" dir="auto" data-testid="nav-user-name">{displayName}</span>
                  {displayName !== user.email && <span className="aun-menu-who-sub" dir="auto">{user.email}</span>}
                </span>
              </Link>
              {channel ? (
                <Link
                  data-testid="nav-active-channel"
                  href={`/${lang}/channels/${channel.id}`}
                  onClick={() => setIsOpen(false)}
                  className="aun-menu-item"
                >
                  <span className="relative flex-none">
                    {avatar(channel.avatarUrl, getChannelName(channel.name, channel.nameLocalized)[0].toUpperCase(), 'aun-avatar--sm')}
                    {channel.isMain && <Crown className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full text-brand-ink" aria-hidden="true" />}
                  </span>
                  <span className="aun-menu-text" dir="auto">{getChannelName(channel.name, channel.nameLocalized)}</span>
                  {activeRole && activeRole !== 'owner' && roleBadge(activeRole)}
                </Link>
              ) : (
                <div data-testid="nav-no-active-channel" className="aun-menu-item aun-menu-who-sub" aria-disabled="true">
                  <Tv className="aun-menu-icon" aria-hidden="true" />
                  <span className="aun-menu-text">{t.navigation.noActiveChannel}</span>
                </div>
              )}
            </div>
            {sep}
            {/* Accounts, then this app's own entries (switchers open in place) */}
            <button type="button" onClick={() => setView('accounts')} data-testid="nav-switch-account" className="aun-menu-item" role="menuitem" aria-haspopup="menu">
              <Users className="aun-menu-icon" aria-hidden="true" />
              <span className="aun-menu-text">{t.header.switchAccount}</span>
              <ChevronRight className="aun-menu-icon aun-flip" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                addAccount();
                setIsOpen(false);
              }}
              data-testid="nav-add-account"
              className="aun-menu-item"
              role="menuitem"
            >
              <Plus className="aun-menu-icon" aria-hidden="true" />
              <span className="aun-menu-text">{t.navigation.addAnotherAccount}</span>
            </button>
            {sep}
            <button type="button" onClick={() => setView('channels')} data-testid="nav-switch-channel" className="aun-menu-item" role="menuitem" aria-haspopup="menu">
              <Tv className="aun-menu-icon" aria-hidden="true" />
              <span className="aun-menu-text">{t.navigation.switchChannel}</span>
              <ChevronRight className="aun-menu-icon aun-flip" aria-hidden="true" />
            </button>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setIsOpen(false)} className="aun-menu-item" role="menuitem">
                  <Icon className="aun-menu-icon" aria-hidden="true" />
                  <span className="aun-menu-text">{item.label}</span>
                </Link>
              );
            })}
            {otherApps.length > 0 && <>
              {sep}
              <div role="group" aria-labelledby="nav-apps-label" data-testid="nav-apps">
                <span className="aun-menu-label" id="nav-apps-label">{t.navigation.appsSection}</span>
                {otherApps.map((app) => (
                  <a key={app.id} href={app.href} className="aun-menu-item" role="menuitem" data-app={app.id}>
                    <span className="aun-menu-text">{appLabel[app.id]}</span>
                  </a>
                ))}
              </div>
            </>}
            {sep}
            {/* Sign out of this account; with several, also of every account (after a confirmation) */}
            <button
              type="button"
              onClick={() => {
                logout();
                setIsOpen(false);
              }}
              data-testid="nav-sign-out"
              className="aun-menu-item"
              role="menuitem"
            >
              <LogOut className="aun-menu-icon aun-flip" aria-hidden="true" />
              <span className="aun-menu-text">{t.navigation.signOut}</span>
            </button>
            {accounts.length > 1 && (
              <button
                type="button"
                onClick={() => setShowLogoutAllConfirm(true)}
                data-testid="nav-sign-out-all"
                className="aun-menu-item aun-menu-item--danger"
                role="menuitem"
              >
                <LogOut className="aun-menu-icon aun-flip" aria-hidden="true" />
                <span className="aun-menu-text">{t.navigation.signOutOfAll}</span>
              </button>
            )}
            </>}
            {view === 'channels' && (
              <div role="group" aria-label={t.navigation.switchChannel}>
                {backRow(t.navigation.switchChannel)}
                {channelSections.map((section) => (
                  <div key={section.key} role="group" aria-labelledby={`nav-channels-${section.key}`} data-testid={`nav-channel-group-${section.key}`}>
                    <p id={`nav-channels-${section.key}`} className="aun-menu-label">
                      {section.key === 'owned' ? t.channelRoles.yourChannels : t.channelRoles.channelsYouManage}
                    </p>
                    {section.items.map((ch) => (
                      <button key={ch.id} type="button" onClick={() => switchToChannel(ch.id)} data-testid="nav-channel-option" data-channel-id={ch.id} data-role={ch.role} aria-checked={channel?.id === ch.id} className="aun-menu-item" role="menuitemradio">
                        <span className="relative flex-none">
                          {avatar(ch.avatarUrl, getChannelName(ch.name, ch.nameLocalized)[0]?.toUpperCase() ?? '?')}
                          {ch.isMain && ch.role === 'owner' && <Crown className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full text-brand-ink" aria-hidden="true" />}
                        </span>
                        <span className="aun-menu-text" dir="auto">{getChannelName(ch.name, ch.nameLocalized)}</span>
                        {ch.role !== 'owner' && roleBadge(ch.role)}
                        {channel?.id === ch.id && <Check className="aun-menu-check" aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                ))}
                <button type="button" onClick={() => switchToChannel(null)} data-testid="nav-channel-option-none" aria-checked={!channel} className="aun-menu-item" role="menuitemradio">
                  <Tv className="aun-menu-icon" aria-hidden="true" />
                  <span className="aun-menu-text">{t.navigation.useWithoutChannel}</span>
                  {!channel && <Check className="aun-menu-check" aria-hidden="true" />}
                </button>
                {/* Create Channel - Only for Active Account, and only with a creator tier that allows another channel */}
                {!canCreateChannel ? null : !isCreatingChannel ? (
                  <button
                    type="button"
                    onClick={() => setIsCreatingChannel(true)}
                    data-testid="nav-create-channel"
                    className="aun-menu-item"
                    role="menuitem"
                  >
                    <Plus className="aun-menu-icon" aria-hidden="true" />
                    <span className="aun-menu-text">{t.navigation.createChannel}</span>
                  </button>
                ) : (
                  <div className="p-2">
                    <label className="aun-menu-label px-0" htmlFor="nav-new-channel-name">
                      {t.navigation.channelName}
                    </label>
                    <input
                      id="nav-new-channel-name"
                      type="text"
                      value={newChannelName}
                      disabled={creatingChannel}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      placeholder={t.navigation.enterChannelName}
                      className="w-full rounded-md border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] px-2 py-1.5 text-sm text-[var(--fanous-color-text-primary)]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateChannel();
                        }
                      }}
                    />
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={handleCreateChannel}
                        disabled={!newChannelName.trim() || creatingChannel}
                        aria-busy={creatingChannel}
                        className="b b-primary flex-1"
                      >
                        {creatingChannel ? t.channel.creating : t.common.create}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingChannel(false);
                          setNewChannelName('');
                        }}
                        className="b b-ghost flex-1"
                      >
                        {t.common.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {view === 'accounts' && (
              <div role="group" aria-label={t.header.switchAccount}>
                {backRow(t.header.switchAccount)}
                {accounts.map((account) => {
                  const accountAvatar = getAccountAvatar(account.userId) ?? account.avatarUrl;
                  const name = account.displayName?.trim() || account.email;
                  const count = account.channelsCount || 0;
                  return (
                    <div key={account.userId} className="aun-acct-row" data-testid="nav-account" data-active={account.isActive ? 'true' : 'false'} data-local={account.hasLocalSession === false ? 'false' : 'true'} data-email={account.email}>
                      <button
                        type="button"
                        onClick={() => { if (!account.isActive) { switchAccount(account.userId); setIsOpen(false); } }}
                        disabled={account.isActive}
                        aria-current={account.isActive ? 'true' : undefined}
                        aria-label={account.isActive ? undefined : t.navigation.switchToAccount.replace('{name}', name)}
                        className="aun-menu-item"
                        role="menuitem"
                      >
                        {avatar(accountAvatar, name[0]?.toUpperCase() ?? '?')}
                        <span className="aun-acct-text">
                          <span className="aun-acct-label" dir="auto">{name}</span>
                          {/* Signed in to the browser but not here yet: its email (switching signs it in) */}
                          <span className="aun-acct-email" dir="auto">
                            {account.isActive ? t.navigation.currentAccount : account.hasLocalSession === false ? account.email : <>{count} {count === 1 ? t.navigation.channel : t.navigation.channels}</>}
                          </span>
                        </span>
                        {account.isActive && <Check className="aun-menu-check" aria-hidden="true" />}
                      </button>
                      {!account.isActive && accounts.length > 1 && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeAccount(account.userId); }} className="aun-acct-signout" aria-label={t.navigation.removeAccount}>
                          {t.navigation.signOut}
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
                {sep}
                <p className="aun-menu-who-sub px-3 py-2 text-[var(--fanous-color-error-text)]" role="alert">{error}</p>
              </>
            )}
          </div>
        </>
      )}
      {/* Sign out of all accounts: the in-app confirmation */}
      <ConfirmDialog
        open={showLogoutAllConfirm}
        title={`${t.navigation.signOutOfAll}?`}
        description={t.navigation.signOutOfAllDescription.replace('{count}', String(accounts.length))}
        confirmLabel={t.navigation.signOutOfAll}
        cancelLabel={t.common.cancel}
        danger
        testId="nav-sign-out-all-confirm"
        onResult={(confirmed) => {
          setShowLogoutAllConfirm(false);
          if (!confirmed) return;
          setIsOpen(false);
          logoutAll(true); // Pass true to skip confirmation check
        }}
      />
    </div>
  );
}
