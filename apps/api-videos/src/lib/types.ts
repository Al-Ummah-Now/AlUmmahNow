import { Bool, DateTime, Str } from "chanfana";
import { z } from "zod";
import { PLAYLIST_SORT_DIRECTIONS, PLAYLIST_SORT_FIELDS, PLAYLIST_SORT_MODES, VideoCategory } from "@al-ummah/shared-types";

// Pure business/database models - represent data as stored in R2

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

export const Like = z.object({
    id: Str(),
    userId: Str(),
    channelId: Str(),
    entityId: Str(),
    dateCreated: DateTime(),
});

export const Dislike = z.object({
    id: Str(),
    userId: Str(),
    channelId: Str(),
    entityId: Str(),
    dateCreated: DateTime(),
});

export const Subscription = z.object({
    id: Str(),
    userId: Str(),
    channelId: Str(),
    entityId: Str(),
    dateCreated: DateTime(),
});

// Define Comment without replies first
const BaseComment = z.object({
    id: Str(),
    userId: Str(),
    channelId: Str(),
    videoId: Str(),
    text: Str(),
    dateCreated: DateTime(),
    dateModified: DateTime().optional(),
    likes: z.array(Like),
    dislikes: z.array(Dislike),
    isEdited: z.boolean().default(false),
    isDeleted: z.boolean().default(false),
    isPinned: z.boolean().default(false),
    isHidden: z.boolean().optional(),
    parentCommentId: Str().optional(),
    status: z.enum(['published', 'held']).optional(),
});

// Define Comment with lazy evaluation for replies to avoid circular reference
export const Comment = BaseComment.extend({
    replies: z.lazy(() => z.array(Comment)).default([]),
});

