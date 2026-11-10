/**
 * Channel section content, populated on the server for every section type
 * (docs/specs/CHANNEL-SECTIONS.md §4, §8.3).
 *
 * Every populator returns only what anyone may see: public, ready, not
 * removed videos; public playlists; listable channels; published public
 * posts; streams without keys. Removed content is filtered here, at read
 * time, so nothing has to clean up stored section ids.
 */

import { FALLBACK_SCAN_OBJECTS } from './scanBudget';
import { subscribedChannelIds } from './subscription-store';
import R2Repository from './r2Repo';
import {
  CHANNEL_SECTION_CONSTRAINTS,
  ChannelSection,
  ChannelSectionView,
  Channel,
  CommunityPost,
  isShort,
  PostStatus,
  PostVisibility,
  Profile,
  VideoObject,
} from '@al-ummah/shared-types';
import { logger } from './logger';
import { channelVideosFromIndex } from './search/channelVideoIndex';
import { listLikedIds } from './library';
import { toPlaylistResponse } from './playlists';
import { withPlaylistCovers } from './playlistCovers';
import { withPostCounts } from './post-counters';
import { transformChannelSectionToView, transformVideoToView } from './transformations';
import { hasValidSectionConsent } from './channelSectionAccess';
import { clampItemCount, isListableChannel, isListablePlaylist, isListableVideo } from './channelSectionRules';

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
  handle?: string;
  isVerified?: boolean;
  subscribersCount: number;
  videosCount: number;
}

/** A live stream as shown in a section: no stream key, RTMP URL or reactions */
export interface SectionLiveStream {
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

/** A community post as shown on the Home tab (compact card) */
export interface CommunityPostSummary {
  id: string;
  channelId: string;
  type: string;
  content?: string;
  image?: { url: string; width: number; height: number };
  videoId?: string;
  gifUrl?: string;
  poll?: { question: string; optionsCount: number };
  likes: number;
  comments: number;
  pinned: boolean;
  createdAt: string;
}

export interface SectionContent {
  videos?: VideoObject[];
  playlist?: Record<string, unknown>;
  playlists?: Record<string, unknown>[];
  channels?: PublicChannelSummary[];
  streams?: SectionLiveStream[];
  posts?: CommunityPostSummary[];
  spotlight?: { trailer?: VideoObject; returning?: VideoObject };
}

/** Why an editor sees a section that visitors don't (spec §4, key under channelManage.sections.emptyHints) */
export type EmptyHint =
  | 'noContent'
  | 'consentMissing'
  | 'communityTabHidden'
  | 'loadFailed';

export interface PopulatedSection {
  content: SectionContent;
  isEmpty: boolean;
  emptyHint?: EmptyHint;
}

type StoredChannel = Channel & {
  subscribers?: unknown[];
  videos?: unknown[];
  isSuspended?: boolean;
  handle?: string;
};

type StoredVideo = VideoObject & { uploadStatus?: string; duration?: number; isLive?: boolean };

/** Characters of post text kept for the compact card (the card clamps to 4 lines) */
const POST_TEXT_MAX = 500;
/** Post ids read from the channel index to fill a community section */
const POST_SCAN = 50;
/** Liked ids read per section (the newest likes; non-public ones are skipped) */
const LIKED_SCAN = 50;

function toPublicChannelSummary(channel: StoredChannel): PublicChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    nameLocalized: channel.nameLocalized,
    description: channel.description,
    descriptionLocalized: channel.descriptionLocalized,
    avatarUrl: channel.avatarUrl,
    coverUrl: channel.coverUrl,
    handle: channel.handle,
    isVerified: channel.isVerified,
    subscribersCount: Array.isArray(channel.subscribers) ? channel.subscribers.length : channel.subscribersCount || 0,
    videosCount: Array.isArray(channel.videos) ? channel.videos.length : channel.videosCount || 0,
  };
}

/** Shelf view of a video: the public view without the comment list (cards only need the count) */
function toShelfVideo(video: StoredVideo, channel?: StoredChannel | null): VideoObject {
  const view = transformVideoToView(video as never, channel as never) as unknown as VideoObject & { comments?: unknown[] };
  return { ...view, comments: [] } as VideoObject;
}

/**
 * Content of one section. `channel` is the section's channel (already loaded
 * by the caller). Never throws: a failing source is logged and the section is
 * reported empty with `loadFailed`, so one section can't fail the Home tab.
 */
