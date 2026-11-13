import { PLAYLIST_SORT_DIRECTIONS, PLAYLIST_SORT_FIELDS, PLAYLIST_SORT_MODES } from "@al-ummah/shared-types";
import { Bool, DateTime, Str } from "chanfana";
import { z } from "zod";
import { VideoCategory, VIDEO_VISIBILITIES } from "@al-ummah/shared-types";

// Input validation schemas - only fields that users can submit

export const CommentInput = z.object({
    text: Str({ description: "Comment text content" }),
});

export const VideoInput = z.object({
    title: Str({ description: "Video title" }),
    titleLocalized: z.record(z.string()).optional().describe("Multi-language titles (e.g., {'en': 'Title', 'ar': 'العنوان'})"),
    description: Str({ required: false, description: "Video description" }),
    descriptionLocalized: z.record(z.string()).optional().describe("Multi-language descriptions"),
    thumbnailUrl: Str({ required: false, description: "Thumbnail URL" }),
    videoUrl: Str({ required: false, description: "Video file URL" }),
    width: z.number().optional(),
    height: z.number().optional(),
    availableResolutions: z.array(z.string()).optional(),
    isPublic: z.boolean().optional(),
    isUnlisted: z.boolean().optional().describe("Unlisted: not public, open to anyone with the link (never listed, noindex)"),
    visibility: z.enum(VIDEO_VISIBILITIES).optional().describe("public | unlisted | private; wins over isPublic / isUnlisted"),
    isLive: z.boolean().optional(),
    category: z.nativeEnum(VideoCategory).optional().describe("Video category (e.g., 'quran_recitation', 'hadith_studies')"),
    tags: z.array(z.string()).optional().describe("Video tags for search and categorization"),
    language: z.enum(['en', 'ar', 'ur', 'fr']).optional().describe("Primary language of the video content"),
    format: z.enum(['short', 'video', 'auto']).optional().describe("Publish as a Short or as a video; 'auto' (default) detects it"),
});

export const PlaylistInput = z.object({
    title: Str({ required: false, description: "Playlist title (the original name). May be omitted when titleLocalized has a value: then it is the English name, else the Arabic one" }),
    description: Str({ required: false, description: "Playlist description (defaults to descriptionLocalized's English, else Arabic, value)" }),
    titleLocalized: z.record(z.string()).optional().describe("Names per language: only 'en' and 'ar' are kept, trimmed, empty ones dropped (e.g. {'en': 'Lessons', 'ar': 'دروس'})"),
    descriptionLocalized: z.record(z.string()).optional().describe("Descriptions per language: only 'en' and 'ar' are kept, trimmed, empty ones dropped"),
    thumbnailUrl: Str({ required: false, description: "Playlist thumbnail URL" }),
    videos: z.array(Str()).optional().describe("Videos of the channel to add, in order (validated; above 200 the rest is added by a background job)"),
    isPublic: z.boolean().optional(),
    sortMode: z.enum(PLAYLIST_SORT_MODES).optional().describe("manual: the managers' own order; auto: by sortField and sortDirection"),
    sortField: z.enum(PLAYLIST_SORT_FIELDS).optional().describe("Automatic order field: added (to the playlist), published, title, views, duration"),
    sortDirection: z.enum(PLAYLIST_SORT_DIRECTIONS).optional().describe("Automatic order direction"),
});

export const ProfileInput = z.object({
    email: Str({ description: "User email address" }).email(),
    userName: Str({ required: false, description: "Display username" }),
    displayName: Str({ required: false, description: "Display name" }),
    displayNameLocalized: z.record(z.string()).optional().describe("Multi-language display names"),
    firstName: Str({ required: false, description: "First name" }),
    firstNameLocalized: z.record(z.string()).optional().describe("Multi-language first names"),
    lastName: Str({ required: false, description: "Last name" }),
    lastNameLocalized: z.record(z.string()).optional().describe("Multi-language last names"),
    bio: Str({ required: false, description: "User bio" }),
    bioLocalized: z.record(z.string()).optional().describe("Multi-language bios"),
    avatarUrl: Str({ required: false, description: "Profile avatar URL" }),
    coverUrl: Str({ required: false, description: "Profile cover image URL" }),
    timezone: Str({ required: false, description: "User timezone (IANA format, e.g., 'America/New_York', 'Asia/Dubai')" }),
});

