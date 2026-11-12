import { Bool, DateTime, Str } from "chanfana";
import { z } from "zod";

// Response/view schemas - define what gets returned to clients
// These include computed fields and formatted data for API responses

// Common fields for soft delete
const SoftDeleteFields = {
    isDeleted: z.boolean().optional(),
    deletedAt: DateTime().optional(),
    markedForDeletion: z.boolean().optional(),
    markedForDeletionAt: DateTime().optional(),
};

// Common fields for moderation
const ModerationFields = {
    isHidden: z.boolean().optional(),
    hiddenAt: DateTime().optional(),
    hiddenByUserId: Str().optional(),
    hiddenReason: Str().optional(),
};

export const LikeView = z.object({
    id: Str(),
    userId: Str(),
    channelId: Str(),
    entityId: Str(),
    dateCreated: DateTime(),
});

export const DislikeView = z.object({
    id: Str(),
    userId: Str(),
    channelId: Str(),
    entityId: Str(),
    dateCreated: DateTime(),
});

export const SubscriptionView = z.object({
    id: Str(),
    userId: Str(),
    channelId: Str(),
    entityId: Str(),
    dateCreated: DateTime(),
});

// Comment view with computed counts instead of full arrays
export const CommentView = z.object({
    id: Str(),
    userId: Str(),
    channelId: Str(),
    videoId: Str(),
    text: Str(),
    dateCreated: DateTime(),
    dateModified: DateTime().optional(),
    likesCount: z.number(),
    dislikesCount: z.number().describe("Always 0: comment dislikes are hidden and not accepted since 2026-11-12 (kept for older clients)"),
    repliesCount: z.number(),
    isEdited: z.boolean(),
    isPinned: z.boolean(),
    ...SoftDeleteFields,
    ...ModerationFields,
    // Note: replies array removed to avoid circular reference
    // Use separate endpoint to get comment replies if needed
});

