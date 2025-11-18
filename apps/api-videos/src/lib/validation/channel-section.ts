import {
  ChannelSectionCreateRequest,
  ChannelSectionType,
  CHANNEL_SECTION_CONSTRAINTS,
} from '@al-ummah/shared-types';

/**
 * Validate channel section data according to YouTube's constraints
 */
export function validateChannelSection(data: ChannelSectionCreateRequest): string[] {
  const errors: string[] = [];

  // Title validation
  if (CHANNEL_SECTION_CONSTRAINTS.TITLE_REQUIRED_FOR_TYPES.includes(data.type as any)) {
    if (!data.title) {
      errors.push(`Title is required for section type: ${data.type}`);
    } else if (data.title.length > CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH) {
      errors.push(`Title exceeds ${CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH} characters`);
    } else if (data.title.includes('<') || data.title.includes('>')) {
      errors.push('Title cannot contain < or > characters');
    }
  }

  // Playlist validation
  if (CHANNEL_SECTION_CONSTRAINTS.PLAYLISTS_REQUIRED_FOR_TYPES.includes(data.type as any)) {
    if (!data.playlists || data.playlists.length === 0) {
      errors.push(`Playlists are required for section type: ${data.type}`);
    }

    if (data.type === 'singlePlaylist' && data.playlists?.length !== CHANNEL_SECTION_CONSTRAINTS.SINGLE_PLAYLIST_EXACT_COUNT) {
      errors.push('singlePlaylist must have exactly 1 playlist');
    }
  }

  // Channel validation
  if (CHANNEL_SECTION_CONSTRAINTS.CHANNELS_REQUIRED_FOR_TYPES.includes(data.type as any)) {
    if (!data.channels || data.channels.length === 0) {
      errors.push(`Channels are required for section type: ${data.type}`);
    }
  }

  return errors;
}

/**
 * Validate title for channel sections
 */
export function validateSectionTitle(title: string | undefined, type: ChannelSectionType): string | null {
  const requiresTitle = CHANNEL_SECTION_CONSTRAINTS.TITLE_REQUIRED_FOR_TYPES.includes(type as any);

  if (requiresTitle && !title) {
    return `Title is required for section type: ${type}`;
  }

  if (title) {
    if (title.length > CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH) {
      return `Title exceeds ${CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH} characters`;
    }
    if (title.includes('<') || title.includes('>')) {
      return 'Title cannot contain < or > characters';
    }
  }

  return null;
}

/**
 * Check if section type requires playlists
 */
export function requiresPlaylists(type: ChannelSectionType): boolean {
  return CHANNEL_SECTION_CONSTRAINTS.PLAYLISTS_REQUIRED_FOR_TYPES.includes(type as any);
}

/**
 * Check if section type requires channels
 */
export function requiresChannels(type: ChannelSectionType): boolean {
  return CHANNEL_SECTION_CONSTRAINTS.CHANNELS_REQUIRED_FOR_TYPES.includes(type as any);
}

/**
 * Check if section type requires a title
 */
export function requiresTitle(type: ChannelSectionType): boolean {
  return CHANNEL_SECTION_CONSTRAINTS.TITLE_REQUIRED_FOR_TYPES.includes(type as any);
}