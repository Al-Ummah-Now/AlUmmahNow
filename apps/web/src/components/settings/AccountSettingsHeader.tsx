'use client';

/**
 * Identity header for account-level settings (account, profile, upload
 * defaults, privacy): who is signed in, with the settings tabs below. The page
 * keeps its own h1; the name here is identity, not the page title.
 * Signed-out visitors (privacy is open to them) see only the page.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Profile } from '@/interfaces';
import { fetchProfile } from '@/lib/api/profiles-client';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useLanguage } from '@/hooks/useLanguage';
import { SettingsTabNav, type SettingsTabItem } from '@/components/settings/SettingsTabNav';

export type AccountSettingsSection = 'account' | 'profile' | 'channel' | 'upload-defaults' | 'privacy';

export function useAccountSettingsTabs(): SettingsTabItem[] {
  const { t, lang } = useLanguage();
  const { user } = useMultiAccount();
  const channelId = user?.channel?.id;
  const items: SettingsTabItem[] = [
    { key: 'account', label: t.inlineEdit.account, href: `/${lang}/settings` },
    { key: 'profile', label: t.inlineEdit.profile, href: `/${lang}/profile/edit` },
  ];
  if (channelId) items.push({ key: 'channel', label: t.inlineEdit.channel, href: `/${lang}/settings/channel/${channelId}` });
  items.push(
    { key: 'upload-defaults', label: t.inlineEdit.uploadDefaults, href: `/${lang}/settings/upload-defaults` },
    { key: 'privacy', label: t.inlineEdit.privacy, href: `/${lang}/settings/privacy` }
  );
  return items;
}

export function AccountSettingsTabs({ current }: { current: AccountSettingsSection }) {
  return <SettingsTabNav items={useAccountSettingsTabs()} current={current} testId="account-settings-nav" />;
}

/** The signed-in user's profile, for the localized name and photo (as in the navigation) */
function useSignedInProfile(userId?: string, email?: string): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    let live = true;
    fetchProfile({ id: userId, email: email ?? '' } as Parameters<typeof fetchProfile>[0], (p: Profile) => {
      if (live) setProfile(p);
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId, email]);
  return profile;
}

export function AccountSettingsHeader({ current }: { current: AccountSettingsSection }) {
  const { user } = useMultiAccount();
  const { t, lang, dir } = useLanguage();
  // The profile page shows the full profile header itself: tabs only there
  const profile = useSignedInProfile(current === 'profile' ? undefined : user?.id, user?.email);
  if (!user) return null;
  if (current === 'profile') return <AccountSettingsTabs current={current} />;
  const localized = profile?.displayNameLocalized?.[lang as 'en' | 'ar'];
  const name = localized || profile?.displayName || user.displayName || user.email;
  const avatarUrl = profile?.avatarUrl || user.avatarUrl;

  return (
    <div data-testid="account-settings-header">
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800" dir={dir}>
        <div className="container mx-auto px-4 py-5 flex items-center gap-4">
          <div className="relative w-14 h-14 md:w-16 md:h-16 aspect-square flex-shrink-0 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-700">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="w-full h-full flex items-center justify-center text-2xl font-bold text-gray-600 dark:text-gray-300" aria-hidden="true">
                {name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg md:text-xl font-bold text-gray-900 dark:text-white truncate" data-testid="account-settings-name">{name}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 truncate" dir="ltr">{user.email}</p>
          </div>
          <Link href={`/${lang}/profile`} className="hidden sm:inline-flex items-center min-h-10 px-3 rounded-full border border-border text-sm font-medium text-foreground hover:bg-muted">
            {t.inlineEdit.viewProfile}
          </Link>
        </div>
      </div>
      <AccountSettingsTabs current={current} />
    </div>
  );
}

export default AccountSettingsHeader;
