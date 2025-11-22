import { redirect } from 'next/navigation';
import { isChannelOwner } from '@/lib/channel-utils';
import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { getTranslations } from '@/lib/i18n';
import Link from 'next/link';
import Image from 'next/image';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';

interface ChannelSettingsPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Channel Settings Landing Page
 * Shows all available settings categories for channel owners
 */
export default async function ChannelSettingsPage({ params }: ChannelSettingsPageProps) {
  const { locale, id } = await params;

  const isOwner = await isChannelOwner(id);
  if (!isOwner) {
    redirect(`/${locale}/channels/${id}`);
  }

  const channel = await getChannelById(id);
  if (!channel) {
    notFound();
  }

  const t = getTranslations(locale as 'en' | 'ar');
  const isRTL = locale === 'ar';
  const displayName = channel.nameLocalized?.[locale] || channel.name;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="container mx-auto px-4 py-6">
          <div className={`flex items-center gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
            {/* Channel Avatar */}
            {channel.avatarUrl && (
              <div className="relative w-16 h-16 rounded-full overflow-hidden flex-shrink-0">
                <Image
                  src={channel.avatarUrl}
                  alt={displayName}
                  fill
                  className="object-cover"
                />
              </div>
            )}
            <div className={isRTL ? 'text-right' : ''}>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {t.channel.channelSettings}
              </h1>
              <p className="text-gray-600 dark:text-gray-400">{displayName}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="container mx-auto px-4 py-8">
        <ChannelSettingsBreadcrumb
          channelId={id}
          channelName={displayName}
          locale={locale}
          currentPage="overview"
          className="mb-6"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* General Settings */}
          <Link
            href={`/${locale}/settings/channel/${id}/edit`}
            className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
          >
            <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
              <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <svg
                  className="w-6 h-6 text-blue-600 dark:text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
              <div className={isRTL ? 'text-right' : ''}>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {t.channel.generalSettings}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.channel.editChannelDetails}
                </p>
              </div>
            </div>
          </Link>

          {/* Manage Videos */}
          <Link
            href={`/${locale}/settings/channel/${id}/videos`}
            className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
          >
            <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
              <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <svg
                  className="w-6 h-6 text-red-600 dark:text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div className={isRTL ? 'text-right' : ''}>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {t.video.videoManagement}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.video.manageVideosDescription || 'Manage your channel videos'}
                </p>
              </div>
            </div>
          </Link>

          {/* Channel Tabs */}
          <Link
            href={`/${locale}/settings/channel/${id}/tabs`}
            className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
          >
            <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
              <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <svg
                  className="w-6 h-6 text-purple-600 dark:text-purple-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div className={isRTL ? 'text-right' : ''}>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {t.channel.tabs?.manage_tabs || 'Manage Tabs'}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.channel.tabs?.manage_tabs_description || 'Customize channel tabs'}
                </p>
              </div>
            </div>
          </Link>

          {/* Channel Sections */}
          <Link
            href={`/${locale}/settings/channel/${id}/sections`}
            className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
          >
            <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
              <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <svg
                  className="w-6 h-6 text-green-600 dark:text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </div>
              <div className={isRTL ? 'text-right' : ''}>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {t.channel.manageSections || 'Manage Sections'}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.channel.customizeChannelLayout || 'Customize layout'}
                </p>
              </div>
            </div>
          </Link>

          {/* Community Settings */}
          <Link
            href={`/${locale}/settings/channel/${id}/community`}
            className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
          >
            <div className={`flex items-start gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
              <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <svg
                  className="w-6 h-6 text-amber-600 dark:text-amber-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <div className={isRTL ? 'text-right' : ''}>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {t.channel.communitySettings || 'Community'}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.channel.manageCommunityPosts || 'Manage posts'}
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* Back to Channel */}
        <div className="mt-8">
          <Link
            href={`/${locale}/channels/${id}`}
            className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
          >
            <svg
              className={`w-5 h-5 ${isRTL ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            {t.channel.backToChannel}
          </Link>
        </div>
      </div>
    </div>
  );
}
