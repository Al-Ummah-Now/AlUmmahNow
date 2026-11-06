'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { ChannelTab } from './index';
import { HomeTabContent } from './HomeTabContent';
import { VideosTabContent } from './VideosTabContent';
import { ShortsTabContent } from './ShortsTabContent';
import { LiveTabContent } from './LiveTabContent';
import { PlaylistsTabContent } from './PlaylistsTabContent';
import { CommunityTabContent } from './CommunityTabContent';
import { ChannelsTabContent } from './ChannelsTabContent';
import { AboutTabContent } from './AboutTabContent';

interface ChannelTabContentProps {
  channelId: string;
  defaultTab?: ChannelTab;
}

export function ChannelTabContent({
  channelId,
  defaultTab = 'home',
}: ChannelTabContentProps) {
  const searchParams = useSearchParams();

  // Get active tab from URL or use default
  const activeTab = (searchParams.get('tab') as ChannelTab) || defaultTab;

  return (
    <div className="p-5 bg-white dark:bg-gray-800">
      {/* Home Tab */}
      {activeTab === 'home' && <HomeTabContent channelId={channelId} />}

      {/* Videos Tab */}
      {activeTab === 'videos' && <VideosTabContent channelId={channelId} />}

      {/* Shorts Tab */}
      {activeTab === 'shorts' && <ShortsTabContent channelId={channelId} />}

      {/* Live Tab */}
      {activeTab === 'live' && <LiveTabContent channelId={channelId} />}

      {/* Playlists Tab */}
      {activeTab === 'playlists' && <PlaylistsTabContent channelId={channelId} />}

      {/* Community Tab */}
      {activeTab === 'community' && <CommunityTabContent channelId={channelId} />}

      {/* Channels Tab */}
      {activeTab === 'channels' && <ChannelsTabContent channelId={channelId} />}

      {/* About Tab */}
      {activeTab === 'about' && <AboutTabContent />}
    </div>
  );
}
