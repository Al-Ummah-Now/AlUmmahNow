/**
 * Watch History and Progress Tracking Types
 * Types for tracking video watch history and playback progress
 */

/**
 * Watch history entry for a single video view
 */
export interface WatchHistoryEntry {
  /** Unique identifier for this watch history entry */
  id: string;

  /** ID of the user who watched the video */
  userId: string;

  /** ID of the video that was watched */
  videoId: string;

  /** Video title (denormalized for faster display) */
  videoTitle: string;

  /** Video thumbnail URL (denormalized for faster display) */
  videoThumbnail?: string;

  /** Video duration in seconds */
  videoDuration: number;

  /** Channel ID of the video */
  channelId: string;

  /** Channel name (denormalized for faster display) */
  channelName: string;

  /** Timestamp when the video was first watched */
  firstWatchedAt: string; // ISO 8601

  /** Timestamp of the most recent watch */
  lastWatchedAt: string; // ISO 8601

  /** Number of times this video has been watched by the user */
  watchCount: number;

  /** Current playback progress in seconds */
  progress: number;

  /** Whether the video has been fully watched (>95% completion) */
  completed: boolean;

  /** Percentage of video watched (0-100) */
  percentageWatched: number;

  /**
   * Last-writer-wins clock of the playback position (client time of the write,
   * clamped to server time + 5 min). Missing on older entries: `lastWatchedAt`.
   */
  stateUpdatedAt?: string; // ISO 8601

  /** Device that wrote the current position (native clients) */
  stateDeviceId?: string;
}

/**
 * Watch progress update payload
 */
export interface WatchProgressUpdate {
  /** ID of the video */
  videoId: string;

  /** Current playback position in seconds */
  progress: number;

  /** Video duration in seconds */
  duration: number;

  /** Timestamp of the progress update */
  timestamp: string; // ISO 8601
}

/**
 * Request to record a video view
 */
export interface RecordWatchRequest {
  /** ID of the video being watched */
  videoId: string;

  /** Initial playback progress (0 if starting fresh) */
  progress?: number;

  /** Video duration in seconds */
  duration: number;
}

/**
 * Response from watch history endpoints
 */
export interface WatchHistoryResponse {
  /** List of watch history entries */
  entries: WatchHistoryEntry[];

  /** Total count of entries (for pagination) */
  total: number;

  /** Whether there are more entries */
  hasMore: boolean;

  /** Cursor for next page (if hasMore is true) */
  cursor?: string;
}

/**
 * Request parameters for listing watch history
 */
export interface WatchHistoryListRequest {
  /** Number of entries to return (default: 20, max: 100) */
  limit?: number;

  /** Cursor for pagination */
  cursor?: string;

  /** Filter by completion status */
  completed?: boolean;

  /** Sort order (newest first by default) */
  sort?: 'newest' | 'oldest' | 'alphabetical';
}

/**
 * Continue watching item (for homepage section)
 */
export interface ContinueWatchingItem {
  /** Watch history entry ID */
  id: string;

  /** Video ID */
  videoId: string;

  /** Video title */
  title: string;

  /** Video thumbnail URL */
  thumbnail?: string;

  /** Channel name */
  channelName: string;

  /** Current progress in seconds */
  progress: number;

  /** Total duration in seconds */
  duration: number;

  /** Progress percentage (0-100) */
  percentageWatched: number;

  /** Last watched timestamp */
  lastWatchedAt: string; // ISO 8601
}

/**
 * Watch history statistics
 */
export interface WatchHistoryStats {
  /** Total number of videos watched */
  totalVideosWatched: number;

  /** Total watch time in seconds */
  totalWatchTime: number;

  /** Number of videos completed (>95% watched) */
  videosCompleted: number;

  /** Number of videos in progress */
  videosInProgress: number;

  /** Average watch percentage across all videos */
  averageCompletionRate: number;
}

/**
 * User privacy settings for watch history
 */
export interface WatchHistoryPrivacySettings {
  /** Whether watch history tracking is enabled */
  enabled: boolean;

  /** Whether to track watch progress for resume playback */
  trackProgress: boolean;

  /** Whether to show watch history to other users (future feature) */
  public: boolean;

  /** Last updated timestamp */
  updatedAt: string; // ISO 8601
}

/**
 * Event payload for queue system
 */
export interface WatchHistoryEvent {
  /** Event type */
  type: 'watch_started' | 'watch_progress' | 'watch_completed';

  /** User ID */
  userId: string;

  /** Video ID */
  videoId: string;

  /** Progress in seconds */
  progress: number;

  /** Duration in seconds */
  duration: number;

  /** Timestamp of the event */
  timestamp: string; // ISO 8601

  /** Session ID (for tracking individual viewing sessions) */
  sessionId?: string;
}
