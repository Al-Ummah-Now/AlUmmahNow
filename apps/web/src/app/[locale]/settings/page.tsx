/**
 * Settings Index Page
 *
 * The signed-in user's own settings (upload defaults, profile, privacy,
 * contact). Channel settings are not part of it: they are in Studio
 * (/studio/{channelId}/settings).
 */

'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { publicProfileTranslations } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useFeatures } from '@/hooks/useFeatures';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import Link from '@/components/common/AppLink';
import { ACCOUNT_MENU_PATHS } from '@/lib/navigation/destinations';
import { InviteWelcome } from '@/components/onboarding/InviteWelcome';
import { NotificationSettingsPanel } from '@/components/notifications/NotificationSettingsPanel';
import {
  Settings,
  Video,
  User,
  ChevronRight,
  Shield,
  Mail,
  Users,
  BadgeCheck,
  CreditCard,
  AtSign,
} from 'lucide-react';

export default function SettingsPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const { features } = useFeatures();

  if (!user) {
    return (
      <SignInPrompt
        title={t.settings?.signInTitle || t.navigation.signIn}
        message={t.settings?.signInMessage || ''}
      />
    );
  }

  // Hidden when off: Upload Defaults only for accounts that can upload
  const settingsSections = [
    features.upload && {
      title: t.settings?.uploadDefaults || 'Upload defaults',
      description: t.settings?.uploadDefaultsDesc || 'Manage video upload templates and default settings',
      icon: Video,
      href: `/${lang}/settings/upload-defaults`,
    },
    {
      title: t.settings?.profileSettings || 'Profile settings',
      description: t.settings?.profileSettingsDesc || 'Update your profile information and preferences',
      icon: User,
      href: `/${lang}/profile?from=settings`,
    },
    {
      title: publicProfileTranslations(lang).settings.cardTitle,
      description: publicProfileTranslations(lang).settings.cardDescription,
      icon: AtSign,
      href: `/${lang}/settings/public-profile`,
      available: true,
    },
    {
      title: t.privacy.settingsTitle,
      description: t.privacy.settingsDescription,
      icon: Shield,
      href: `/${lang}/settings/privacy`,
    },
    {
      title: t.channelRoles.invitationsTitle,
      description: t.channelRoles.invitationsDescription,
      icon: Users,
      href: `/${lang}${ACCOUNT_MENU_PATHS.channelInvites}`,
    },
    {
      title: t.upgrade.settingsTier.title,
      description: t.upgrade.settingsTier.description,
      icon: BadgeCheck,
      href: `/${lang}/settings/tier`,
      available: true,
    },
    // Hidden when off: Billing only while payments are on or the account has billing records
    features.billing && {
      title: t.billing.settings.title,
      description: t.billing.settings.description,
      icon: CreditCard,
      href: `/${lang}/settings/billing`,
      available: true,
    },
    {
      title: t.contact.settingsTitle,
      description: t.contact.settingsDescription,
      icon: Mail,
      href: `/${lang}/contact?from=${encodeURIComponent(`/${lang}/settings`)}`,
    },
  ].filter((section) => !!section);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <InviteWelcome variant="account" />
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="h-8 w-8 text-[var(--fanous-color-accent)]" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {t.header?.settings || 'Settings'}
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            {t.settings?.settingsDescription || 'Manage your account and preferences'}
          </p>
        </div>

        {/* Settings Sections */}
        <div className="space-y-4">
          {settingsSections.map((section) => {
            const Icon = section.icon;

            return (
              <Link
                key={section.title}
                href={section.href}
                data-testid="settings-section"
                data-available="true"
                className="block bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 hover:border-[var(--fanous-color-accent)] dark:hover:border-[var(--fanous-color-accent)] transition-all hover:shadow-lg group"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-[var(--aun-btn-filled-bg)] text-[var(--aun-btn-filled-fg)] rounded-lg">
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 group-hover:text-[var(--fanous-color-accent)] transition-colors">
                      {section.title}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {section.description}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-[var(--fanous-color-accent)] group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1 transition-all" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Notification categories (Story 29.10) */}
        <NotificationSettingsPanel />
      </div>
    </div>
  );
}