export async function populateSection(section: ChannelSection | ChannelSectionView, env: any, channel?: StoredChannel | null): Promise<PopulatedSection> {
  const owner = channel ?? (await new R2Repository<StoredChannel>(env.channels).getObject(section.channelId));
  try {
    if ((section.type === 'subscribed_channels' || section.type === 'liked_videos') && !hasValidSectionConsent(section as ChannelSection, owner)) {
      return { content: {}, isEmpty: true, emptyHint: 'consentMissing' };
    }
    if (section.type === 'community_posts' && !(await isCommunityTabVisible(env, section.channelId))) {
      return { content: {}, isEmpty: true, emptyHint: 'communityTabHidden' };
    }
    const content = await populateSectionContent(section, env, owner);
    const isEmpty = isSectionContentEmpty(section.type, content);
    return isEmpty ? { content, isEmpty, emptyHint: 'noContent' } : { content, isEmpty };
  } catch (error) {
    logger.error('[SectionPopulator] Section failed to populate', {
      sectionId: section.id,
      channelId: section.channelId,
      type: section.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return { content: {}, isEmpty: true, emptyHint: 'loadFailed' };
  }
}

/** True when a section has nothing a visitor could see */
export function isSectionContentEmpty(type: string, content: SectionContent): boolean {
  switch (type) {
    case 'channel_spotlight':
      return !content.spotlight?.trailer && !content.spotlight?.returning;
    case 'multiple_playlists':
    case 'created_playlists':
      return !content.playlists?.length;
    case 'single_playlist':
      return !content.playlist || !content.videos?.length;
    case 'featured_channels':
    case 'subscribed_channels':
      return !content.channels?.length;
    case 'live_streams':
      return !content.streams?.length;
    case 'community_posts':
      return !content.posts?.length;
    default:
      return !content.videos?.length;
  }
}

/**
 * Content for a section by type. Throws on a storage failure (populateSection
 * turns that into an empty section).
 */
export async function populateSectionContent(
  section: ChannelSection | ChannelSectionView,
  env: any,
  channel?: StoredChannel | null,
): Promise<SectionContent> {
  const s = section as ChannelSection & { content?: ChannelSectionView['content'] };
  const itemCount = clampItemCount(section.type as never, section.itemCount || undefined);
  const owner = channel ?? (await new R2Repository<StoredChannel>(env.channels).getObject(section.channelId));

  switch (section.type) {
    case 'channel_spotlight':
      return { spotlight: await getSpotlight(s, env, owner) };
    case 'featured_videos':
      return { videos: await getVideosByIds(s.videoIds?.length ? s.videoIds : s.content?.videoIds ?? [], env) };
    case 'recent_uploads':
      return { videos: await getChannelUploads(section.channelId, itemCount, env, 'latest', 'long', owner) };
    case 'popular_uploads':
      return { videos: await getChannelUploads(section.channelId, itemCount, env, 'popular', 'long', owner) };
    case 'shorts':
      return { videos: await getChannelUploads(section.channelId, itemCount, env, s.sort === 'popular' ? 'popular' : 'latest', 'shorts', owner) };
    case 'live_streams':
      return { streams: await getLiveStreams(section.channelId, itemCount, env, s.liveFilter === 'past' ? 'past' : 'live_and_upcoming', owner) };
    case 'liked_videos':
      return { videos: await getLikedVideos(owner, itemCount, env) };
    case 'subscribed_channels':
      return { channels: await getSubscribedChannels(section.channelId, itemCount, env, owner) };
    case 'featured_channels':
      return { channels: await getChannelsByIds(s.channelIds?.length ? s.channelIds : s.content?.channelIds ?? [], section.channelId, env) };
    case 'single_playlist':
      return getSinglePlaylist(s.playlistId || s.content?.playlistId, section.channelId, itemCount, env);
    case 'multiple_playlists':
      return { playlists: await getPlaylistsByIds(s.playlistIds?.length ? s.playlistIds : s.content?.playlistIds ?? [], section.channelId, env) };
    case 'created_playlists':
      return { playlists: await getChannelPlaylists(section.channelId, itemCount, env) };
    case 'community_posts':
      return { posts: await getCommunityPosts(section.channelId, itemCount, s.postMode === 'pinned' ? 'pinned' : 'latest', env) };
    default:
      return {};
  }
}

/** Parallel reads per batch when the index cannot answer and the bucket is scanned */
const SCAN_CONCURRENCY = 25;

/**
 * A channel's public uploads (long-form or Shorts), newest first or most
 * viewed first. Answered from the ownership index (D1); falls back to a
 * bounded bucket scan while the index is unavailable.
 */
async function getChannelUploads(
  channelId: string,
  limit: number,
  env: any,
  sort: 'latest' | 'popular',
  form: 'long' | 'shorts',
  channel?: StoredChannel | null,
): Promise<VideoObject[]> {
  const videoRepo = new R2Repository<StoredVideo>(env.videos);
  // The shared Short rule (length and shape), as the index applies it
  const isListed = (video: StoredVideo | null): video is StoredVideo =>
    !!video &&
    video.channelId === channelId &&
    isListableVideo(video) &&
    (form === 'shorts' ? !video.isLive && isShort(video) : !isShort(video) && !video.isLive);

  const indexed = await channelVideosFromIndex<StoredVideo>(env, {
    channelId,
    cursor: undefined,
    limit,
    query: { sort, privateFor: null, isPublic: true, ...(form === 'shorts' ? { shortsOnly: true } : { longFormOnly: true }) },
    load: (id) => videoRepo.getObject(id),
    // The index already applied the Short rule; re-check only visibility so the rule lives in one place
    isListed: (video): video is StoredVideo => !!video && video.channelId === channelId && isListableVideo(video),
  });
  if (indexed) return indexed.videos.map((v) => toShelfVideo(v, channel));

  logger.info('[SectionPopulator] Ownership index unavailable; scanning bucket', { channelId, sort, form });
  const listResult = await env.videos.list({ limit: FALLBACK_SCAN_OBJECTS });
  const keys: string[] = (listResult.objects || []).map((obj: { key: string }) => obj.key);
  const videos: StoredVideo[] = [];
  for (let i = 0; i < keys.length; i += SCAN_CONCURRENCY) {
    const batch = await Promise.all(keys.slice(i, i + SCAN_CONCURRENCY).map((key) => videoRepo.getObject(key)));
    videos.push(...batch.filter(isListed));
  }
  videos.sort((a, b) =>
    sort === 'popular' ? (b.views || 0) - (a.views || 0) : new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
  );
  return videos.slice(0, limit).map((v) => toShelfVideo(v, channel));
}

/** Spotlight videos: each must still be a listable video of this channel */
async function getSpotlight(section: ChannelSection, env: any, channel?: StoredChannel | null): Promise<SectionContent['spotlight']> {
  const repo = new R2Repository<StoredVideo>(env.videos);
  const load = async (id?: string) => {
    if (!id) return undefined;
    const video = await repo.getObject(id);
    return isListableVideo(video) && video.channelId === section.channelId ? toShelfVideo(video, channel) : undefined;
  };
  const [trailer, returning] = await Promise.all([load(section.trailerVideoId), load(section.returningVideoId)]);
  return { ...(trailer ? { trailer } : {}), ...(returning ? { returning } : {}) };
}

/** Videos by id in the given order; unavailable ones are skipped. Each carries its own channel's name. */
async function getVideosByIds(videoIds: string[], env: any): Promise<VideoObject[]> {
  const videoRepo = new R2Repository<StoredVideo>(env.videos);
  const channelRepo = new R2Repository<StoredChannel>(env.channels);
  const videos = (await Promise.all(videoIds.map((id) => videoRepo.getObject(id)))).filter(isListableVideo) as StoredVideo[];
  const channelIds = [...new Set(videos.map((v) => v.channelId).filter(Boolean))];
  const channels = new Map((await Promise.all(channelIds.map((id) => channelRepo.getObject(id)))).filter(Boolean).map((c) => [c!.id, c!]));
  // A video of a channel that is gone or hidden is not shown either
  return videos.filter((v) => isListableChannel(channels.get(v.channelId) as never)).map((v) => toShelfVideo(v, channels.get(v.channelId)));
}

/** The channel owner's likes, newest first, public videos only. Consent is checked by the caller. */
async function getLikedVideos(channel: StoredChannel | null | undefined, limit: number, env: any): Promise<VideoObject[]> {
  if (!channel?.userId || !env.NOTIFICATIONS_DB) return [];
  const { items } = await listLikedIds(env.NOTIFICATIONS_DB, channel.userId, { limit: LIKED_SCAN });
  const videos = await getVideosByIds(items.map((i) => i.videoId), env);
  return videos.slice(0, limit);
}

/** Hand-picked channels in order: not this channel, and only listable ones */
async function getChannelsByIds(channelIds: string[], selfId: string, env: any): Promise<PublicChannelSummary[]> {
  const repo = new R2Repository<StoredChannel>(env.channels);
  const unique = [...new Set(channelIds)].filter((id) => id && id !== selfId);
  const channels = await Promise.all(unique.map((id) => repo.getObject(id)));
  return channels.filter((c): c is StoredChannel => isListableChannel(c as never)).map(toPublicChannelSummary);
}

/**
 * The channels the channel owner is subscribed to. Shown only with the
 * owner's opt-in (checked by the caller); listable channels only.
 */
async function getSubscribedChannels(channelId: string, limit: number, env: any, channel?: StoredChannel | null): Promise<PublicChannelSummary[]> {
  if (!channel?.userId) return [];
  const profile = await new R2Repository<Profile>(env.profiles).getObject(channel.userId);
  // D1 subscriptions plus legacy entries of channels not imported yet (AV-4/AV-6)
  const subscribedTo = (await subscribedChannelIds(env.NOTIFICATIONS_DB, channel.userId, profile?.subscribedTo)).filter((id) => id !== channelId);
  const repo = new R2Repository<StoredChannel>(env.channels);
  const summaries: PublicChannelSummary[] = [];
  for (const id of subscribedTo) {
    if (summaries.length >= limit) break;
    const subscribed = await repo.getObject(id);
    if (isListableChannel(subscribed as never)) summaries.push(toPublicChannelSummary(subscribed!));
  }
  return summaries;
}

type StoredPlaylist = { id: string; channelId?: string; userId?: string; title?: string; videos?: string[]; isPublic?: boolean; isDeleted?: boolean; isHidden?: boolean; dateCreated?: string; dateModified?: string; thumbnailUrl?: string };

async function getSinglePlaylist(playlistId: string | undefined, channelId: string, limit: number, env: any): Promise<SectionContent> {
  if (!playlistId) return {};
  const playlist = await new R2Repository<StoredPlaylist>(env.playlists).getObject(playlistId);
  if (!isListablePlaylist(playlist) || playlist.channelId !== channelId) return {};
  const videos = await getVideosByIds((playlist.videos ?? []).slice(0, limit * 2), env);
  const [withCover] = await withPlaylistCovers(env, [toPlaylistResponse(playlist as never)]);
  return { playlist: withCover as unknown as Record<string, unknown>, videos: videos.slice(0, limit) };
}

async function getPlaylistsByIds(playlistIds: string[], channelId: string, env: any): Promise<Record<string, unknown>[]> {
  const repo = new R2Repository<StoredPlaylist>(env.playlists);
  const playlists = (await Promise.all([...new Set(playlistIds)].map((id) => repo.getObject(id)))).filter(
    (p): p is StoredPlaylist => isListablePlaylist(p) && p.channelId === channelId,
  );
  return (await withPlaylistCovers(env, playlists.map((p) => toPlaylistResponse(p as never)))) as unknown as Record<string, unknown>[];
}

/** The channel's public playlists, newest first (one bounded list, like the Playlists tab) */
async function getChannelPlaylists(channelId: string, limit: number, env: any): Promise<Record<string, unknown>[]> {
  const repo = new R2Repository<StoredPlaylist>(env.playlists);
  const page = await repo.listObjects(FALLBACK_SCAN_OBJECTS);
  const own = (page.items || [])
    .filter((p) => isListablePlaylist(p) && p.channelId === channelId && !(p as { systemType?: string }).systemType)
    .sort((a, b) => new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime())
    .slice(0, limit);
  return (await withPlaylistCovers(env, own.map((p) => toPlaylistResponse(p as never)))) as unknown as Record<string, unknown>[];
}

type StoredLiveStream = SectionLiveStream & { userId?: string; isPrivate?: boolean; isHidden?: boolean; dateCreated?: string };

const timeOf = (value?: string) => {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Live and upcoming (live first, then scheduled soonest) or past streams
 * (most recent first). Public, not hidden streams of this channel.
 */
async function getLiveStreams(channelId: string, limit: number, env: any, filter: 'live_and_upcoming' | 'past', channel?: StoredChannel | null): Promise<SectionLiveStream[]> {
  const listed = await env.videos.list({ prefix: 'livestream:', limit: FALLBACK_SCAN_OBJECTS });
  const repo = new R2Repository<StoredLiveStream>(env.videos);
  const streams = (await Promise.all((listed.objects || []).map((o: { key: string }) => repo.getObject(o.key)))).filter(
    (st): st is StoredLiveStream => !!st && st.channelId === channelId && !st.isPrivate && !st.isHidden,
  );
  const now = Date.now();
  const picked =
    filter === 'past'
      ? streams.filter((st) => st.status === 'ended').sort((a, b) => timeOf(b.actualEndTime || b.actualStartTime) - timeOf(a.actualEndTime || a.actualStartTime))
      : [
          ...streams.filter((st) => st.status === 'live').sort((a, b) => timeOf(b.actualStartTime) - timeOf(a.actualStartTime)),
          // A scheduled stream whose time passed long ago (never started) is not "upcoming"
          ...streams
            .filter((st) => st.status === 'scheduled' && (!st.scheduledStartTime || timeOf(st.scheduledStartTime) > now - 6 * 3600_000))
            .sort((a, b) => timeOf(a.scheduledStartTime) - timeOf(b.scheduledStartTime)),
        ];
  return picked.slice(0, limit).map((st) => ({
    id: st.id,
    title: st.title,
    channelId: st.channelId,
    channelName: channel?.name,
    thumbnailUrl: st.thumbnailUrl,
    status: st.status,
    currentViewers: st.currentViewers,
    scheduledStartTime: st.scheduledStartTime,
    actualStartTime: st.actualStartTime,
    actualEndTime: st.actualEndTime,
    duration:
      st.actualEndTime && st.actualStartTime ? Math.floor((timeOf(st.actualEndTime) - timeOf(st.actualStartTime)) / 1000) : undefined,
  }));
}

/** False when the owner hid the Community tab (the section then has nowhere to link) */
async function isCommunityTabVisible(env: any, channelId: string): Promise<boolean> {
  if (!env.channel_tabs) return true;
  const config = await new R2Repository<{ tabs?: Array<{ id: string; visible: boolean }> }>(env.channel_tabs).getObject(`channel-tabs/${channelId}`);
  const tab = config?.tabs?.find((t) => t.id === 'community');
  return tab ? tab.visible !== false : true;
}

/**
 * Published, public-visibility posts of the channel, newest first; `pinned`
 * keeps pinned posts only. Subscriber and member posts never reach Home
 * (its response is shared and cached).
 */
async function getCommunityPosts(channelId: string, limit: number, mode: 'latest' | 'pinned', env: any): Promise<CommunityPostSummary[]> {
  const bucket: R2Bucket = env.community_posts;
  if (!bucket) return [];
  const indexObj = await bucket.get(`posts/${channelId}/index.json`);
  if (!indexObj) return [];
  const index = (await indexObj.json()) as { postIds?: string[] };
  const ids = (index.postIds ?? []).slice(0, POST_SCAN);
  const loaded = await Promise.all(
    ids.map(async (id) => {
      const obj = await bucket.get(`posts/${channelId}/${id}.json`);
      return obj ? ((await obj.json()) as CommunityPost) : null;
    }),
  );
  const now = Date.now();
  const visible = loaded.filter(
    (p): p is CommunityPost =>
      !!p &&
      !p.isDeleted &&
      !p.isHidden &&
      p.status === PostStatus.PUBLISHED &&
      (p.visibility ?? PostVisibility.PUBLIC) === PostVisibility.PUBLIC &&
      (!p.scheduledAt || timeOf(p.scheduledAt) <= now) &&
      (mode === 'latest' || p.pinned === true),
  );
  visible.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
  const page = visible.slice(0, Math.min(limit, CHANNEL_SECTION_CONSTRAINTS.MAX_POST_COUNT));
  await withPostCounts(env.NOTIFICATIONS_DB, page);
  return page.map((p) => {
    const image = p.images?.[0];
    const text = p.content ?? '';
    return {
      id: p.id,
      channelId: p.channelId,
      type: p.type,
      ...(text ? { content: text.length > POST_TEXT_MAX ? `${text.slice(0, POST_TEXT_MAX)}…` : text } : {}),
      ...(image ? { image: { url: image.url, width: image.width, height: image.height } } : {}),
      ...(p.videoId ? { videoId: p.videoId } : {}),
      ...(p.gif?.url ? { gifUrl: p.gif.url } : {}),
      ...(p.poll ? { poll: { question: p.poll.question, optionsCount: p.poll.options?.length ?? 0 } } : {}),
      likes: p.likes || 0,
      comments: p.comments || 0,
      pinned: p.pinned === true,
      createdAt: p.createdAt,
    };
  });
}

/** Section view plus its populated content (GET …/sections/populated) */
export async function transformChannelSectionWithContent(
  section: ChannelSection,
  env: any,
  channel?: StoredChannel | null,
): Promise<ChannelSectionView & { populatedContent: SectionContent; isEmpty: boolean; emptyHint?: EmptyHint }> {
  const populated = await populateSection(section, env, channel);
  return {
    ...transformChannelSectionToView(section, channel),
    populatedContent: populated.content,
    isEmpty: populated.isEmpty,
    ...(populated.emptyHint ? { emptyHint: populated.emptyHint } : {}),
  };
}
