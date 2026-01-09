import { ChannelSection, ChannelSectionType } from '@al-ummah/shared-types';
import { FeaturedVideosSection } from './types/FeaturedVideosSection';
import { LikedVideosSection } from './types/LikedVideosSection';
import { RecentUploadsSection } from './types/RecentUploadsSection';
import { PopularUploadsSection } from './types/PopularUploadsSection';
import { MultiplePlaylistsSection } from './types/MultiplePlaylistsSection';
import { SinglePlaylistSection } from './types/SinglePlaylistSection';
import { AllPlaylistsSection } from './types/AllPlaylistsSection';
import { LiveEventsSection } from './types/LiveEventsSection';
import { CompletedEventsSection } from './types/CompletedEventsSection';
import { UpcomingEventsSection } from './types/UpcomingEventsSection';
import { MultipleChannelsSection } from './types/MultipleChannelsSection';
import { SubscriptionsSection } from './types/SubscriptionsSection';
import { logger } from '@/lib/logger-client';

interface ChannelSectionRendererProps {
  section: ChannelSection;
  channelId: string;
}

/**
 * Map backend snake_case types to frontend component types
 * Backend: featured_videos, recent_uploads, etc.
 * Frontend: featuredVideos, recentUploads, etc.
 */
function normalizeType(backendType: ChannelSectionType | string): string {
  const typeMap: Record<string, string> = {
    featured_videos: 'featuredVideos',
    recent_uploads: 'recentUploads',
    popular_uploads: 'popularUploads',
    single_playlist: 'singlePlaylist',
    multiple_playlists: 'multiplePlaylists',
    subscribed_channels: 'subscriptions',
    liked_videos: 'likedVideos',
  };

  return typeMap[backendType] || backendType;
}

export function ChannelSectionRenderer({ section, channelId }: ChannelSectionRendererProps) {
  const normalizedType = normalizeType(section.type);
  logger.info('ChannelSectionRenderer: Rendering section', {
    originalType: section.type,
    normalizedType,
    sectionId: section.id,
    channelId
  });

  switch (normalizedType) {
    case 'featuredVideos':
      return (
        <FeaturedVideosSection
          videoIds={section.videoIds || []}
          title={section.title}
          channelId={channelId}
        />
      );

    case 'recentUploads':
      return <RecentUploadsSection channelId={channelId} title={section.title} />;

    case 'popularUploads':
      return <PopularUploadsSection channelId={channelId} title={section.title} />;

    case 'multiplePlaylists':
      return (
        <MultiplePlaylistsSection
          title={section.title || 'Playlists'}
          playlistIds={section.playlistIds || []}
        />
      );

    case 'singlePlaylist':
      return <SinglePlaylistSection playlistId={section.playlistIds?.[0] || ''} />;

    case 'allPlaylists':
      return <AllPlaylistsSection channelId={channelId} />;

    case 'liveEvents':
      return <LiveEventsSection channelId={channelId} />;

    case 'completedEvents':
      return <CompletedEventsSection channelId={channelId} />;

    case 'upcomingEvents':
      return <UpcomingEventsSection channelId={channelId} />;

    case 'multipleChannels':
      return (
        <MultipleChannelsSection
          title={section.title || 'Featured Channels'}
          channelIds={section.channelIds || []}
        />
      );

    case 'subscriptions':
      return <SubscriptionsSection channelId={channelId} />;

    case 'likedVideos':
      return <LikedVideosSection channelId={channelId} title={section.title} />;

    default:
      logger.warn('ChannelSectionRenderer: Unknown section type', {
        sectionType: section.type,
        sectionId: section.id,
        channelId
      });
      return null;
  }
}