export const ChannelInput = z.object({
    name: Str({ description: "Channel name" }),
    nameLocalized: z.record(z.string()).optional().describe("Multi-language channel names"),
    description: Str({ required: false, description: "Channel description" }),
    descriptionLocalized: z.record(z.string()).optional().describe("Multi-language channel descriptions"),
    isMain: Bool().optional(),
    avatarUrl: Str({ required: false, description: "Channel avatar URL" }),
    coverUrl: Str({ required: false, description: "Channel cover image URL" }),
});

// Update operations (for PATCH endpoints) - defined explicitly to preserve OpenAPI metadata
export const VideoUpdateInput = z.object({
    title: Str({ required: false, description: "Video title" }),
    titleLocalized: z.record(z.string()).optional().describe("Multi-language titles (e.g., {'en': 'Title', 'ar': 'العنوان'})"),
    description: Str({ required: false, description: "Video description" }),
    descriptionLocalized: z.record(z.string()).optional().describe("Multi-language descriptions"),
    thumbnailUrl: Str({ required: false, description: "Thumbnail URL" }),
    videoUrl: Str({ required: false, description: "Video file URL" }),
    width: z.number().optional(),
    height: z.number().optional(),
    availableResolutions: z.array(z.string()).optional(),
    isPublic: z.boolean().optional(),
    isUnlisted: z.boolean().optional().describe("Unlisted: not public, open to anyone with the link (never listed, noindex)"),
    visibility: z.enum(VIDEO_VISIBILITIES).optional().describe("public | unlisted | private; wins over isPublic / isUnlisted"),
    isLive: z.boolean().optional(),
    category: z.nativeEnum(VideoCategory).nullable().optional().describe("Video category (e.g., 'quran_recitation', 'hadith_studies'); null clears it"),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).optional().describe("Video tags for search and categorization (replaces existing tags)"),
    language: z.enum(['en', 'ar', 'ur', 'fr']).optional().describe("Primary language of the video content"),
    commentSettings: z.enum(['on', 'held', 'off']).optional().describe("Comments: on, held for the owner's review, or off"),
    format: z.enum(['short', 'video', 'auto']).optional().describe("Publish as a Short or as a video; 'auto' detects it (≤ 3 min and vertical or square = Short)"),
});

export const PlaylistUpdateInput = z.object({
    title: Str({ required: false, description: "Playlist title" }),
    description: Str({ required: false, description: "Playlist description" }),
    titleLocalized: z.record(z.string()).optional().describe("Names per language: only 'en' and 'ar' are kept, trimmed, empty ones dropped; replaces the stored map ({} clears it) (e.g. {'en': 'Lessons', 'ar': 'دروس'})"),
    descriptionLocalized: z.record(z.string()).optional().describe("Descriptions per language: only 'en' and 'ar' are kept, trimmed, empty ones dropped; replaces the stored map ({} clears it)"),
    thumbnailUrl: Str({ required: false, description: "Playlist thumbnail URL" }),
    isPublic: z.boolean().optional(),
    videos: z.array(Str()).optional().describe("Reorder videos: the playlist's current video IDs in the new order (manual order only)"),
    sortMode: z.enum(PLAYLIST_SORT_MODES).optional().describe("manual: the managers' own order; auto: by sortField and sortDirection"),
    sortField: z.enum(PLAYLIST_SORT_FIELDS).optional().describe("Automatic order field: added (to the playlist), published, title, views, duration"),
    sortDirection: z.enum(PLAYLIST_SORT_DIRECTIONS).optional().describe("Automatic order direction"),
    coverVideoId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable().optional().describe("Cover: a video of the playlist whose thumbnail is shown first (falls back to the first visible video); null goes back to automatic"),
});

export const ProfileUpdateInput = z.object({
    email: Str({ required: false, description: "User email address" }),
    userName: Str({ required: false, description: "Display username" }),
    displayName: Str({ required: false, description: "Display name" }),
    displayNameLocalized: z.record(z.string()).optional().describe("Multi-language display names"),
    firstName: Str({ required: false, description: "First name" }),
    firstNameLocalized: z.record(z.string()).optional().describe("Multi-language first names"),
    lastName: Str({ required: false, description: "Last name" }),
    lastNameLocalized: z.record(z.string()).optional().describe("Multi-language last names"),
    bio: Str({ required: false, description: "User bio" }),
    bioLocalized: z.record(z.string()).optional().describe("Multi-language bios"),
    avatarUrl: Str({ required: false, description: "Profile avatar URL" }),
    coverUrl: Str({ required: false, description: "Profile cover image URL" }),
    timezone: Str({ required: false, description: "User timezone (IANA format, e.g., 'America/New_York', 'Asia/Dubai')" }),
});