export const Video = z.object({
    id: Str(),
    title: Str(),
    titleLocalized: z.record(z.string()).optional(),
    description: Str().optional(),
    descriptionLocalized: z.record(z.string()).optional(),
    thumbnailUrl: Str().optional(),
    thumbnailType: z.enum(['auto', 'custom']).optional(),
    thumbnailSizes: z.record(z.string()).optional(),
    // Bunny's auto thumbnail does not exist yet (lib/processing): views omit thumbnailUrl
    thumbnailPending: z.boolean().optional(),
    videoUrl: Str().optional(),
    playUrl: Str().optional(),
    userId: Str(),
    /** The channel member who uploaded it, when not the owner (spec CHANNEL-ROLES §8). Private. */
    uploadedBy: Str().optional(),
    channelId: Str(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    views: z.number().default(0),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.number().optional(),
    fileSize: z.number().optional(),
    originalFormat: z.string().optional(),
    // Uploader / admin choice of Short or video; absent = detected (shared-types video-format.ts)
    format: z.enum(['short', 'video']).optional(),
    // Who chose the format by hand, and why detection could not decide (video-format-ops.ts)
    formatSetBy: z.object({ by: z.enum(['owner', 'admin']), userId: z.string(), at: z.string() }).optional(),
    formatIssue: z.object({ reason: z.string(), missing: z.array(z.enum(['duration', 'dimensions'])), at: z.string() }).optional(),
    uploadStatus: z.enum(['initiated', 'uploading', 'processing', 'ready', 'failed']).optional(),
    // Why processing did not finish (lib/processing): Bunny encode failure, an
    // upload whose bytes never arrived (re-upload needed) or a stalled encode.
    processingIssue: z.object({
        kind: z.enum(['encode_failed', 'needs_reupload', 'stalled']),
        reason: z.string().optional(),
        at: z.string(),
    }).optional(),
    // Terminal status whose result (uploader notification, subscriber fan-out)
    // is safely queued; the processing loop re-announces until it matches.
    processingAnnounced: z.enum(['ready', 'failed']).optional(),
    // Per-video processing-check loop (lib/processing/loop.ts); internal.
    processingCheck: z.object({
        loopId: z.string(),
        startedAt: z.string(),
        attempt: z.number(),
        lastCheckedAt: z.string().optional(),
        nextCheckAt: z.string().optional(),
        finishedAt: z.string().optional(),
        outcome: z.string().optional(),
        bunnyStatus: z.number().optional(),
        bunnyProgress: z.number().optional(),
        restarts: z.number().optional(),
    }).optional(),
    // Idempotent initiate (lib/uploads/initiateOnce.ts); internal.
    uploadFingerprint: z.string().optional(),
    lastInitiateAt: z.string().optional(),
    // Upload reaper (lib/uploads/reaper.ts): a placeholder whose bytes never
    // arrived, deleted at Bunny and soft-removed here; internal.
    abandoned: z.object({
        at: z.string(),
        reason: z.string(),
        by: z.string(),
        bunnyDeleted: z.boolean(),
    }).optional(),
    isDeleted: z.boolean().optional(),
    deletedAt: z.string().optional(),
    // Last thumbnail aspect check (lib/thumbnail/repair.ts); internal.
    thumbnailCheck: z.object({
        runId: z.string(),
        at: z.string(),
        dryRun: z.boolean(),
        outcome: z.enum(['ok', 'replaced', 'would_replace', 'flagged', 'skipped', 'error']),
        reason: z.string().optional(),
        thumbnail: z.object({ width: z.number(), height: z.number() }).optional(),
        video: z.object({ width: z.number(), height: z.number() }).optional(),
        previousThumbnailUrl: z.string().optional(),
    }).optional(),
    tags: z.array(z.string()).default([]),
    category: z.nativeEnum(VideoCategory).optional(),
    // Who set the category: the uploader, the AI (a reviewable suggestion) or an admin
    categorySource: z.enum(['uploader', 'ai', 'admin']).optional(),
    language: z.enum(['en', 'ar', 'ur', 'fr']).optional(),
    availableResolutions: z.array(z.string()).default([]),
    comments: z.array(Comment).default([]),
    likes: z.array(Like).default([]),
    dislikes: z.array(Dislike).default([]),
    isPublic: z.boolean().default(true),
    isLive: z.boolean().default(false),
    // Per-video comment settings (Story 29.2): on | held (for review) | off
    commentSettings: z.enum(['on', 'held', 'off']).optional(),
    // Scheduling fields
    scheduledPublishDate: DateTime().optional(),
    scheduledPublishTimezone: Str().optional(),
    scheduledPublishStatus: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled']).optional(),
    scheduledBy: Str().optional(),
    scheduledAt: DateTime().optional(),
    publishedViaSchedule: z.boolean().optional(),
    // Soft delete and moderation fields
    ...SoftDeleteFields,
    ...ModerationFields,
});

export const Playlist = z.object({
    id: Str(),
    title: Str(),
    description: Str().optional(),
    thumbnailUrl: Str().optional(),
    userId: Str(),
    /** The channel member who created it, when not the channel's owner (`userId`) */
    createdBy: Str().optional(),
    channelId: Str(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    videos: z.array(Str()).default([]), // Array of video IDs, stored in the playlist's order
    isPublic: z.boolean().default(true),
    // Order (shared-types playlist-bulk.ts): absent on older playlists = manual
    sortMode: z.enum(PLAYLIST_SORT_MODES).optional(),
    sortField: z.enum(PLAYLIST_SORT_FIELDS).optional(),
    sortDirection: z.enum(PLAYLIST_SORT_DIRECTIONS).optional(),
    /** When each video was added (ISO), for the "date added" order */
    videoAddedAt: z.record(z.string()).optional(),
    /** When the automatic order was last sorted from fresh video data (ISO) */
    orderRefreshedAt: Str().optional(),
    /** Cover: this video's thumbnail when the viewer can see it (lib/playlistCovers.ts) */
    coverVideoId: Str().optional(),
    // Soft delete and moderation fields
    ...SoftDeleteFields,
    ...ModerationFields,
});

// Watch history entry type
const WatchHistoryEntry = z.object({
    videoId: Str(),
    videoTitle: Str().optional(),
    watchTime: z.number().optional(),
    totalDuration: z.number().optional(),
    watchedAt: DateTime(),
    completed: z.boolean().default(false),
});

export const Profile = z.object({
    id: Str(),
    email: Str().email(),
    userName: Str().optional(),
    displayName: Str().optional(),
    displayNameLocalized: z.record(z.string()).optional(),
    firstName: Str().optional(),
    firstNameLocalized: z.record(z.string()).optional().describe("Multi-language first names"),
    lastName: Str().optional(),
    lastNameLocalized: z.record(z.string()).optional().describe("Multi-language last names"),
    bio: Str().optional(),
    bioLocalized: z.record(z.string()).optional(),
    avatarUrl: Str().optional(),
    coverUrl: Str().optional(),
    timezone: Str().optional().describe("User timezone (IANA format, e.g., 'America/New_York', 'Asia/Dubai')"),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    channels: z.array(Str()).default([]), // Array of channel IDs
    watchHistory: z.array(WatchHistoryEntry).default([]), // Watch history tracking
    subscribedTo: z.array(Str()).default([]), // Channel IDs user is subscribed to (reverse index)
});

export const Channel = z.object({
    id: Str(),
    userId: Str(),
    email: Str().email(),
    name: Str(),
    nameLocalized: z.record(z.string()).optional(),
    description: Str().optional(),
    descriptionLocalized: z.record(z.string()).optional(),
    isMain: Bool().default(false),
    isPrivate: z.boolean().optional(), // User-controlled privacy
    avatarUrl: Str().optional(),
    coverUrl: Str().optional(),
    // Story 29.1: unique @handle (display casing; uniqueness is case-insensitive) and About details
    handle: Str().optional(),
    links: z.array(z.object({ title: Str(), url: Str() })).optional(),
    contactEmail: Str().optional(),
    location: Str().optional(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    playlists: z.array(Str()).default([]), // Array of playlist IDs
    videos: z.array(Str()).default([]), // Array of video IDs
    subscribers: z.array(Subscription).default([]),
    subscriptions: z.array(Subscription).default([]),
    likes: z.array(Like).default([]),
    // Per-channel roles (lib/channelAccess.ts). The owner is userId; never in public views.
    members: z.array(z.object({
        userId: Str(),
        role: z.enum(['admin', 'editor', 'moderator']),
        addedBy: Str(),
        addedAt: Str(),
        updatedAt: Str().optional(),
    })).optional(),
    // Soft delete and moderation fields
    ...SoftDeleteFields,
    ...ModerationFields,
});

// Channel Tab Configuration
export const ChannelTab = z.object({
    id: Str({ description: "Tab identifier (home, videos, shorts, etc.)" }),
    name: Str({ description: "Default display name" }),
    nameLocalized: z.record(z.string()).optional(),
    icon: Str().optional(),
    type: z.enum(['system', 'custom']),
    visible: Bool({ description: "Whether the tab is visible" }),
    position: z.number().int().min(0),
    url: Str().optional(),
    metadata: z.record(z.any()).optional(),
});

export const ChannelTabConfig = z.object({
    channelId: Str(),
    defaultTab: Str({ description: "Default tab ID when visiting channel" }),
    tabs: z.array(ChannelTab),
    version: z.number().int().default(1),
    lastModifiedBy: Str().optional(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
});

export const ChannelTabConfigUpdateInput = z.object({
    defaultTab: Str().optional(),
    tabs: z.array(z.object({
        id: Str(),
        visible: Bool().optional(),
        position: z.number().int().min(0).optional(),
        nameLocalized: z.record(z.string()).optional(),
    })).optional(),
});

// Phase 2: Live Streaming models
export const LiveStream = z.object({
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
    status: z.enum(['scheduled', 'live', 'ended', 'cancelled']).default('scheduled'),
    isPrivate: z.boolean().default(false),
    allowChat: z.boolean().default(true),
    maxViewers: z.number().optional(),
    currentViewers: z.number().default(0),
    peakViewers: z.number().default(0),
    tags: z.array(z.string()).default([]),
    thumbnailUrl: Str().optional(),
    streamUrl: Str().optional(),
    rtmpUrl: Str().optional(),
    streamKey: Str().optional(),
    views: z.number().default(0),
    likes: z.array(Like).default([]),
    dislikes: z.array(Dislike).default([]),
    comments: z.array(Comment).default([]),
});

// Phase 2: Content Moderation models
export const Report = z.object({
    id: Str(),
    entityType: z.enum(['video', 'comment', 'channel', 'livestream']),
    entityId: Str(),
    reporterId: Str(),
    reporterChannelId: Str(),
    reason: z.enum(['inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other']),
    description: Str().optional(),
    status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed']).default('pending'),
    dateCreated: DateTime(),
    dateResolved: DateTime().optional(),
    moderatorId: Str().optional(),
    moderatorAction: z.enum(['approve', 'remove', 'flag', 'escalate', 'dismiss']).optional(),
    moderatorNotes: Str().optional(),
});

// Phase 2: Analytics models
export const AnalyticsData = z.object({
    id: Str(),
    entityType: z.enum(['video', 'channel', 'playlist', 'livestream']),
    entityId: Str(),
    metric: z.enum(['views', 'likes', 'comments', 'shares', 'watch_time', 'engagement_rate']),
    value: z.number(),
    timestamp: DateTime(),
    metadata: z.record(z.any()).optional(),
});

export const AnalyticsSummary = z.object({
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
});

// Utility types for API responses
export const PaginationResponse = z.object({
    cursor: z.string(),
    limit: z.number(),
    data: z.array(z.any()), // Replace `z.any()` with a specific schema if needed
});

export const ResponseError = z.object({
    success: z.boolean().default(false),
    error: z.string(),
    message: z.string().optional(),
});

// Types inferred from zod schemas
export type PaginationResponse<T> = z.infer<typeof PaginationResponse> & { data: T[] };
export type ResponseError = z.infer<typeof ResponseError>;