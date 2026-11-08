/**
 * Settings Index Page
 *
 * Main settings page that lists all available settings sections
 */

'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useCurrentChannel } from '@/hooks/useMultiAccount';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import Link from 'next/link';
import { NotificationSettingsPanel } from '@/components/notifications/NotificationSettingsPanel';
import {
  Settings,
  Video,
  Tv,
  User,
  FileText,
  ChevronRight,
  Shield,
} from 'lucide-react';

export default function SettingsPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  // The active channel lives in the multi-account session, not on the auth user
  const currentChannel = useCurrentChannel();

  if (!user) {
    return (
      <SignInPrompt
        title={t.settings?.signInTitle || t.navigation.signIn}
        message={t.settings?.signInMessage || ''}
      />
    );
  }

  const settingsSections = [
    {
      title: t.settings?.uploadDefaults || 'Upload Defaults',
      description: t.settings?.uploadDefaultsDesc || 'Manage video upload templates and default settings',
      icon: Video,
      href: `/${lang}/settings/upload-defaults`,
      available: true,
    },
    {
      title: t.settings?.channelSettings || 'Channel Settings',
      description: t.settings?.channelSettingsDesc || 'Manage your channel settings and customization',
      icon: Tv,
      href: currentChannel?.id ? `/${lang}/settings/channel/${currentChannel.id}` : null,
      available: !!currentChannel?.id,
    },
    {
      title: t.settings?.profileSettings || 'Profile Settings',
      description: t.settings?.profileSettingsDesc || 'Update your profile information and preferences',
      icon: User,
      href: `/${lang}/profile/edit`,
      available: true,
    },
    {
      title: t.privacy.settingsTitle,
      description: t.privacy.settingsDescription,
      icon: Shield,
      href: `/${lang}/settings/privacy`,
      available: true,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="container mx-auto max-w-4xl px-4 py-6 md:py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-3 text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
            <Settings className="h-7 w-7 text-[var(--inline-edit-ring)]" aria-hidden="true" />
            {t.header?.settings || 'Settings'}
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            {t.settings?.settingsDescription || 'Manage your account, channels, and preferences'}
          </p>
        </div>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-px rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-200 dark:bg-gray-800">
          {settingsSections.map((section) => {
            const Icon = section.icon;
            const body = (
              <>
                <Icon className={`h-5 w-5 shrink-0 ${section.available ? 'text-[var(--inline-edit-ring)]' : 'text-gray-400'}`} aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-gray-900 dark:text-gray-100">{section.title}</span>
                  <span className="block text-sm text-gray-600 dark:text-gray-400 mt-0.5">{section.description}</span>
                  {!section.available && (
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t.settings?.notAvailable || 'Not available - requires an active channel'}
                    </span>
                  )}
                </span>
                {section.available && <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 rtl:rotate-180 group-hover:text-[var(--inline-edit-ring)]" aria-hidden="true" />}
              </>
            );
            return (
              <li key={section.title} className="bg-white dark:bg-gray-900">
                {section.available ? (
                  <Link
                    href={section.href!}
                    data-testid="settings-section"
                    data-available="true"
                    className="group flex items-center gap-4 p-4 md:p-5 min-h-20 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  >
                    {body}
                  </Link>
                ) : (
                  <div data-testid="settings-section" data-available="false" className="flex items-center gap-4 p-4 md:p-5 min-h-20 opacity-60">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Notification categories (Story 29.10) */}
        <div id="notifications">
          <NotificationSettingsPanel />
        </div>

        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <FileText className="h-5 w-5 mt-0.5 text-gray-500" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t.settings?.needHelp || 'Need Help?'}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t.settings?.needHelpDesc || 'Visit our documentation or contact support for assistance with your settings.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
