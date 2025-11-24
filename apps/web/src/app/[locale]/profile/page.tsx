"use client";
import React from 'react';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useRouter, useParams } from 'next/navigation';
import { ChannelManagementSection } from '@/components/channelManagement';
import { useLanguage } from '@/hooks/useLanguage';

const ProfilePage = () => {
  const params = useParams();
  const locale = params.locale as string;
  const { t } = useLanguage();
  const auth = useAuth();
  const router = useRouter();
  const { profile, isLoading, error } = useProfile(auth?.user || null);

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

  return (
    <div className="profile-page flex flex-col min-h-screen bg-gray-100 dark:bg-gray-900">
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
                {/* Cover Photo */}
                <div
                  className="cover-photo h-48 bg-gray-300 dark:bg-gray-600 rounded-md overflow-hidden relative"
                  style={{
                    backgroundImage: profile?.coverUrl ? `url(${profile.coverUrl})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  {/* Edit Button - Always visible */}
                  <button
                    onClick={() => router.push(`/${locale}/profile/edit`)}
                    className="absolute top-4 right-4 inline-flex items-center gap-2 px-4 py-2 bg-white/90 dark:bg-gray-800/90 hover:bg-white dark:hover:bg-gray-800 text-gray-900 dark:text-white rounded-lg font-medium transition-colors shadow-lg"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                    {t.common.edit}
                  </button>
                </div>

                {/* Profile Photo */}
                <div
                  className="profile-photo w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-600 border-4 border-white dark:border-gray-800 absolute bottom-[-24px] left-4 overflow-hidden"
                  style={{
                    backgroundImage: profile?.avatarUrl ? `url(${profile.avatarUrl})` : `url(/avatar.png)`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              </div>
              <h1 className="text-3xl font-bold text-gray-800 dark:text-white mt-12">{`${displayFirstName} ${displayLastName}`}</h1>
            </section>

            {/* Channel Management Section */}
            <ChannelManagementSection />

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
                  onClick={() => router.push(`/${locale}/playlist/create`)}
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
                  <p className="text-gray-500 dark:text-gray-500 text-sm mb-4">
                    {t.profile.firstPlaylistMessage || 'Create your first playlist to organize your videos'}
                  </p>
                  <button
                    onClick={() => router.push(`/${locale}/playlist/create`)}
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

export default ProfilePage;
