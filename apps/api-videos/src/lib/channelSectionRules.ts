/**
 * Validation of channel section writes (docs/specs/CHANNEL-SECTIONS.md §4–§6).
 *
 * Every failure carries a stable `code`; the web shows localized text for it,
 * so no raw message reaches a user.
 */
import {
  CHANNEL_SECTION_CONSTRAINTS,
  CONSENT_REQUIRED_TYPES,
  SECTION_TYPE_LIMITS,
  sectionLimitKey,
  type ChannelSection,
  type ChannelSectionCreateInput,
  type ChannelSectionType,
  type ChannelSectionUpdateInput,
} from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import { isVideoPubliclyVisible } from './visibility';
import { canGrantSectionConsent } from './channelSectionAccess';
import { isSystemPlaylist } from './library';

export type SectionErrorCode =
  | 'validation_failed'
  | 'section_limit'
  | 'section_type_limit'
  | 'owner_consent_required'
  | 'consent_required'
  | 'invalid_video'
  | 'invalid_playlist'
  | 'invalid_channel';

export interface SectionRuleError {
  status: 400 | 403 | 409;
  code: SectionErrorCode;
  error: string;
  field?: string;
}

interface StoredVideo {
  id: string;
  channelId?: string;
  isPublic?: boolean;
  isHidden?: boolean;
  isDeleted?: boolean;
  uploadStatus?: string;
}

interface StoredPlaylist {
  id: string;
  channelId?: string;
  isPublic?: boolean;
  isHidden?: boolean;
  isDeleted?: boolean;
}

export interface StoredChannelLite {
  id: string;
  userId?: string;
  isPrivate?: boolean;
  isHidden?: boolean;
  isDeleted?: boolean;
  isSuspended?: boolean;
}

export interface SectionRulesEnv {
  videos: R2Bucket;
  playlists: R2Bucket;
  channels: R2Bucket;
}

/** The shared public listing rule (public, released, ready, not removed): may be shown to anyone */
export function isListableVideo(video: StoredVideo | null | undefined): video is StoredVideo {
  return !!video && isVideoPubliclyVisible(video);
}

export function isListablePlaylist(playlist: StoredPlaylist | null | undefined): playlist is StoredPlaylist {
  // Never a system playlist (Watch later): it is the user's, not the channel's
  return !!playlist && !playlist.isDeleted && !playlist.isHidden && playlist.isPublic !== false && !isSystemPlaylist(playlist);
}

/** Not deleted, not hidden by moderation or a ban, not suspended, not private */
export function isListableChannel(channel: StoredChannelLite | null | undefined): channel is StoredChannelLite {
  return !!channel && !channel.isDeleted && !channel.isHidden && channel.isSuspended !== true && !channel.isPrivate;
}

const fail = (status: SectionRuleError['status'], code: SectionErrorCode, error: string, field?: string): SectionRuleError => ({
  status,
  code,
  error,
  ...(field ? { field } : {}),
});

type Input = ChannelSectionCreateInput | ChannelSectionUpdateInput;

/**
 * Field rules for a section of `type` after applying `input` to `current`
 * (create: no current). Checks referenced ids against storage.
 */
