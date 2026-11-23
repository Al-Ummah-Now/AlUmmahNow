/**
 * Unified Navigation Component
 *
 * The header's account menu: account and channel scope only. Browsing links
 * live in the sidebar (see lib/navigation/destinations). One component for
 * both reading directions.
 */

'use client';
import { logger } from '@/lib/logger-client';

import { useState, useEffect, useMemo } from 'react';
import { useFitToViewport } from '@/hooks/useFitToViewport';
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
  LogIn,
  Tv,
  Crown,
  Video,
  Settings,
  ChevronRight,
  ArrowLeft,
  PenLine,
  FileText,
  UserPlus,
} from 'lucide-react';
import { ACCOUNT_MENU_PATHS } from '@/lib/navigation/destinations';
import { ACCOUNT_MENU_EVENT, type AccountMenuRequest } from '@/lib/navigation/account-menu-events';
import { useOptionalAuth } from '@/components/AuthProvider/authContext';
import { getAuthProfileUrl, getAuthUrl, getCmsUrl, getWwwUrl } from '@/lib/runtime-config';
import { appLinks, type AppLinkId, formatNumber } from '@al-ummah/shared-types';
import { cmsLinks, isScholar } from '@/lib/scholars/sites';
import { buildChannelMenu } from '@/lib/channels/menu';
import { useChannelInviteCount } from '@/lib/channels/invites-count';
import type { ChannelRole } from '@al-ummah/shared-types';
import { userDisplayName } from '@/lib/display-name';
import { identityInitial, identityName, lastIdentityName, rememberIdentityName } from '@/lib/navigation/identity-name';
import { HeaderSignIn } from '@/components/Header/HeaderParts';
import { avatarInitial } from '@/lib/avatar-initial';

type MenuView = 'main' | 'channels';

/**
 * The name slot while no name is known yet: a text-sized bar in the nav's own text colour, faded, so
 * it reads on the pill in every theme (the page skeleton tokens match the pill's background)
 */
const NAME_SKELETON = {
  display: 'inline-block', inlineSize: '7em', maxInlineSize: '100%', blockSize: '0.75em',
  verticalAlign: 'middle', background: 'currentColor', opacity: 0.28, borderRadius: '999px',
} as const;

