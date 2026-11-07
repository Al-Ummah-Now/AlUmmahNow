/**
 * Settings Index Page
 *
 * Main settings page that lists all available settings sections
 */

'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();

  // Redirect to login if not authenticated
  if (!user) {
    router.push(`/${lang}/`);
    return null;
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
      href: user?.channel?.id ? `/${lang}/settings/channel/${user.channel.id}` : null,
      available: !!user?.channel?.id,
    },
    {
      title: t.settings?.profileSettings || 'Profile Settings',
      description: t.settings?.profileSettingsDesc || 'Update your profile information and preferences',
      icon: User,
      href: `/${lang}/profile`,
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="h-8 w-8 text-[#ffa037]" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {t.header?.settings || 'Settings'}
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            {t.settings?.settingsDescription || 'Manage your account, channels, and preferences'}
          </p>
        </div>

        {/* Settings Sections */}
        <div className="space-y-4">
          {settingsSections.map((section) => {
            const Icon = section.icon;

            if (!section.available) {
              return (
                <div
                  key={section.title}
                  className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 opacity-50"
                >
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                      <Icon className="h-6 w-6 text-gray-400" />
                    </div>
                    <div className="flex-1">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        {section.title}
                      </h2>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {section.description}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                        {t.settings?.notAvailable || 'Not available - requires an active channel'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={section.title}
                href={section.href!}
                className="block bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 hover:border-[#ffa037] dark:hover:border-[#ffa037] transition-all hover:shadow-lg group"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-gradient-to-br from-[#ffa037] to-[#ff8c00] rounded-lg group-hover:scale-110 transition-transform">
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 group-hover:text-[#ffa037] transition-colors">
                      {section.title}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {section.description}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-[#ffa037] group-hover:translate-x-1 transition-all" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Notification categories (Story 29.10) */}
        <NotificationSettingsPanel />

        {/* Quick Actions */}
        <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                {t.settings?.needHelp || 'Need Help?'}
              </h3>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                {t.settings?.needHelpDesc || 'Visit our documentation or contact support for assistance with your settings.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
