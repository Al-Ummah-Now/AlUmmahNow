'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChannelTab } from './index';
import { ChannelSections } from '@/components/ChannelSections';
import { VideoGrid } from '@/components/VideoGrid';
import { PlaylistGrid } from '@/components/PlaylistGrid';
import { useLanguage } from '@/hooks/useLanguage';
import { getChannelVideos, getChannelShorts, getChannelLiveStreams, getChannelPlaylists } from '@/lib/api/channels';
import { logger } from '@/lib/logger-client';
import { VideoObject, Playlist } from '@al-ummah/shared-types';

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

  // State for videos tab
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState<string | null>(null);

  // State for shorts tab
  const [shorts, setShorts] = useState<VideoObject[]>([]);
  const [shortsLoading, setShortsLoading] = useState(false);
  const [shortsError, setShortsError] = useState<string | null>(null);

  // State for live tab
  const [liveStreams, setLiveStreams] = useState<VideoObject[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  // State for playlists tab
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);

  // Fetch videos when videos tab is active
  useEffect(() => {
    if (activeTab === 'videos' && videos.length === 0) {
      setVideosLoading(true);
      setVideosError(null);

      logger.info('Fetching channel videos', { channelId });

      getChannelVideos(channelId, { limit: 20 })
        .then((response) => {
          if (response && response.data) {
            setVideos(response.data);
            logger.info('Channel videos loaded', { count: response.data.length });
          } else {
            logger.warn('No videos response', { channelId });
          }
        })
        .catch((error) => {
          logger.error('Failed to fetch channel videos', { channelId, error });
          setVideosError(t.common.errorOccurred || 'Failed to load videos');
        })
        .finally(() => {
          setVideosLoading(false);
        });
    }
  }, [activeTab, channelId, videos.length, t]);

  // Fetch shorts when shorts tab is active
  useEffect(() => {
    if (activeTab === 'shorts' && shorts.length === 0) {
      setShortsLoading(true);
      setShortsError(null);

      logger.info('Fetching channel shorts', { channelId });

      getChannelShorts(channelId, { limit: 20 })
        .then((response) => {
          if (response && response.data) {
            setShorts(response.data);
            logger.info('Channel shorts loaded', { count: response.data.length });
          } else {
            logger.warn('No shorts response', { channelId });
          }
        })
        .catch((error) => {
          logger.error('Failed to fetch channel shorts', { channelId, error });
          setShortsError(t.common.errorOccurred || 'Failed to load shorts');
        })
        .finally(() => {
          setShortsLoading(false);
        });
    }
  }, [activeTab, channelId, shorts.length, t]);

  // Fetch live streams when live tab is active
  useEffect(() => {
    if (activeTab === 'live' && liveStreams.length === 0) {
      setLiveLoading(true);
      setLiveError(null);

      logger.info('Fetching channel live streams', { channelId });

      getChannelLiveStreams(channelId, { limit: 20 })
        .then((response) => {
          if (response && response.data) {
            setLiveStreams(response.data);
            logger.info('Channel live streams loaded', { count: response.data.length });
          } else {
            logger.warn('No live streams response', { channelId });
          }
        })
        .catch((error) => {
          logger.error('Failed to fetch channel live streams', { channelId, error });
          setLiveError(t.common.errorOccurred || 'Failed to load live streams');
        })
        .finally(() => {
          setLiveLoading(false);
        });
    }
  }, [activeTab, channelId, liveStreams.length, t]);

  // Fetch playlists when playlists tab is active
  useEffect(() => {
    if (activeTab === 'playlists' && playlists.length === 0) {
      setPlaylistsLoading(true);
      setPlaylistsError(null);

      logger.info('Fetching channel playlists', { channelId });

      getChannelPlaylists(channelId, { limit: 20 })
        .then((response) => {
          if (response && response.data) {
            setPlaylists(response.data);
            logger.info('Channel playlists loaded', { count: response.data.length });
          } else {
            logger.warn('No playlists response', { channelId });
          }
        })
        .catch((error) => {
          logger.error('Failed to fetch channel playlists', { channelId, error });
          setPlaylistsError(t.common.errorOccurred || 'Failed to load playlists');
        })
        .finally(() => {
          setPlaylistsLoading(false);
        });
    }
  }, [activeTab, channelId, playlists.length, t]);

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
          {videosError ? (
            <div className="text-center py-12 text-red-600 dark:text-red-400">
              {videosError}
            </div>
          ) : (
            <VideoGrid
              videos={videos}
              loading={videosLoading}
              emptyMessage={t.video.noVideosAvailable}
            />
          )}
        </div>
      )}

      {/* Shorts Tab */}
      {activeTab === 'shorts' && (
        <div role="tabpanel" id="tabpanel-shorts" aria-labelledby="tab-shorts">
          {shortsError ? (
            <div className="text-center py-12 text-red-600 dark:text-red-400">
              {shortsError}
            </div>
          ) : (
            <VideoGrid
              videos={shorts}
              loading={shortsLoading}
              emptyMessage={t.video.noVideosAvailable}
              columns={{ mobile: 2, tablet: 3, desktop: 4 }}
            />
          )}
        </div>
      )}

      {/* Live Tab */}
      {activeTab === 'live' && (
        <div role="tabpanel" id="tabpanel-live" aria-labelledby="tab-live">
          {liveError ? (
            <div className="text-center py-12 text-red-600 dark:text-red-400">
              {liveError}
            </div>
          ) : (
            <VideoGrid
              videos={liveStreams}
              loading={liveLoading}
              emptyMessage={t.channel.liveNowDescription}
            />
          )}
        </div>
      )}

      {/* Playlists Tab */}
      {activeTab === 'playlists' && (
        <div role="tabpanel" id="tabpanel-playlists" aria-labelledby="tab-playlists">
          {playlistsError ? (
            <div className="text-center py-12 text-red-600 dark:text-red-400">
              {playlistsError}
            </div>
          ) : (
            <PlaylistGrid
              playlists={playlists}
              loading={playlistsLoading}
              emptyMessage={t.profile.noPlaylistsAvailable}
            />
          )}
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
