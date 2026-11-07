/**
 * Channel Section Content Auto-Population
 *
 * This module handles auto-population of dynamic section types:
 * - recent_uploads: Latest videos from the channel
 * - popular_uploads: Most viewed videos from the channel
 * - liked_videos: Videos liked by the channel owner
 * - subscribed_channels: Public channels the channel owner is subscribed to
 */

import R2Repository from './r2Repo';
import { VideoObject, ChannelSection, ChannelSectionView, Channel, Profile } from '@al-ummah/shared-types';
import { logger } from './logger';
import { isVideoRemoved } from './visibility';
import { channelVideosFromIndex } from './search/channelVideoIndex';

/**
 * Public-safe channel summary returned in populated section content.
 * Deliberately excludes owner email, subscriber lists and other private fields.
 */
export interface PublicChannelSummary {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  isVerified?: boolean;
  subscribersCount: number;
  videosCount: number;
}

export interface SectionContent {
  videos?: VideoObject[];
  playlists?: any[];
  channels?: PublicChannelSummary[];
}

/**
 * Stored channel shape in R2 (business model carries raw relation arrays)
 */
type StoredChannel = Channel & {
  subscribers?: unknown[];
  videos?: unknown[];
};

function isPubliclyVisibleChannel(channel: StoredChannel | null): channel is StoredChannel {
  return !!channel && !channel.isDeleted && !channel.isHidden && !channel.isPrivate;
}

function toPublicChannelSummary(channel: StoredChannel): PublicChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    nameLocalized: channel.nameLocalized,
    description: channel.description,
    descriptionLocalized: channel.descriptionLocalized,
    avatarUrl: channel.avatarUrl,
    coverUrl: channel.coverUrl,
    isVerified: channel.isVerified,
    subscribersCount: Array.isArray(channel.subscribers)
      ? channel.subscribers.length
      : channel.subscribersCount || 0,
    videosCount: Array.isArray(channel.videos) ? channel.videos.length : channel.videosCount || 0,
  };
}

/**
 * Populate content for auto-populated section types
 * Returns the actual content based on section type
 */
export async function populateSectionContent(
  section: ChannelSection | ChannelSectionView,
  env: any
): Promise<SectionContent> {
  const content: SectionContent = {};

  try {
    switch (section.type) {
      case 'recent_uploads':
        content.videos = await getChannelUploads(section.channelId, section.itemCount || 12, env, 'latest');
        break;

      case 'popular_uploads':
        content.videos = await getChannelUploads(section.channelId, section.itemCount || 12, env, 'popular');
        break;

      case 'liked_videos':
        // For now, return empty - would need likes tracking
        content.videos = await getLikedVideos(section.channelId, section.itemCount || 12, env);
        break;

      case 'subscribed_channels':
        content.channels = await getSubscribedChannels(section.channelId, section.itemCount || 12, env);
        break;

      case 'featured_videos':
        // Fetch specific videos by IDs
        if ('videoIds' in section && section.videoIds && section.videoIds.length > 0) {
          content.videos = await getVideosByIds(section.videoIds, env);
        } else if ('content' in section && section.content?.videoIds) {
          content.videos = await getVideosByIds(section.content.videoIds, env);
        }
        break;

      case 'single_playlist':
        // Would fetch playlist videos
        // For now, return empty placeholder
        break;

      case 'multiple_playlists':
        // Would fetch multiple playlists
        // For now, return empty placeholder
        break;

      default:
        // No auto-population needed
        break;
    }
  } catch (error) {
    logger.error(`Failed to populate section content for type ${section.type}`, { error });
  }

  return content;
}

/** Parallel reads per batch when the index cannot answer and the bucket is scanned */
const SCAN_CONCURRENCY = 25;

/**
 * A channel's public uploads, newest first (`latest`) or most viewed first
 * (`popular`). Answered from the ownership index (D1); falls back to a bucket
 * scan, read in parallel batches, while the index is unavailable.
 */
