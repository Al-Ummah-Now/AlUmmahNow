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
import { TabManageLink } from './TabManageLink';
import type { ChannelTabInitial } from './initial';

interface ChannelTabContentProps {
  channelId: string;
  defaultTab?: ChannelTab;
  /** The active tab's first data, read on the server (page.tsx): used only while that tab shows */
  initial?: ChannelTabInitial;
}

export function ChannelTabContent({
  channelId,
  defaultTab = 'home',
  initial,
}: ChannelTabContentProps) {
  const searchParams = useSearchParams();

  // Get active tab from URL or use default
  const activeTab = (searchParams.get('tab') as ChannelTab) || defaultTab;
  // Only the tab the server read for: a tab changed without a server round trip loads its own data
  const seed = initial?.tab === activeTab ? initial : undefined;

  return (
    <div className="p-5 bg-white dark:bg-gray-800">
      {/* Manage link for people who run the channel (nothing for visitors) */}
      <TabManageLink channelId={channelId} tab={activeTab} />

      {/* Home Tab */}
      {activeTab === 'home' && <HomeTabContent channelId={channelId} initialSections={seed?.sections} initialFallback={seed?.fallback} initialPartial={seed?.partial} />}

      {/* Videos Tab */}
      {activeTab === 'videos' && <VideosTabContent channelId={channelId} initialPage={seed?.page} />}

      {/* Shorts Tab */}
      {activeTab === 'shorts' && <ShortsTabContent channelId={channelId} initialPage={seed?.page} />}

      {/* Live Tab */}
      {activeTab === 'live' && <LiveTabContent channelId={channelId} />}

      {/* Playlists Tab */}
      {activeTab === 'playlists' && <PlaylistsTabContent channelId={channelId} />}

      {/* Community Tab */}
      {activeTab === 'community' && <CommunityTabContent channelId={channelId} />}

      {/* Channels Tab */}
      {activeTab === 'channels' && <ChannelsTabContent channelId={channelId} />}

      {/* About Tab */}
      {activeTab === 'about' && <AboutTabContent channelId={channelId} />}
    </div>
  );
}