/** About-tab link: http(s) URL only (rendered with rel="nofollow noopener noreferrer ugc") */
export const ChannelLinkInput = z.object({
    title: z.string().trim().min(1).max(50),
    url: z.string().trim().max(500).url().refine((u) => /^https?:\/\//i.test(u), { message: "Only http(s) links are allowed" }),
});

export const MAX_CHANNEL_LINKS = 10;

export const ChannelUpdateInput = z.object({
    name: Str({ required: false, description: "Channel name" }),
    nameLocalized: z.record(z.string()).optional().describe("Multi-language channel names"),
    description: Str({ required: false, description: "Channel description" }),
    descriptionLocalized: z.record(z.string()).optional().describe("Multi-language channel descriptions"),
    isMain: z.boolean().optional(),
    avatarUrl: Str({ required: false, description: "Channel avatar URL" }),
    coverUrl: Str({ required: false, description: "Channel cover image URL" }),
    handle: z.string().trim().max(31).optional().describe("Claim/change the channel @handle (3-30 chars: letters, digits, . _ -)"),
    links: z.array(ChannelLinkInput).max(MAX_CHANNEL_LINKS).optional().describe("About links (replaces the list)"),
    contactEmail: z.union([z.literal(''), z.string().trim().email().max(254)]).optional().describe("Public contact email; empty string clears it"),
    location: z.string().trim().max(100).optional().describe("Location shown on the About tab; empty string clears it"),
});

export const CommentUpdateInput = z.object({
    text: Str({ required: false, description: "Updated comment text" }),
    isPinned: z.boolean().optional(),
});

// Phase 2: Live Streaming input schemas
export const LiveStreamInput = z.object({
    title: Str({ description: "Live stream title" }),
    description: Str({ required: false, description: "Live stream description" }),
    scheduledStartTime: z.string().optional().describe("ISO 8601 scheduled start time"),
    isPrivate: z.boolean().optional(),
    allowChat: z.boolean().optional(),
    maxViewers: z.number().optional(),
    tags: z.array(z.string()).optional(),
});

export const LiveStreamUpdateInput = z.object({
    title: Str({ required: false, description: "Live stream title" }),
    description: Str({ required: false, description: "Live stream description" }),
    scheduledStartTime: z.string().optional().describe("ISO 8601 scheduled start time"),
    isPrivate: z.boolean().optional(),
    allowChat: z.boolean().optional(),
    maxViewers: z.number().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(['scheduled', 'live', 'ended', 'cancelled']).optional(),
});

// Phase 2: Content Moderation input schemas
export const ReportInput = z.object({
    entityType: z.enum(['video', 'comment', 'channel', 'livestream']),
    entityId: Str({ description: "ID of the entity being reported" }),
    reason: z.enum(['inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other']),
    description: Str({ required: false, description: "Additional details about the report" }),
});

export const ModerationActionInput = z.object({
    action: z.enum(['approve', 'remove', 'flag', 'escalate', 'dismiss']),
    reason: Str({ required: false, description: "Reason for the moderation action" }),
    notes: Str({ required: false, description: "Internal moderation notes" }),
});

// Phase 2: Analytics input schemas  
export const AnalyticsQueryInput = z.object({
    entityType: z.enum(['video', 'channel', 'playlist', 'livestream']).optional(),
    entityId: Str({ required: false, description: "Specific entity ID to analyze" }),
    startDate: z.string().optional().describe("ISO 8601 start date for analytics range"),
    endDate: z.string().optional().describe("ISO 8601 end date for analytics range"),
    metrics: z.array(z.enum(['views', 'likes', 'comments', 'shares', 'watch_time', 'engagement_rate'])).optional(),
    granularity: z.enum(['hour', 'day', 'week', 'month']).optional(),
});

// Legacy exports for backwards compatibility (will be removed when endpoints are updated)
export const Comment = CommentInput;
export const Video = VideoInput;
export const Playlist = PlaylistInput;
export const Profile = ProfileInput;
export const Channel = ChannelInput;