async function getChannelUploads(
  channelId: string,
  limit: number,
  env: any,
  sort: 'latest' | 'popular'
): Promise<VideoObject[]> {
  const videoRepo = new R2Repository<VideoObject>(env.videos);
  const isListed = (video: VideoObject | null): video is VideoObject =>
    !!video && video.channelId === channelId && video.isPublic !== false && !isVideoRemoved(video);

  try {
    const indexed = await channelVideosFromIndex<VideoObject>(env, {
      channelId,
      cursor: undefined,
      limit,
      query: { sort, privateFor: null, isPublic: true },
      load: id => videoRepo.getObject(id),
      isListed,
    });
    if (indexed) return indexed.videos;

    logger.info('[SectionPopulator] Ownership index unavailable; scanning bucket', { channelId, sort });
    const listResult = await env.videos.list({ limit: 1000 });
    const keys: string[] = (listResult.objects || []).map((obj: { key: string }) => obj.key);
    const videos: VideoObject[] = [];
    for (let i = 0; i < keys.length; i += SCAN_CONCURRENCY) {
      const batch = await Promise.all(keys.slice(i, i + SCAN_CONCURRENCY).map(key => videoRepo.getObject(key)));
      videos.push(...batch.filter(isListed));
    }

    videos.sort((a, b) =>
      sort === 'popular'
        ? (b.views || 0) - (a.views || 0)
        : new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
    );
    return videos.slice(0, limit);
  } catch (error) {
    logger.error('[SectionPopulator] Failed to get channel uploads', { channelId, sort, error });
    return [];
  }
}

/**
 * Get videos liked by the channel owner
 */
async function getLikedVideos(
  channelId: string,
  limit: number,
  env: any
): Promise<VideoObject[]> {
  try {
    // This would need to track likes in a separate bucket or index
    // For now, return empty array
    logger.info('Liked videos feature not yet implemented', { channelId });
    return [];
  } catch (error) {
    logger.error('Failed to get liked videos', { channelId, error });
    return [];
  }
}

/**
 * Get the channels the channel owner is subscribed to.
 *
 * Subscriptions are only exposed because the channel owner explicitly added a
 * "subscribed_channels" section to their channel page. Only public, non-deleted,
 * non-hidden channels are returned, as public-safe summaries.
 */
async function getSubscribedChannels(
  channelId: string,
  limit: number,
  env: any
): Promise<PublicChannelSummary[]> {
  try {
    const channelRepo = new R2Repository<StoredChannel>(env.channels);
    const channel = await channelRepo.getObject(channelId);
    if (!channel?.userId) {
      return [];
    }

    const profileRepo = new R2Repository<Profile>(env.profiles);
    const profile = await profileRepo.getObject(channel.userId);
    const subscribedTo = (profile?.subscribedTo || []).filter((id) => id !== channelId);

    const summaries: PublicChannelSummary[] = [];
    for (const subscribedChannelId of subscribedTo) {
      if (summaries.length >= limit) break;
      try {
        const subscribedChannel = await channelRepo.getObject(subscribedChannelId);
        if (isPubliclyVisibleChannel(subscribedChannel)) {
          summaries.push(toPublicChannelSummary(subscribedChannel));
        }
      } catch (error) {
        logger.warn('Failed to load subscribed channel', { channelId, subscribedChannelId, error });
      }
    }

    return summaries;
  } catch (error) {
    logger.error('Failed to get subscribed channels', { channelId, error });
    return [];
  }
}

/**
 * Get specific videos by their IDs
 */
async function getVideosByIds(
  videoIds: string[],
  env: any
): Promise<VideoObject[]> {
  try {
    const videoRepo = new R2Repository<VideoObject>(env.videos);
    const videos: VideoObject[] = [];

    for (const videoId of videoIds) {
      const video = await videoRepo.getObject(videoId);
      if (video && video.isPublic && !isVideoRemoved(video)) {
        videos.push(video);
      }
    }

    return videos;
  } catch (error) {
    logger.error('Failed to get videos by IDs', { videoIds, error });
    return [];
  }
}

/**
 * Enhanced transform function that includes populated content
 */
export async function transformChannelSectionWithContent(
  section: ChannelSection,
  env: any
): Promise<ChannelSectionView & { populatedContent?: SectionContent }> {
  const view: ChannelSectionView = {
    id: section.id,
    channelId: section.channelId,
    type: section.type,
    title: section.title,
    titleLocalized: section.titleLocalized,
    position: section.position,
    style: section.style,
    itemCount: section.itemCount,
    showTimestamp: section.showTimestamp,
    showChannelName: section.showChannelName,
    content: {
      videoIds: section.videoIds && section.videoIds.length > 0 ? section.videoIds : undefined,
      playlistId: section.playlistId,
      playlistIds: section.playlistIds && section.playlistIds.length > 0 ? section.playlistIds : undefined,
      channelIds: section.channelIds && section.channelIds.length > 0 ? section.channelIds : undefined,
    },
    dateCreated: section.dateCreated,
    dateModified: section.dateModified,
  };

  // Add populated content for auto-populated types
  const AUTO_POPULATED_TYPES = ['recent_uploads', 'popular_uploads', 'liked_videos', 'subscribed_channels'];
  if (AUTO_POPULATED_TYPES.includes(section.type)) {
    const populatedContent = await populateSectionContent(section, env);
    return { ...view, populatedContent };
  }

  return view;
}