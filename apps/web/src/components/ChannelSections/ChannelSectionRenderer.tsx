import { ChannelSection } from '@al-ummah/shared-types';
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

interface ChannelSectionRendererProps {
  section: ChannelSection;
  channelId: string;
}

export function ChannelSectionRenderer({ section, channelId }: ChannelSectionRendererProps) {
  console.log('[ChannelSectionRenderer] Rendering section:', section.type, 'ID:', section.id);

  switch (section.type) {
    case 'recentUploads':
      return <RecentUploadsSection channelId={channelId} title={section.title} />;

    case 'popularUploads':
      return <PopularUploadsSection channelId={channelId} title={section.title} />;

    case 'multiplePlaylists':
      return (
        <MultiplePlaylistsSection
          title={section.title || 'Playlists'}
          playlistIds={section.playlists || []}
        />
      );

    case 'singlePlaylist':
      return <SinglePlaylistSection playlistId={section.playlists?.[0] || ''} />;

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
          channelIds={section.channels || []}
        />
      );

    case 'subscriptions':
      return <SubscriptionsSection channelId={channelId} />;

    default:
      console.warn('[ChannelSectionRenderer] Unknown section type:', section.type);
      return null;
  }
}