const MENU_FOCUSABLE = '[role="menuitem"], [role="menuitemradio"]';

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

  // Read from the session as it renders, never mirrored into state: a copy set by an effect changed one
  // paint after everything else reading the session, so on a switch the comment box showed the new
  // identity while the pill still named the old one (AUDIT-2 re-audit 8, #1656)
  const channel = user?.channel;
  const channels = useMemo(() => user?.channels || [], [user?.channels]);
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

  // Get localized display name
  // The user's name (display name, else first + last); the email only as the last resort. The active channel is shown separately
  // (#1673) Never the email: the session carries it as a stand-in name until the profile loads, so
  // while a switch loads the name comes from what is already known (this account's menu row, the
  // last name shown in this tab); with none yet the pill shows an avatar without a letter.
  const ownProfile = profile && (!profile.id || profile.id === user?.id) ? profile : null;
  const activeAccount = accounts.find((a) => a.userId === user?.id);
  const getDisplayName = () => (user ? identityName([
    userDisplayName(ownProfile, lang),
    userDisplayName(accountProfiles.get(user.id), lang),
    user.displayName,
    activeAccount?.displayName,
    lastIdentityName(user.id),
  ], user.email) : '');
  const knownName = getDisplayName();
  useEffect(() => {
    if (user?.id && knownName) rememberIdentityName(user.id, knownName);
  }, [user?.id, knownName]);
  // The other accounts' names too (their menu rows): switching to one then shows its name at once,
  // although the header remounts and its profile is still loading
  const accountName = (account: { userId: string; displayName?: string; email: string }) =>
    identityName([userDisplayName(accountProfiles.get(account.userId), lang), account.displayName, lastIdentityName(account.userId)], account.email);
  useEffect(() => {
    for (const [id, p] of accountProfiles) {
      const name = userDisplayName(p, lang);
      if (name) rememberIdentityName(id, name);
    }
  }, [accountProfiles, lang]);

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
  // Channel invitations waiting for this account (docs/specs/CHANNEL-ROLES.md §14), counted when the menu opens
  const inviteCount = useChannelInviteCount(!!user, isOpen);
  const creatorAccess = useCreatorAccess();
  const canCreateChannel = mayCreateChannel(creatorAccess);
  // The tier's channel limit is reached: say so where "Create channel" would be (channel_limit)
  const channelLimit = creatorAccess.status === 'ready' && !creatorAccess.access.canCreateChannel && !creatorAccess.access.pendingDeletion
    && creatorAccess.access.maxChannels !== null && creatorAccess.access.channelsOwned >= creatorAccess.access.maxChannels
    ? creatorAccess.access.maxChannels
    : null;
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  // The menu never leaves the screen (docs/design/NAV.md); refit when the view changes
  const menuRef = useFitToViewport<HTMLDivElement>(isOpen, view, isCreatingChannel);
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);
  // A create refused for the channel limit re-reads the tier: the form closes and the limit shows
  useEffect(() => {
    if (!canCreateChannel) setIsCreatingChannel(false);
  }, [canCreateChannel]);

  // Other parts of the page open the menu on a view: the identity
  // tour (lib/navigation/account-menu-events.ts)
  useEffect(() => {
    const onRequest = (event: Event) => {
      const { open, view: wanted = 'main', focus } = (event as CustomEvent<AccountMenuRequest>).detail ?? { open: false };
      setIsOpenState(open);
      setView(open ? wanted : 'main');
      setIsCreatingChannel(false);
      if (open && focus) {
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(`[data-testid="nav-menu"] ${MENU_FOCUSABLE}`)?.focus();
        });
      }
    };
    window.addEventListener(ACCOUNT_MENU_EVENT, onRequest);
    return () => window.removeEventListener(ACCOUNT_MENU_EVENT, onRequest);
  }, []);

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

  // A switch in progress keeps the current identity in the pill (never a gap that falls back to
  // the email); only the first load, with no one shown yet, is the bare placeholder
  const switching = loading && !!user;
  if (loading && !user) {
    // Same footprint as the button: the header must not shift when it arrives
    return <span className="aun-acct-btn" aria-hidden="true"><span className="aun-avatar" /></span>;
  }

  // Signed out: the header's solid "Sign in" (docs/design/NAV.md), never hidden in a menu. It posts the
  // sign-in action, which starts the OAuth flow and comes back to this page.
  if (!user) {
    return (
      <form action={login.bind(null, lang)} className="contents">
        <HeaderSignIn lang={lang} />
      </form>
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
    { label: t.header.settings, icon: Settings, href: `/${lang}${ACCOUNT_MENU_PATHS.settings}` },
  ] as { label: string; icon: typeof Settings; href: string; testId?: string }[];
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
      className="aun-badge"
    >
      <span className="sr-only">{t.channelRoles.yourRole.replace('{role}', '')}</span>
      {t.channelRoles.roles[role]}
    </span>
  );
  const displayName = knownName;
  const otherAccounts = accounts.filter((a) => !a.isActive);
  const initial = identityInitial(displayName);
  const nameLoading = !channel && !displayName;
  const channelInitial = channel ? avatarInitial(getChannelName(channel.name, channel.nameLocalized)) : initial;
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
  // An identity in the Acting as layer (the YouTube/Facebook pattern): picture, name and a small
  // tag saying whether it is you ("Personal") or a channel ("Channel"); never "no channel"
  const identityText = (name: string, tag: string) => (
    <span className="aun-acct-text">
      <span className="aun-acct-label" dir="auto">{name}</span>
      <span className="aun-identity-tag" data-testid="nav-identity-tag">{tag}</span>
    </span>
  );
  return (
    <div className="relative">
      {/* Avatar + display name (the name hides on phones and stays the accessible name) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="aun-acct-btn"
        aria-expanded={isOpen && !switching}
        aria-haspopup="menu"
        data-testid="nav-menu-trigger"
        disabled={switching}
        aria-busy={switching || nameLoading || undefined}
      >
        {/* The identity you act as (owner rule 8): the active channel's logo (or its letter) and its
            name, never your picture or name under a channel; your own picture and name when Personal */}
        {channel ? avatar(channel.avatarUrl, channelInitial) : avatar(getUserAvatar(), initial)}
        {/* No name known yet (an account switch before its profile arrives): a skeleton keeps the
            pill's width, never the email (#1673) */}
        <span
          className="aun-acct-name nav-trigger-name"
          dir="auto"
          data-testid="nav-trigger-name"
          data-identity={channel ? 'channel' : 'personal'}
          data-loading={nameLoading || undefined}
        >
          {/* Inside the slot, so the phone layout's 1px clip of the name still holds */}
          {nameLoading ? <span data-skeleton="" style={NAME_SKELETON} aria-hidden="true" /> : channel ? getChannelName(channel.name, channel.nameLocalized) : displayName}
        </span>
        <span className="sr-only">{t.navigation.navigationMenu}</span>
        <ChevronDown className="aun-caret" aria-hidden="true" />
      </button>
      {isOpen && !switching && (
        <>
          <MenuBackdrop
            onClose={() => {
              setIsOpen(false);
              setIsCreatingChannel(false);
              setNewChannelName('');
            }}
          />
          <div ref={menuRef} className="aun-menu" role="menu" data-testid="nav-menu" aria-orientation="vertical">
            {view === 'main' && <>
            {/* 1. Who: the account (to the profile) */}
            <div data-testid="nav-active-context">
              {/* The current account is only here (the Google pattern): the other accounts follow under "More accounts" */}
              <div data-testid="nav-account" data-active="true" data-local="true" data-email={user.email}>
              <Link
                role="menuitem"
                data-testid="nav-profile-link"
                href={`/${lang}/profile`}
                onClick={() => setIsOpen(false)}
                className="aun-menu-item aun-menu-who"
              >
                {avatar(getUserAvatar(), initial, 'aun-avatar--lg')}
                <span className="aun-menu-who-text">
                  <span className="aun-menu-who-name" dir="auto" data-testid="nav-user-name">{displayName || <span data-skeleton="" style={NAME_SKELETON} aria-hidden="true" />}</span>
                  <EmailText email={user.email} className="aun-menu-who-sub" />
                </span>
              </Link>
              </div>
            </div>
            {sep}
            {/* 2. The context slot (docs/design/NAV.md): the videos app's channel layer. The active
                channel scopes Studio and the header Upload; switching channels never switches the account. */}
            <div className="aun-menu-context" role="group" aria-labelledby="nav-channel-layer-label" data-testid="nav-channel-layer">
              <span className="aun-menu-label" id="nav-channel-layer-label">{t.navigation.channelSection}</span>
              {channel ? (
                <Link
                  data-testid="nav-active-channel"
                  data-identity="channel"
                  href={`/${lang}/channels/${channel.id}`}
                  onClick={() => setIsOpen(false)}
                  className="aun-menu-item aun-menu-context-current"
                  role="menuitem"
                >
                  <span className="relative flex-none">
                    {avatar(channel.avatarUrl, avatarInitial(getChannelName(channel.name, channel.nameLocalized)))}
                    {channel.isMain && <Crown className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full text-brand-ink" aria-hidden="true" />}
                  </span>
                  {identityText(getChannelName(channel.name, channel.nameLocalized), t.navigation.identityChannel)}
                  {activeRole && activeRole !== 'owner' && roleBadge(activeRole)}
                </Link>
              ) : (
                <div data-testid="nav-no-active-channel" data-identity="personal" className="aun-menu-item aun-menu-context-current" aria-disabled="true">
                  {avatar(getUserAvatar(), initial)}
                  {identityText(displayName, t.navigation.identityPersonal)}
                </div>
              )}
              <button type="button" onClick={() => setView('channels')} data-testid="nav-switch-channel" className="aun-menu-item" role="menuitem" aria-haspopup="menu">
                <Tv className="aun-menu-icon" aria-hidden="true" />
                <span className="aun-menu-text">{t.navigation.switchChannel}</span>
                <ChevronRight className="aun-menu-icon aun-flip" aria-hidden="true" />
              </button>
              {/* Studio acts on the active channel; uploading lives in the header and in Studio (owner review rev 5) */}
              {channels.length > 0 && (
                <Link href={`/${lang}${ACCOUNT_MENU_PATHS.studio}`} onClick={() => setIsOpen(false)} data-testid="nav-menu-studio" className="aun-menu-item" role="menuitem">
                  <Video className="aun-menu-icon" aria-hidden="true" />
                  <span className="aun-menu-text">{t.studio.title}</span>
                </Link>
              )}
              {inviteCount > 0 && (
                <Link href={`/${lang}${ACCOUNT_MENU_PATHS.channelInvites}`} onClick={() => setIsOpen(false)} data-testid="nav-menu-channel-invites" data-count={inviteCount} className="aun-menu-item" role="menuitem">
                  <UserPlus className="aun-menu-icon" aria-hidden="true" />
                  <span className="aun-menu-text">{t.channelRoles.invitationsCount.replace('{count}', formatNumber(lang, inviteCount))}</span>
                </Link>
              )}
              {/* No channel yet: creating one is right here (with channels it sits in the switcher) */}
              {channels.length === 0 && canCreateChannel && (
                <button type="button" onClick={() => { setView('channels'); setIsCreatingChannel(true); }} data-testid="nav-create-channel" className="aun-menu-item" role="menuitem">
                  <Plus className="aun-menu-icon" aria-hidden="true" />
                  <span className="aun-menu-text">{t.navigation.createChannel}</span>
                </button>
              )}
            </div>
            {sep}
            {/* 3. More accounts: the other accounts in this browser, then Add another account */}
            {otherAccounts.length > 0 && (
              <div role="group" aria-labelledby="nav-more-accounts-label" data-testid="nav-more-accounts">
                <span className="aun-menu-label" id="nav-more-accounts-label">{t.navigation.moreAccounts}</span>
                {otherAccounts.map((account) => {
                  const accountAvatar = getAccountAvatar(account.userId) ?? account.avatarUrl;
                  // The name only (#1673); the email is the line under it, never the label
                  const name = accountName(account);
                  return (
                    <div key={account.userId} className="aun-acct-row" data-testid="nav-account" data-active="false" data-local={account.hasLocalSession === false ? 'false' : 'true'} data-email={account.email}>
                      <button
                        type="button"
                        onClick={() => { switchAccount(account.userId); setIsOpen(false); }}
                        aria-label={t.navigation.switchToAccount.replace('{name}', name || account.email)}
                        className="aun-menu-item"
                        role="menuitem"
                      >
                        {avatar(accountAvatar, identityInitial(name))}
                        <span className="aun-acct-text">
                          {name && <span className="aun-acct-label" dir="auto">{name}</span>}
                          <EmailText email={account.email} className="aun-acct-email" />
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeAccount(account.userId); }}
                        className="aun-acct-signout"
                        data-testid="nav-account-sign-out"
                        aria-label={`${t.navigation.signOutOf} ${name || account.email}`}
                        title={`${t.navigation.signOutOf} ${name || account.email}`}
                      >
                        <LogOut className="aun-flip" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
              <LogIn className="aun-menu-icon aun-flip" aria-hidden="true" />
              <span className="aun-menu-text">{t.navigation.addAnotherAccount}</span>
            </button>
            {sep}
            {/* 4. This app's own entries */}
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setIsOpen(false)} className="aun-menu-item" role="menuitem" data-testid={item.testId}>
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
                    {/* The app's own favicon, a separate static file (never inlined in the CSS). Eager and
                        decoded with the menu: the menu mounts when it opens (and again when you switch who you
                        act as), and a lazy icon drew a frame late, an empty slot beside "Website" (AUDIT-2 2026-11-21) */}
                    {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 96px icon; next/image would add an optimiser round trip */}
                    <img className="aun-app-icon" data-app={app.id} src={`/aun-nav/icons/${app.id}.webp`} width={32} height={32} alt="" />
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
              <div role="group" aria-label={t.navigation.channelSection}>
                {backRow(t.navigation.channelSection)}
                {/* You first, as yourself (your picture and name, tagged Personal), then your channels */}
                <button type="button" onClick={() => switchToChannel(null)} data-testid="nav-channel-option-none" data-identity="personal" aria-checked={!channel} className="aun-menu-item" role="menuitemradio">
                  {avatar(getUserAvatar(), initial)}
                  {identityText(displayName, t.navigation.identityPersonal)}
                  {!channel && <Check className="aun-menu-check" aria-hidden="true" />}
                </button>
                {channelSections.map((section) => (
                  <div key={section.key} role="group" aria-labelledby={`nav-channels-${section.key}`} data-testid={`nav-channel-group-${section.key}`}>
                    <p id={`nav-channels-${section.key}`} className="aun-menu-label">
                      {section.key === 'owned' ? t.channelRoles.yourChannels : t.channelRoles.channelsYouManage}
                    </p>
                    {section.items.map((ch) => (
                      <button key={ch.id} type="button" onClick={() => switchToChannel(ch.id)} data-testid="nav-channel-option" data-identity="channel" data-channel-id={ch.id} data-role={ch.role} aria-checked={channel?.id === ch.id} className="aun-menu-item" role="menuitemradio">
                        <span className="aun-avatar-slot">
                          {avatar(ch.avatarUrl, avatarInitial(getChannelName(ch.name, ch.nameLocalized)))}
                          {ch.isMain && ch.role === 'owner' && (
                            <>
                              <Crown className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full text-brand-ink" aria-hidden="true" />
                              {/* The crown stays on the avatar (owner); screen readers hear what it means */}
                              <span className="sr-only" data-testid="nav-main-channel">{t.channel.mainChannel}</span>
                            </>
                          )}
                        </span>
                        {identityText(getChannelName(ch.name, ch.nameLocalized), t.navigation.identityChannel)}
                        {ch.role !== 'owner' && roleBadge(ch.role)}
                        {channel?.id === ch.id && <Check className="aun-menu-check" aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                ))}
                {/* Create Channel - Only for Active Account, and only with a creator tier that allows another channel */}
                {channelLimit !== null ? (
                  <p data-testid="nav-channel-limit" className="aun-menu-note" role="note">
                    {t.creator.channelLimit.replace('{max}', formatNumber(lang, channelLimit))}
                  </p>
                ) : !canCreateChannel ? null : !isCreatingChannel ? (
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
                  <div className="aun-menu-form">
                    <label className="aun-menu-label" htmlFor="nav-new-channel-name">
                      {t.navigation.channelName}
                    </label>
                    <input
                      id="nav-new-channel-name"
                      type="text"
                      value={newChannelName}
                      disabled={creatingChannel}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      placeholder={t.navigation.enterChannelName}
                      className="aun-menu-input"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateChannel();
                        }
                      }}
                    />
                    <div className="aun-menu-form-actions">
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
            {/* Error Message */}
            {error && !(channelLimit !== null && error === t.errors.failedToCreate) && (
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
        description={t.navigation.signOutOfAllDescription.replace('{count}', formatNumber(lang, accounts.length))}
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

/**
 * An email that keeps its domain when it does not fit (NAV.md): the local part shrinks with an
 * ellipsis, "@domain" stays whole, and the full address is the tooltip.
 */
function EmailText({ email, className }: { email: string; className: string }) {
  const at = email.lastIndexOf('@');
  if (at <= 0) return <span className={className} dir="ltr" title={email}>{email}</span>;
  return (
    <span className={`${className} aun-email`} dir="ltr" title={email}>
      <span className="aun-email-local">{email.slice(0, at)}</span>
      <span className="aun-email-domain">{email.slice(at)}</span>
    </span>
  );
}
