/**
 * Map search index payloads onto the shapes existing cards expect (Story 29.8).
 */

import type { SearchVideoPayload, VideoObject } from '@al-ummah/shared-types';

export function searchVideoToVideoObject(video: SearchVideoPayload, channelName?: string): VideoObject {
  return {
    id: video.id,
    title: video.title,
    titleLocalized: video.titleLocalized,
    description: video.description ?? null,
    thumbnailUrl: video.thumbnailUrl ?? '',
    videoUrl: '',
    userId: '',
    channelId: video.channelId,
    channel: channelName ?? video.channelName ?? '',
    channelName: channelName ?? video.channelName ?? '',
    ...(video.channelNameLocalized ? { channelNameLocalized: video.channelNameLocalized } : {}),
    channelAvatarUrl: video.channelAvatarUrl ?? '',
    duration: video.duration,
    views: video.views,
    likesCount: video.likesCount,
    dislikesCount: 0,
    commentsCount: 0,
    tags: video.tags,
    language: video.language,
    isLive: video.isLive,
    dateCreated: video.dateCreated ?? '',
    dateModified: video.dateCreated ?? '',
  } as VideoObject;
}
