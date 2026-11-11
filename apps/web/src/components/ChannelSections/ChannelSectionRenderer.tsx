'use client';

import type { ReactNode } from 'react';
import { ChannelTileRow } from '@/components/ChannelTile';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { playlistName } from '@/lib/playlists/playlist-names';
import { useLanguage } from '@/hooks/useLanguage';
import { SectionHeader } from './SectionHeader';
import { VideoShelf } from './shelves/VideoShelf';
import { PlaylistShelf } from './shelves/PlaylistShelf';
import { LiveShelf } from './shelves/LiveShelf';
import { CommunityShelf } from './shelves/CommunityShelf';
import { SpotlightSection } from './shelves/SpotlightSection';
import { resolveSectionTitle, sectionLabelKey, type PopulatedChannelSection } from './sectionData';

interface ChannelSectionRendererProps {
  section: PopulatedChannelSection;
  channelId: string;
}

/** `data-section` kind: the themes style shelves by it (theme/pages.css) */
const SECTION_KIND: Record<PopulatedChannelSection['type'], string> = {
  channel_spotlight: 'spotlight',
  featured_videos: 'featured',
  recent_uploads: 'videos',
  popular_uploads: 'videos',
  shorts: 'shorts',
  live_streams: 'events',
  liked_videos: 'videos',
  single_playlist: 'playlist',
  multiple_playlists: 'playlists',
  created_playlists: 'playlists',
  featured_channels: 'channels',
  subscribed_channels: 'channels',
  community_posts: 'community',
};

/**
 * One Home tab section, drawn from the content the API populated. Nothing is
 * fetched here. A section without content renders nothing, for owners too:
 * the channel page looks the same to everyone (owner, 2026-11-10). The
 * section manager marks empty sections and says why.
 */
export function ChannelSectionRenderer({ section, channelId }: ChannelSectionRendererProps) {
  const { t, locale } = useLanguage();
  const content = section.populatedContent ?? {};
  const tabHref = (tab: string) => `/${locale}/channels/${channelId}?tab=${tab}`;

  const fallbackTitle =
    section.type === 'single_playlist' && content.playlist
      ? playlistName(content.playlist, locale)
      : t.channelSections.labels[sectionLabelKey(section)];
  const title = resolveSectionTitle(getLocalizedValue(section.titleLocalized, section.title, locale), fallbackTitle);

  if (section.type === 'channel_spotlight') {
    return (
      <SpotlightSection
        channelId={channelId}
        trailer={content.spotlight?.trailer}
        returning={content.spotlight?.returning}
      />
    );
  }

  let body: ReactNode = null;
  let viewAllHref: string | undefined;
  let viewAllLabel: string | undefined;

  switch (section.type) {
    case 'featured_videos':
    case 'liked_videos':
      body = content.videos?.length ? <VideoShelf videos={content.videos} /> : null;
      break;
    case 'recent_uploads':
    case 'popular_uploads':
      body = content.videos?.length ? <VideoShelf videos={content.videos} /> : null;
      viewAllHref = tabHref('videos');
      break;
    case 'shorts':
      body = content.videos?.length ? <VideoShelf videos={content.videos} shorts /> : null;
      viewAllHref = tabHref('shorts');
      break;
    case 'live_streams':
      body = content.streams?.length ? <LiveShelf streams={content.streams} channelId={channelId} /> : null;
      viewAllHref = tabHref('live');
      break;
    case 'single_playlist':
      body = content.videos?.length ? <VideoShelf videos={content.videos} /> : null;
      viewAllHref = content.playlist ? `/${locale}/playlist/${content.playlist.id}` : undefined;
      break;
    case 'multiple_playlists':
      body = content.playlists?.length ? <PlaylistShelf playlists={content.playlists} /> : null;
      break;
    case 'created_playlists':
      body = content.playlists?.length ? <PlaylistShelf playlists={content.playlists} /> : null;
      viewAllHref = tabHref('playlists');
      break;
    case 'featured_channels':
    case 'subscribed_channels':
      body = content.channels?.length ? <ChannelTileRow channels={content.channels} /> : null;
      break;
    case 'community_posts':
      body = content.posts?.length ? <CommunityShelf posts={content.posts} channelId={channelId} /> : null;
      viewAllHref = tabHref('community');
      viewAllLabel = t.channelSections.render.seeAllPosts;
      break;
  }

  // Nothing to draw: an empty section, a type this build doesn't know, or stale data
  if (!body) return null;

  return (
    <section
      data-section={SECTION_KIND[section.type] ?? 'videos'}
      data-section-type={section.type}
      data-section-id={section.id}
      data-testid={`channel-section-${section.type}`}
      className="space-y-4"
    >
      <SectionHeader title={title} viewAllHref={body ? viewAllHref : undefined} viewAllLabel={viewAllLabel} />
      {body}
    </section>
  );
}
