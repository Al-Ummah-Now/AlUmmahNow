import { Bool, DateTime, Str } from "chanfana";
import { z } from "zod";

// Pure business/database models - represent data as stored in R2

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
    videoUrl: Str().optional(),
    userId: Str(),
    channelId: Str(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    views: z.number().default(0),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.number().optional(),
    fileSize: z.number().optional(),
    originalFormat: z.string().optional(),
    uploadStatus: z.enum(['initiated', 'uploading', 'processing', 'ready', 'failed']).optional(),
    tags: z.array(z.string()).default([]),
    availableResolutions: z.array(z.string()).default([]),
    comments: z.array(Comment).default([]),
    likes: z.array(Like).default([]),
    dislikes: z.array(Dislike).default([]),
    isPublic: z.boolean().default(true),
    isLive: z.boolean().default(false),
});

export const Playlist = z.object({
    id: Str(),
    title: Str(),
    description: Str().optional(),
    thumbnailUrl: Str().optional(),
    userId: Str(),
    channelId: Str(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    videos: z.array(Str()).default([]), // Array of video IDs
    isPublic: z.boolean().default(true),
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
    lastName: Str().optional(),
    bio: Str().optional(),
    bioLocalized: z.record(z.string()).optional(),
    avatarUrl: Str().optional(),
    coverUrl: Str().optional(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    channels: z.array(Str()).default([]), // Array of channel IDs
    watchHistory: z.array(WatchHistoryEntry).default([]), // Watch history tracking
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
    avatarUrl: Str().optional(),
    coverUrl: Str().optional(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    playlists: z.array(Str()).default([]), // Array of playlist IDs
    videos: z.array(Str()).default([]), // Array of video IDs
    subscribers: z.array(Subscription).default([]),
    subscriptions: z.array(Subscription).default([]),
    likes: z.array(Like).default([]),
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