export async function checkSectionContent(
  env: SectionRulesEnv,
  channel: StoredChannelLite,
  type: ChannelSectionType,
  input: Input,
  current?: ChannelSection,
): Promise<SectionRuleError | null> {
  const merged = { ...(current ?? {}), ...stripUndefined(input) } as ChannelSection & Input;

  switch (type) {
    case 'channel_spotlight': {
      const ids = [merged.trailerVideoId, merged.returningVideoId].filter((id): id is string => !!id);
      if (ids.length === 0) return fail(400, 'validation_failed', 'Pick a trailer or a featured video', 'trailerVideoId');
      const repo = new R2Repository<StoredVideo>(env.videos);
      for (const id of ids) {
        const video = await repo.getObject(id);
        if (!isListableVideo(video) || video.channelId !== channel.id) {
          return fail(400, 'invalid_video', 'The spotlight video must be a public video of this channel', 'trailerVideoId');
        }
      }
      return null;
    }
    case 'featured_videos': {
      const ids = merged.videoIds ?? [];
      if (ids.length === 0) return fail(400, 'validation_failed', 'Pick at least one video', 'videoIds');
      // Only ids this write adds are checked; ones already saved may have gone private since
      // and are filtered when the section is read
      const added = ids.filter((id) => !(current?.videoIds ?? []).includes(id));
      const repo = new R2Repository<StoredVideo>(env.videos);
      for (const id of added) {
        if (!isListableVideo(await repo.getObject(id))) return fail(400, 'invalid_video', 'A picked video is not available', 'videoIds');
      }
      return null;
    }
    case 'single_playlist': {
      if (!merged.playlistId) return fail(400, 'validation_failed', 'Pick a playlist', 'playlistId');
      if (input.playlistId !== undefined) return checkOwnPlaylists(env, channel, [input.playlistId], 'playlistId');
      return null;
    }
    case 'multiple_playlists': {
      const ids = merged.playlistIds ?? [];
      if (ids.length === 0) return fail(400, 'validation_failed', 'Pick at least one playlist', 'playlistIds');
      const added = ids.filter((id) => !(current?.playlistIds ?? []).includes(id));
      return checkOwnPlaylists(env, channel, added, 'playlistIds');
    }
    case 'featured_channels': {
      const ids = merged.channelIds ?? [];
      if (ids.length === 0) return fail(400, 'validation_failed', 'Pick at least one channel', 'channelIds');
      if (ids.includes(channel.id)) return fail(400, 'invalid_channel', 'A channel cannot feature itself', 'channelIds');
      const added = ids.filter((id) => !(current?.channelIds ?? []).includes(id));
      const repo = new R2Repository<StoredChannelLite>(env.channels);
      for (const id of added) {
        if (!isListableChannel(await repo.getObject(id))) return fail(400, 'invalid_channel', 'A picked channel is not available', 'channelIds');
      }
      return null;
    }
    default:
      // Automatic types take no ids
      if ((input.videoIds?.length ?? 0) > 0 || input.playlistId || (input.playlistIds?.length ?? 0) > 0 || (input.channelIds?.length ?? 0) > 0) {
        return fail(400, 'validation_failed', `${type} sections are filled automatically`);
      }
      return null;
  }
}

async function checkOwnPlaylists(env: SectionRulesEnv, channel: StoredChannelLite, ids: string[], field: string): Promise<SectionRuleError | null> {
  const repo = new R2Repository<StoredPlaylist>(env.playlists);
  for (const id of ids) {
    const playlist = await repo.getObject(id);
    if (!isListablePlaylist(playlist) || playlist.channelId !== channel.id) {
      return fail(400, 'invalid_playlist', 'Pick a public playlist of this channel', field);
    }
  }
  return null;
}

/**
 * Consent rules (spec §6): creating needs `consent: true`; only the owner
 * creates, edits or opts in for these types.
 */
export function checkSectionConsent(
  channel: StoredChannelLite,
  userId: string,
  type: ChannelSectionType,
  input: Input,
  mode: 'create' | 'update',
): SectionRuleError | null {
  if (!CONSENT_REQUIRED_TYPES.includes(type)) return null;
  if (!canGrantSectionConsent(channel, userId)) {
    return fail(403, 'owner_consent_required', 'Only the channel owner can show their subscriptions or likes');
  }
  if (mode === 'create' && input.consent !== true) {
    return fail(400, 'consent_required', 'Confirm that visitors may see this', 'consent');
  }
  return null;
}

/** Section count and per-type limits for a new section (spec §5) */
export function checkSectionLimits(existing: Array<Pick<ChannelSection, 'type' | 'sort' | 'liveFilter'>>, next: Pick<ChannelSection, 'type' | 'sort' | 'liveFilter'>): SectionRuleError | null {
  if (existing.length >= CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL) {
    return fail(400, 'section_limit', `Up to ${CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL} sections per channel`);
  }
  const limit = SECTION_TYPE_LIMITS[next.type];
  if (limit !== undefined) {
    const key = sectionLimitKey(next);
    if (existing.filter((s) => sectionLimitKey(s) === key).length >= limit) {
      return fail(409, 'section_type_limit', 'This section is already on the channel');
    }
  }
  return null;
}

/** Item count bound by the type (community posts show at most 6) */
export function clampItemCount(type: ChannelSectionType, itemCount: number | undefined): number {
  if (type === 'community_posts') {
    return Math.min(itemCount ?? CHANNEL_SECTION_CONSTRAINTS.DEFAULT_POST_COUNT, CHANNEL_SECTION_CONSTRAINTS.MAX_POST_COUNT);
  }
  return itemCount ?? CHANNEL_SECTION_CONSTRAINTS.DEFAULT_ITEM_COUNT;
}

/** Order with the spotlight first, everything else as given (spec §5) */
export function spotlightFirst(ids: string[], spotlightIds: Set<string>): string[] {
  return [...ids.filter((id) => spotlightIds.has(id)), ...ids.filter((id) => !spotlightIds.has(id))];
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
