/**
 * Request schemas for channel section writes (docs/specs/CHANNEL-SECTIONS.md §8).
 */
import { z } from 'zod';
import { CHANNEL_SECTION_CONSTRAINTS, CHANNEL_SECTION_TYPES } from '@al-ummah/shared-types';

export const ChannelSectionTypeSchema = z.enum(CHANNEL_SECTION_TYPES);

/** Fields shared by create and update; all optional here */
const sectionFields = {
  title: z.string().min(1).max(CHANNEL_SECTION_CONSTRAINTS.MAX_TITLE_LENGTH),
  titleLocalized: z.record(z.string()),
  style: z.enum(['horizontal_row', 'vertical_list']),
  videoIds: z.array(z.string().min(1)).max(CHANNEL_SECTION_CONSTRAINTS.MAX_VIDEO_IDS),
  playlistId: z.string().min(1),
  playlistIds: z.array(z.string().min(1)).max(CHANNEL_SECTION_CONSTRAINTS.MAX_PLAYLIST_IDS),
  channelIds: z.array(z.string().min(1)).max(CHANNEL_SECTION_CONSTRAINTS.MAX_CHANNEL_IDS),
  itemCount: z.number().int().min(CHANNEL_SECTION_CONSTRAINTS.MIN_ITEM_COUNT).max(CHANNEL_SECTION_CONSTRAINTS.MAX_ITEM_COUNT),
  trailerVideoId: z.string().min(1),
  returningVideoId: z.string().min(1),
  sort: z.enum(['latest', 'popular']),
  liveFilter: z.enum(['live_and_upcoming', 'past']),
  postMode: z.enum(['latest', 'pinned']),
  consent: z.boolean(),
  showTimestamp: z.boolean(),
  showChannelName: z.boolean(),
};

export const ChannelSectionCreateInputSchema = z.object({
  type: ChannelSectionTypeSchema,
  ...sectionFields,
}).partial().required({ type: true, title: true });

/**
 * Update: a spotlight video may be cleared with null (the other one must
 * stay); `type` can't change.
 */
export const ChannelSectionUpdateInputSchema = z.object({
  ...sectionFields,
  trailerVideoId: sectionFields.trailerVideoId.nullable(),
  returningVideoId: sectionFields.returningVideoId.nullable(),
}).partial();

/** JSON body of a rejected write: a stable code the web localizes */
export const SectionErrorSchema = z.object({
  success: z.boolean().default(false),
  code: z.string().optional(),
  error: z.string(),
  field: z.string().optional(),
});
