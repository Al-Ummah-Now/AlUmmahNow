"use client";
import React, { Suspense } from 'react';
import { SettingsBreadcrumb } from '@/components/settings/SettingsBreadcrumb';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useRouter, useParams } from 'next/navigation';
import { ChannelManagementSection } from '@/components/channelManagement';
import { useLanguage } from '@/hooks/useLanguage';
import { useCurrentChannel } from '@/hooks/useMultiAccount';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import type { Profile } from '@/interfaces';
import { Pencil } from 'lucide-react';
import { AvatarImage, CoverImage } from '@/components/media/ProfileImages';
import type { Channel } from '@al-ummah/shared-types';

interface ProfilePageClientProps {
  /** Loaded on the server with the page request (no client round trips) */
  initialProfile?: Profile | null;
  initialChannels?: Channel[];
}

const ProfilePageClient = ({ initialProfile, initialChannels }: ProfilePageClientProps) => {
  const params = useParams();
  const locale = params.locale as string;
  const { t } = useLanguage();
  const auth = useAuth();
  const router = useRouter();
  const { profile, isLoading, error } = useProfile(auth?.user || null, initialProfile);
  const currentChannel = useCurrentChannel();
  // Playlists belong to channels and are managed in channel settings
  const playlistsHref = currentChannel
    ? `/${locale}/settings/channel/${currentChannel.id}/playlists`
    : `/${locale}/settings`;

  // Get localized name or fall back to default
  const getLocalizedName = (
    defaultValue: string | undefined,
    localizedValues: Record<string, string> | undefined
  ): string => {
    if (localizedValues && localizedValues[locale]) {
      return localizedValues[locale];
    }
    return defaultValue || '';
  };

  const displayFirstName = getLocalizedName(profile?.firstName, profile?.firstNameLocalized);
  const displayLastName = getLocalizedName(profile?.lastName, profile?.lastNameLocalized);
  // Profiles may have only a display name (first/last are optional), so fall
  // back to it, then the email, instead of rendering an empty heading
  const displayHeading =
    `${displayFirstName} ${displayLastName}`.trim() ||
    getLocalizedName(profile?.displayName, profile?.displayNameLocalized) ||
    profile?.email ||
    auth?.user?.email ||
    '';

  // A server-loaded profile means the visitor is signed in; the client auth
  // state may simply not have loaded yet
  if (!auth?.user && !initialProfile) {
    return <SignInPrompt title={t.profile.signInTitle} message={t.profile.signInMessage} />;
  }

  return (
    <div className="profile-page flex flex-col min-h-screen bg-gray-100 dark:bg-gray-900">
      <Suspense fallback={null}>
        <SettingsBreadcrumb />
      </Suspense>
      {/* Main Content */}
      <main className="main-content flex-1 p-6">
        {isLoading ? (
          <div className="flex justify-center items-center min-h-screen">
            <div className="text-center">
              <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">{t.common.loading}</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center min-h-screen">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-600 dark:text-red-400 text-lg font-semibold">{error}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Name Section */}
            <section id="name" className="section mb-8">
              <div className="relative">
                {/* Cover Photo: an <img> over the themed placeholder (see ProfileImages) */}
                <div
                  className="cover-photo h-48 bg-gray-300 dark:bg-gray-600 rounded-md overflow-hidden relative"
                  data-testid="profile-cover"
                >
                  <CoverImage src={profile?.coverUrl} alt={t.channel.currentCover} testId="profile-cover-image" />
                  {/* The wrapper carries the position: themed buttons are position:relative */}
                  <div className="absolute top-4 end-4 z-[2]">
                    <button
                      type="button"
                      data-testid="profile-edit-button"
                      onClick={() => router.push(`/${locale}/profile/edit`)}
                      className="b b-secondary b-sm"
                    >
                      <Pencil aria-hidden="true" />
                      {t.common.edit}
                    </button>
                  </div>
                </div>

                {/* Profile Photo */}
                <div
                  className="profile-photo w-24 h-24 rounded-full border-4 border-[var(--fanous-color-surface)] bg-[var(--fanous-color-surface-raised)] shadow-lg absolute bottom-[-24px] start-4 overflow-hidden z-[3]"
                  data-testid="profile-avatar"
                >
                  <AvatarImage src={profile?.avatarUrl} alt={t.channel.currentAvatar} testId="profile-avatar-image" />
                </div>
              </div>
              <h1 data-testid="profile-heading" className="text-3xl font-bold text-gray-800 dark:text-white mt-12">{displayHeading}</h1>
            </section>

            {/* Channel Management Section */}
            <ChannelManagementSection initialChannels={initialChannels} />

            {/* Playlists Section */}
            <section id="playlists" className="section mb-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
                    {t.profile.myPlaylists || 'My Playlists'}
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mt-1">
                    {t.profile.playlistsDescription || 'Organize your favorite videos into playlists'}
                  </p>
                </div>
                <button
                  onClick={() => router.push(playlistsHref)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  {t.profile.newPlaylist || 'New Playlist'}
                </button>
              </div>

              {/* Playlists Grid - Placeholder */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Empty state */}
                <div className="col-span-full flex flex-col items-center justify-center py-12 px-4 bg-gray-50 dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
                  <svg
                    className="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="text-gray-600 dark:text-gray-400 text-lg font-medium mb-2">
                    {t.common.noResults}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                    {t.profile.firstPlaylistMessage || 'Create your first playlist to organize your videos'}
                  </p>
                  <button
                    onClick={() => router.push(playlistsHref)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    {t.common.create}
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default ProfilePageClient;
