import { requireChannelPage } from '@/lib/channels/guard';
import { canOpenSettingsPage } from '@/lib/channels/permissions';
import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { getTranslations } from '@/lib/i18n';
import Link from 'next/link';
import Image from 'next/image';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';

// One icon tile for every card, from the theme's own tokens: an accent glyph
// on a faint accent wash with a ring, legible in every theme. Raw Tailwind
// hues (bg-indigo-100…) are remapped by themes and came out accent-on-accent.
const ICON_TILE =
  'shrink-0 p-3 rounded-lg bg-[color-mix(in_srgb,var(--fanous-color-primary)_14%,transparent)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--fanous-color-primary)_45%,transparent)]';
const ICON_GLYPH = 'w-6 h-6 text-[var(--fanous-color-primary)]';

interface ChannelSettingsPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Channel Settings Landing Page
 * Shows the settings categories the caller's channel role can use (the
 * owner sees all of them; a channel admin, editor or moderator sees theirs)
 */
export default async function ChannelSettingsPage({ params }: ChannelSettingsPageProps) {
  const { locale, id } = await params;

  const role = await requireChannelPage(locale, id, 'overview');

  const channel = await getChannelById(id);
  if (!channel) {
    notFound();
  }

  const t = getTranslations(locale as 'en' | 'ar');
  const isRTL = locale === 'ar';
  const displayName = channel.nameLocalized?.[locale] || channel.name;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="container mx-auto px-4 py-6">
          <div className={`flex items-center gap-4`}>
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
              <h1 className="text-2xl font-bold text-[var(--fanous-color-text-primary)]">
                {t.channel.channelSettings}
              </h1>
              <p className="text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">{displayName}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="container mx-auto px-4 py-8">
        <ChannelSettingsBreadcrumb
          channelId={id}
          channelName={displayName}
          channelHandle={channel.handle}
          locale={locale}
          currentPage="overview"
          className="mb-6"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* General Settings */}
          {canOpenSettingsPage(role, 'edit') && (
            <Link
              href={`/${locale}/settings/channel/${id}/edit`}
              className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className={`flex items-start gap-4`}>
                <div className={ICON_TILE}>
                  <svg
                    className={ICON_GLYPH}
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
                  <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)] mb-2">
                    {t.channel.generalSettings}
                  </h2>
                  <p className="text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">
                    {t.channel.editChannelDetails}
                  </p>
                </div>
              </div>
            </Link>
          )}

          {/* Manage Videos */}
          {canOpenSettingsPage(role, 'videos') && (
            <Link
              href={`/${locale}/settings/channel/${id}/videos`}
              className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className={`flex items-start gap-4`}>
                <div className={ICON_TILE}>
                  <svg
                    className={ICON_GLYPH}
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
                  <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)] mb-2">
                    {t.video.videoManagement}
                  </h2>
                  <p className="text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">
                    {t.video.manageVideosDescription || 'Manage your channel videos'}
                  </p>
                </div>
              </div>
            </Link>
          )}

          {/* Playlists */}
          {canOpenSettingsPage(role, 'playlists') && (
            <Link
              href={`/${locale}/settings/channel/${id}/playlists`}
              className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className={`flex items-start gap-4`}>
                <div className={ICON_TILE}>
                  <svg
                    className={ICON_GLYPH}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h12M4 10h12M4 14h8m6-2v8m-4-4h8"
                    />
                  </svg>
                </div>
                <div className={isRTL ? 'text-right' : ''}>
                  <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)] mb-2">
                    {t.playlist.managePlaylists}
                  </h2>
                  <p className="text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">
                    {t.playlist.managePlaylistsDescription}
                  </p>
                </div>
              </div>
            </Link>
          )}

          {/* Channel Tabs */}
          {canOpenSettingsPage(role, 'tabs') && (
            <Link
              href={`/${locale}/settings/channel/${id}/tabs`}
              className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className={`flex items-start gap-4`}>
                <div className={ICON_TILE}>
                  <svg
                    className={ICON_GLYPH}
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
                  <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)] mb-2">
                    {t.channel.tabs?.manage_tabs || 'Manage Tabs'}
                  </h2>
                  <p className="text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">
                    {t.channel.tabs?.manage_tabs_description || 'Customize channel tabs'}
                  </p>
                </div>
              </div>
            </Link>
          )}

          {/* Channel Sections */}
          {canOpenSettingsPage(role, 'sections') && (
            <Link
              href={`/${locale}/settings/channel/${id}/sections`}
              className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className={`flex items-start gap-4`}>
                <div className={ICON_TILE}>
                  <svg
                    className={ICON_GLYPH}
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
                  <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)] mb-2">
                    {t.channel.manageSections || 'Manage Sections'}
                  </h2>
                  <p className="text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">
                    {t.channel.customizeChannelLayout || 'Customize layout'}
                  </p>
                </div>
              </div>
            </Link>
          )}

          {/* Community Settings */}
          {canOpenSettingsPage(role, 'community') && (
            <Link
              href={`/${locale}/settings/channel/${id}/community`}
              className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
            >
              <div className={`flex items-start gap-4`}>
                <div className={ICON_TILE}>
                  <svg
                    className={ICON_GLYPH}
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
                  <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)] mb-2">
                    {t.channel.communitySettings || 'Community'}
                  </h2>
                  <p className="text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">
                    {t.channel.manageCommunityPosts || 'Manage posts'}
                  </p>
                </div>
              </div>
            </Link>
          )}

          {/* Team: channel roles (everyone with a role can open it, to see the team or leave) */}
          <Link
            href={`/${locale}/settings/channel/${id}/team`}
            data-testid="channel-settings-team"
            className="block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow"
          >
            <div className={`flex items-start gap-4`}>
              <div className={ICON_TILE}>
                <svg className={ICON_GLYPH} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div className={isRTL ? 'text-right' : ''}>
                <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)] mb-2">
                  {t.channelRoles.team}
                </h2>
                <p className="text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">
                  {role === 'owner' ? t.channelRoles.teamDescription : t.channelRoles.yourRole.replace('{role}', t.channelRoles.roles[role])}
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* Back to Channel */}
        <div className="mt-8">
          <Link
            href={`/${locale}/channels/${id}`}
            className="inline-flex items-center gap-2 text-[var(--fanous-c-link-text)] hover:underline"
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
