import type { Channel, ChannelSection, LiveStream } from '@al-ummah/shared-types';
import { getChannelById } from '@/lib/api/channels';
import { logger } from '@/lib/logger-client';

/**
 * Public-facing channel fields needed to render a channel tile.
 * Matches both the full Channel model and the API's populated section summaries.
 */
export type ChannelSummary = Pick<
  Channel,
  | 'id'
  | 'name'
  | 'nameLocalized'
  | 'description'
  | 'descriptionLocalized'
  | 'avatarUrl'
  | 'coverUrl'
  | 'isVerified'
  | 'subscribersCount'
  | 'videosCount'
>;

/**
 * Section as returned by GET /api/channels/{id}/sections/populated.
 * The API returns the view model (content refs nested under `content`) plus
 * `populatedContent` for auto-populated section types.
 */
export type PopulatedChannelSection = ChannelSection & {
  content?: {
    videoIds?: string[];
    playlistId?: string;
    playlistIds?: string[];
    channelIds?: string[];
  };
  populatedContent?: {
    channels?: ChannelSummary[];
  };
};

/**
 * Configured channel ids of a section (flat business shape or nested view shape)
 */
export function getSectionChannelIds(section: PopulatedChannelSection): string[] {
  if (section.channelIds && section.channelIds.length > 0) {
    return section.channelIds;
  }
  return section.content?.channelIds ?? [];
}

/**
 * Channels auto-populated by the API (e.g. subscribed_channels sections)
 */
export function getSectionPopulatedChannels(section: PopulatedChannelSection): ChannelSummary[] {
  return section.populatedContent?.channels ?? [];
}

function isVisibleChannel(channel: Channel | null): channel is Channel {
  return !!channel && !channel.isDeleted && !channel.isHidden && !channel.isPrivate;
}

/**
 * Fetch channels by id (in order), skipping missing, private or moderated channels
 */
export async function fetchChannelsByIds(channelIds: string[]): Promise<ChannelSummary[]> {
  const uniqueIds = Array.from(new Set(channelIds.filter(Boolean)));

  const results = await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        return await getChannelById(id);
      } catch (error) {
        logger.warn('fetchChannelsByIds: Failed to fetch channel', { channelId: id, error });
        return null;
      }
    })
  );

  return results.filter(isVisibleChannel);
}

/**
 * Stream status values accepted by GET /api/live-streams
 */
export type LiveStreamStatusFilter = 'scheduled' | 'live' | 'ended';

/**
 * Live stream as returned by GET /api/live-streams (API view model)
 */
export interface ApiLiveStream {
  id: string;
  title: string;
  channelId: string;
  channelName?: string;
  thumbnailUrl?: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  currentViewers?: number;
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  duration?: number;
}

/**
 * GET /api/live-streams responds with `{ success, result: { data, cursor } }`;
 * older clients typed it as `{ success, data: { data } }`. Accept both.
 */
export function extractLiveStreams(response: unknown): ApiLiveStream[] {
  if (!response || typeof response !== 'object') return [];
  const body = response as {
    result?: { data?: ApiLiveStream[] };
    data?: { data?: ApiLiveStream[] } | ApiLiveStream[];
  };
  if (Array.isArray(body.result?.data)) return body.result.data;
  if (Array.isArray(body.data)) return body.data;
  if (body.data && Array.isArray(body.data.data)) return body.data.data;
  return [];
}

const FALLBACK_THUMBNAIL = '/logo.png';

function toDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Map an API live stream into the card model used by LiveStreamCard
 */
export function toLiveStreamCardModel(stream: ApiLiveStream, channelName = ''): LiveStream {
  return {
    id: stream.id,
    title: stream.title,
    thumbnailUrl: stream.thumbnailUrl || FALLBACK_THUMBNAIL,
    status: stream.status === 'cancelled' ? 'ended' : stream.status,
    viewerCount: stream.currentViewers,
    channel: {
      id: stream.channelId,
      name: stream.channelName || channelName,
    },
    startedAt: toDate(stream.actualStartTime),
    scheduledStartTime: toDate(stream.scheduledStartTime),
    endedAt: toDate(stream.actualEndTime),
    duration: stream.duration,
  };
}
