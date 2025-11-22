/**
 * Channel Section Content Auto-Population
 *
 * This module handles auto-population of dynamic section types:
 * - recent_uploads: Latest videos from the channel
 * - popular_uploads: Most viewed videos from the channel
 * - liked_videos: Videos liked by the channel owner
 * - subscribed_channels: Channels the user is subscribed to
 */

import R2Repository from './r2Repo';
import { Video, ChannelSection, ChannelSectionView } from '@al-ummah/shared-types';
import { logger } from './logger';

export interface SectionContent {
  videos?: Video[];
  playlists?: any[];
  channels?: any[];
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
        content.videos = await getRecentUploads(section.channelId, section.itemCount || 12, env);
        break;

      case 'popular_uploads':
        content.videos = await getPopularUploads(section.channelId, section.itemCount || 12, env);
        break;

      case 'liked_videos':
        // For now, return empty - would need likes tracking
        content.videos = await getLikedVideos(section.channelId, section.itemCount || 12, env);
        break;

      case 'subscribed_channels':
        // For now, return empty - would need subscription tracking
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

/**
 * Get recent uploads for a channel
 */
async function getRecentUploads(
  channelId: string,
  limit: number,
  env: any
): Promise<Video[]> {
  try {
    const videoRepo = new R2Repository<Video>(env.videos);

    // List all videos with prefix (in R2, they're stored flat)
    const listResult = await env.videos.list({ limit: 1000 });

    // Fetch and filter videos for this channel
    const videos: Video[] = [];
    for (const obj of listResult.objects) {
      const video = await videoRepo.getObject(obj.key);
      if (video && video.channelId === channelId && !video.isPrivate) {
        videos.push(video);
      }
    }

    // Sort by date created (newest first) and limit
    videos.sort((a, b) =>
      new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
    );

    return videos.slice(0, limit);
  } catch (error) {
    logger.error('Failed to get recent uploads', { channelId, error });
    return [];
  }
}

/**
 * Get popular uploads for a channel (sorted by view count)
 */
async function getPopularUploads(
  channelId: string,
  limit: number,
  env: any
): Promise<Video[]> {
  try {
    const videoRepo = new R2Repository<Video>(env.videos);

    // List all videos
    const listResult = await env.videos.list({ limit: 1000 });

    // Fetch and filter videos for this channel
    const videos: Video[] = [];
    for (const obj of listResult.objects) {
      const video = await videoRepo.getObject(obj.key);
      if (video && video.channelId === channelId && !video.isPrivate) {
        videos.push(video);
      }
    }

    // Sort by view count (highest first) and limit
    videos.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));

    return videos.slice(0, limit);
  } catch (error) {
    logger.error('Failed to get popular uploads', { channelId, error });
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
): Promise<Video[]> {
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
 * Get channels that the user is subscribed to
 */
async function getSubscribedChannels(
  channelId: string,
  limit: number,
  env: any
): Promise<any[]> {
  try {
    // This would need subscription tracking
    // For now, return empty array
    logger.info('Subscribed channels feature not yet implemented', { channelId });
    return [];
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
): Promise<Video[]> {
  try {
    const videoRepo = new R2Repository<Video>(env.videos);
    const videos: Video[] = [];

    for (const videoId of videoIds) {
      const video = await videoRepo.getObject(videoId);
      if (video && !video.isPrivate) {
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