// Video view with computed counts and denormalized channel info
export const VideoView = z.object({
    id: Str(),
    title: Str(),
    description: Str().optional(),
    thumbnailUrl: Str().optional(),
    videoUrl: Str().optional(),
    playUrl: Str().optional(), // HLS streaming URL from Bunny.net
    userId: Str(),
    channelId: Str(),
    channelName: Str(), // Denormalized for client convenience
    channelAvatarUrl: Str().optional(), // Denormalized for client convenience
    channelCoverUrl: Str().optional(), // Denormalized for client convenience
    channelIsVerified: z.boolean().optional(), // Scholar/institution badge (Epic 6.1)
    dateCreated: DateTime(),
    dateModified: DateTime(),
    views: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    availableResolutions: z.array(z.string()),
    likesCount: z.number(),
    dislikesCount: z.number().describe("Always 0: dislikes are hidden and not accepted since 2026-11-11 (kept for older clients)"),
    commentsCount: z.number(),
    commentSettings: z.enum(["on", "held", "off"]).optional().describe("Comments: on, held for review, off"),
    isPublic: z.boolean(),
    isLive: z.boolean(),
    titleLocalized: z.record(z.string()).optional(),
    descriptionLocalized: z.record(z.string()).optional(),
    thumbnailType: z.enum(['auto', 'custom']).optional(),
    thumbnailSizes: z.record(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    category: z.string().optional(),
    categorySource: z.enum(['uploader', 'ai', 'admin']).optional().describe("Who set the category; 'ai' = an AI suggestion the owner has not confirmed"),
    language: z.string().optional(),
    duration: z.number().optional(),
    // Upload processing: anything but "ready" shows the "Processing, ready soon" state
    uploadStatus: z.enum(['initiated', 'uploading', 'processing', 'ready', 'failed']).optional(),
    processingIssueKind: z.enum(['encode_failed', 'needs_reupload', 'stalled']).optional().describe("Why processing did not finish"),
    format: z.enum(['short', 'video']).optional().describe("Uploader's choice of Short or video; absent = detected"),
    isShort: z.boolean().optional().describe("Short (≤ 3 min and vertical or square, or chosen by the uploader); shared rule"),
    ...SoftDeleteFields,
    ...ModerationFields,
    // For detailed views, include recent comments
    comments: z.array(CommentView).optional(),
});

// Playlist view with computed counts
export const PlaylistView = z.object({
    id: Str(),
    title: Str(),
    description: Str().optional(),
    thumbnailUrl: Str().optional(),
    userId: Str(),
    channelId: Str(),
    channelName: Str(), // Denormalized for client convenience
    dateCreated: DateTime(),
    dateModified: DateTime(),
    videosCount: z.number(),
    isPublic: z.boolean(),
    name: Str().optional(), // Alias of title (shared-types Playlist uses `name`)
    // Derived at read time when there is no custom thumbnailUrl (lib/playlistCovers.ts)
    cover: z.object({ videoId: Str(), thumbnailUrl: Str() }).optional(),
    videos: z.array(Str()).optional(), // Ordered video IDs
    ...SoftDeleteFields,
    ...ModerationFields,
    // Note: video objects are not embedded; use GET /api/playlists/:id?includeVideos=true
    // Use separate endpoint to get playlist videos if needed
});

// Profile view with computed counts
export const ProfileView = z.object({
    id: Str(),
    email: Str().email(),
    userName: Str().optional(),
    firstName: Str().optional(),
    firstNameLocalized: z.record(z.string()).optional().describe("Multi-language first names"),
    lastName: Str().optional(),
    lastNameLocalized: z.record(z.string()).optional().describe("Multi-language last names"),
    displayName: Str().optional(), // Computed field (firstName + lastName or userName)
    displayNameLocalized: z.record(z.string()).optional().describe("Multi-language display names"),
    bio: Str().optional(),
    bioLocalized: z.record(z.string()).optional().describe("Multi-language bios"),
    avatarUrl: Str().optional(),
    coverUrl: Str().optional(),
    timezone: Str().optional().describe("User timezone (IANA format, e.g., 'America/New_York', 'Asia/Dubai')"),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    channelsCount: z.number(),
    // For detailed views, include channel info
    channels: z.array(z.object({
        id: Str(),
        name: Str(),
        isMain: z.boolean(),
        avatarUrl: Str().optional(),
    })).optional(),
});

// Fields returned for a profile to anyone (see lib/public-views.ts)
export const PublicProfileView = z.object({
    id: Str(),
    userName: Str().optional(),
    displayName: Str().optional(),
    displayNameLocalized: z.record(z.string()).optional(),
    bio: Str().optional(),
    bioLocalized: z.record(z.string()).optional(),
    avatarUrl: Str().optional(),
    coverUrl: Str().optional(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    channelsCount: z.number(),
});

// Fields returned for a channel to anyone (see lib/public-views.ts)
export const PublicChannelView = z.object({
    id: Str(),
    /** Set only on the owner's own suspended channel (admin suspension). */
    isSuspended: z.boolean().optional(),
    suspension: z.object({ at: z.string(), reason: z.string().optional() }).optional(),
    userId: Str(),
    name: Str(),
    nameLocalized: z.record(z.string()).optional(),
    description: Str().optional(),
    descriptionLocalized: z.record(z.string()).optional(),
    isMain: z.boolean(),
    isPrivate: z.boolean().optional(),
    isVerified: z.boolean().optional(),
    avatarUrl: Str().optional(),
    coverUrl: Str().optional(),
    handle: Str().optional().describe("Unique @handle (display casing)"),
    links: z.array(z.object({ title: Str(), url: Str() })).optional(),
    location: Str().optional(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    playlistsCount: z.number(),
    videosCount: z.number(),
    subscribersCount: z.number(),
    subscriptionsCount: z.number(),
    likesCount: z.number(),
});

// Channel view with computed counts and stats (owner/admin routes only)
export const ChannelView = z.object({
    id: Str(),
    userId: Str(),
    email: Str().email(),
    name: Str(),
    isMain: z.boolean(),
    isPrivate: z.boolean().optional(), // User-controlled privacy
    avatarUrl: Str().optional(),
    coverUrl: Str().optional(),
    handle: Str().optional().describe("Unique @handle (display casing)"),
    links: z.array(z.object({ title: Str(), url: Str() })).optional(),
    contactEmail: Str().optional(),
    location: Str().optional(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    playlistsCount: z.number(),
    videosCount: z.number(),
    subscribersCount: z.number(),
    subscriptionsCount: z.number(),
    likesCount: z.number(),
    ...SoftDeleteFields,
    ...ModerationFields,
    // Note: recent content arrays removed to avoid circular reference
    // Use separate endpoints to get recent videos/playlists if needed
});

// Legacy exports for backwards compatibility (will be removed when endpoints are updated)
export const Like = LikeView;
export const Dislike = DislikeView;
export const Comment = CommentView;
export const Video = VideoView;
export const Playlist = PlaylistView;
export const Profile = ProfileView;
export const Channel = ChannelView;
export const Subscription = SubscriptionView;

// Phase 2: Live Streaming view models
export const LiveStreamView = z.object({
    id: Str(),
    title: Str(),
    description: Str().optional(),
    userId: Str(),
    channelId: Str(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    scheduledStartTime: DateTime().optional(),
    actualStartTime: DateTime().optional(),
    actualEndTime: DateTime().optional(),
    status: z.enum(['scheduled', 'live', 'ended', 'cancelled']),
    isPrivate: z.boolean(),
    allowChat: z.boolean(),
    maxViewers: z.number().optional(),
    currentViewers: z.number(),
    peakViewers: z.number(),
    tags: z.array(z.string()),
    thumbnailUrl: Str().optional(),
    streamUrl: Str().optional(),
    views: z.number(),
    likesCount: z.number(),
    dislikesCount: z.number().describe("Always 0: dislikes are hidden and not accepted since 2026-11-11 (kept for older clients)"),
    commentsCount: z.number(),
    duration: z.number().optional().describe("Stream duration in seconds"),
    ...SoftDeleteFields,
    ...ModerationFields,
});

// Phase 2: Content Moderation view models
export const ReportView = z.object({
    id: Str(),
    entityType: z.enum(['video', 'comment', 'channel', 'livestream']),
    entityId: Str(),
    reporterId: Str(),
    reporterChannelId: Str(),
    reason: z.enum(['inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other']),
    description: Str().optional(),
    status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed']),
    dateCreated: DateTime(),
    dateResolved: DateTime().optional(),
    moderatorId: Str().optional(),
    moderatorAction: z.enum(['approve', 'remove', 'flag', 'escalate', 'dismiss']).optional(),
});

// Phase 2: Analytics view models
export const AnalyticsDataView = z.object({
    metric: z.string(),
    value: z.number(),
    timestamp: DateTime(),
    metadata: z.record(z.any()).optional(),
});

export const AnalyticsSummaryView = z.object({
    entityType: z.enum(['video', 'channel', 'playlist', 'livestream']),
    entityId: Str(),
    period: z.object({
        startDate: DateTime(),
        endDate: DateTime(),
    }),
    metrics: z.record(z.object({
        current: z.number(),
        previous: z.number().optional(),
        change: z.number().optional(),
        changePercent: z.number().optional(),
    })),
    topPerformingContent: z.array(z.object({
        id: Str(),
        title: Str(),
        metric: z.string(),
        value: z.number(),
    })).optional(),
    chartData: z.array(z.object({
        date: DateTime(),
        values: z.record(z.number()),
    })).optional(),
});