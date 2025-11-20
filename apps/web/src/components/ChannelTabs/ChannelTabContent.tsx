'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { ChannelTab } from './index';
import { ChannelSections } from '@/components/ChannelSections';
import { useLanguage } from '@/hooks/useLanguage';

interface ChannelTabContentProps {
  channelId: string;
  defaultTab?: ChannelTab;
}

export function ChannelTabContent({
  channelId,
  defaultTab = 'home',
}: ChannelTabContentProps) {
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  // Get active tab from URL or use default
  const activeTab = (searchParams.get('tab') as ChannelTab) || defaultTab;

  return (
    <div className="p-5 bg-white dark:bg-gray-800">
      {/* Home Tab - Channel Sections */}
      {activeTab === 'home' && (
        <div role="tabpanel" id="tabpanel-home" aria-labelledby="tab-home">
          <ChannelSections channelId={channelId} />
        </div>
      )}

      {/* Videos Tab */}
      {activeTab === 'videos' && (
        <div role="tabpanel" id="tabpanel-videos" aria-labelledby="tab-videos">
          <div className="text-center py-12">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
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
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t.channel.videos}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {t.video.noVideosAvailable}
            </p>
          </div>
        </div>
      )}

      {/* Shorts Tab */}
      {activeTab === 'shorts' && (
        <div role="tabpanel" id="tabpanel-shorts" aria-labelledby="tab-shorts">
          <div className="text-center py-12">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t.channel.shorts}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {t.video.noVideosAvailable}
            </p>
          </div>
        </div>
      )}

      {/* Live Tab */}
      {activeTab === 'live' && (
        <div role="tabpanel" id="tabpanel-live" aria-labelledby="tab-live">
          <div className="text-center py-12">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
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
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t.channel.live}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {t.channel.liveNowDescription}
            </p>
          </div>
        </div>
      )}

      {/* Playlists Tab */}
      {activeTab === 'playlists' && (
        <div role="tabpanel" id="tabpanel-playlists" aria-labelledby="tab-playlists">
          <div className="text-center py-12">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t.channel.playlists}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {t.profile.noPlaylistsAvailable}
            </p>
          </div>
        </div>
      )}

      {/* Community Tab */}
      {activeTab === 'community' && (
        <div role="tabpanel" id="tabpanel-community" aria-labelledby="tab-community">
          <div className="text-center py-12">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t.channel.community}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {t.community.noPostsYet}
            </p>
          </div>
        </div>
      )}

      {/* Channels Tab */}
      {activeTab === 'channels' && (
        <div role="tabpanel" id="tabpanel-channels" aria-labelledby="tab-channels">
          <div className="text-center py-12">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
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
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t.channel.channels}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {t.channel.featuredChannelsDescription}
            </p>
          </div>
        </div>
      )}

      {/* About Tab */}
      {activeTab === 'about' && (
        <div role="tabpanel" id="tabpanel-about" aria-labelledby="tab-about">
          <div className="max-w-4xl">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              {t.channel.about}
            </h2>
            <div className="space-y-6">
              {/* Description Section */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                  {t.channel.description}
                </h3>
                <p className="text-gray-700 dark:text-gray-300">
                  {t.channel.noDescription}
                </p>
              </div>

              {/* Statistics Section */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                  {t.channel.statistics}
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t.channel.joined}
                    </p>
                    <p className="text-gray-900 dark:text-white">-</p>
                  </div>
                </div>
              </div>

              {/* Links Section */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                  {t.channel.links}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.common.noResults}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
