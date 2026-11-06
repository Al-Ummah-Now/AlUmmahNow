import { Bool, DateTime, Str } from "chanfana";
import { z } from "zod";
import { VideoCategory } from "@al-ummah/shared-types";

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
    isLive: z.boolean().optional(),
    category: z.nativeEnum(VideoCategory).optional().describe("Video category (e.g., 'quran_recitation', 'hadith_studies')"),
    tags: z.array(z.string()).optional().describe("Video tags for search and categorization"),
    language: z.enum(['en', 'ar', 'ur', 'fr']).optional().describe("Primary language of the video content"),
});

export const PlaylistInput = z.object({
    title: Str({ description: "Playlist title" }),
    description: Str({ required: false, description: "Playlist description" }),
    thumbnailUrl: Str({ required: false, description: "Playlist thumbnail URL" }),
    videos: z.array(Str()).optional(), // Array of video IDs to add
    isPublic: z.boolean().optional(),
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
    isLive: z.boolean().optional(),
    category: z.nativeEnum(VideoCategory).nullable().optional().describe("Video category (e.g., 'quran_recitation', 'hadith_studies'); null clears it"),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).optional().describe("Video tags for search and categorization (replaces existing tags)"),
    language: z.enum(['en', 'ar', 'ur', 'fr']).optional().describe("Primary language of the video content"),
});

export const PlaylistUpdateInput = z.object({
    title: Str({ required: false, description: "Playlist title" }),
    description: Str({ required: false, description: "Playlist description" }),
    thumbnailUrl: Str({ required: false, description: "Playlist thumbnail URL" }),
    isPublic: z.boolean().optional(),
    videos: z.array(Str()).optional().describe("Reorder videos: the playlist's current video IDs in the new order"),
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

export const ChannelUpdateInput = z.object({
    name: Str({ required: false, description: "Channel name" }),
    nameLocalized: z.record(z.string()).optional().describe("Multi-language channel names"),
    description: Str({ required: false, description: "Channel description" }),
    descriptionLocalized: z.record(z.string()).optional().describe("Multi-language channel descriptions"),
    isMain: z.boolean().optional(),
    avatarUrl: Str({ required: false, description: "Channel avatar URL" }),
    coverUrl: Str({ required: false, description: "Channel cover image URL" }),
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