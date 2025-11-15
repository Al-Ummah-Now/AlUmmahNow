// Main API client exports
export { VideosAPI } from './videos';
export { ChannelsAPI } from './channels';
export { PlaylistsAPI } from './playlists';
export { AnalyticsAPI } from './analytics';
export { getProfileCurrent, createProfileAPI, updateProfileAPI, deleteProfileAPI } from './profiles';
export { isProfileComplete } from './profiles-utils';

// Import for internal use
import { VideosAPI } from './videos';
import { getProfileCurrent, createProfileAPI, updateProfileAPI, deleteProfileAPI } from './profiles';
import { ChannelsAPI } from './channels';
import { PlaylistsAPI } from './playlists';
import { AnalyticsAPI } from './analytics';
import { ModerationAPI, type ReportCreateRequest, type ModerationActionRequest } from './moderation';
import type {
  ListQueryParams,
  ApiHeaders,
  VideoCreateRequest,
  CommentCreateRequest,
  CommentUpdateRequest,
  ProfileUpdateRequest,
  ChannelCreateRequest,
  ChannelUpdateRequest,
  SubscriptionRequest,
  PlaylistCreateRequest,
  PlaylistUpdateRequest,
  PlaylistAddVideoRequest,
  AnalyticsQueryParams
} from './types';

// Type exports
export * from './types';

// API client factory for easy usage
export class APIClient {
  constructor(
    private headers: {
      channelId?: string;
      userId?: string;
    } = {}
  ) {}

  // Videos
  get videos() {
    return {
      list: (params?: ListQueryParams, headers?: ApiHeaders) => VideosAPI.list(params, { ...this.headers, ...headers }),
      getById: (id: string, headers?: ApiHeaders) => VideosAPI.getById(id, { ...this.headers, ...headers }),
      create: (data: VideoCreateRequest, headers?: ApiHeaders) => VideosAPI.create(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      upload: (file: File, metadata: { title: string; description?: string; isPublic: boolean; tags?: string[] }, headers?: ApiHeaders) => VideosAPI.upload(file, metadata, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      delete: (id: string, headers?: ApiHeaders) => VideosAPI.delete(id, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      createComment: (videoId: string, data: CommentCreateRequest, headers?: ApiHeaders) => VideosAPI.createComment(videoId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      updateComment: (videoId: string, commentId: string, data: CommentUpdateRequest, headers?: ApiHeaders) => VideosAPI.updateComment(videoId, commentId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      deleteComment: (videoId: string, commentId: string, headers?: ApiHeaders) => VideosAPI.deleteComment(videoId, commentId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      like: (videoId: string, headers?: ApiHeaders) => VideosAPI.like(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      unlike: (videoId: string, headers?: ApiHeaders) => VideosAPI.unlike(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      dislike: (videoId: string, headers?: ApiHeaders) => VideosAPI.dislike(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      removeDislike: (videoId: string, headers?: ApiHeaders) => VideosAPI.removeDislike(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
    };
  }

  // Profiles
  get profiles() {
    return {
      getCurrent: (userId: string, headers?: ApiHeaders) => getProfileCurrent(userId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      create: (data: ProfileUpdateRequest, headers?: ApiHeaders) => createProfileAPI(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      update: (data: ProfileUpdateRequest, headers?: ApiHeaders) => updateProfileAPI(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      delete: (headers?: ApiHeaders) => deleteProfileAPI({ ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
    };
  }

  // Channels
  get channels() {
    return {
      list: (params?: ListQueryParams, headers?: ApiHeaders) => ChannelsAPI.list(params, { ...this.headers, ...headers }),
      getById: (id: string, headers?: ApiHeaders) => ChannelsAPI.getById(id, { ...this.headers, ...headers }),
      create: (data: ChannelCreateRequest, headers?: ApiHeaders) => ChannelsAPI.create(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      update: (id: string, data: ChannelUpdateRequest, headers?: ApiHeaders) => ChannelsAPI.update(id, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      delete: (id: string, headers?: ApiHeaders) => ChannelsAPI.delete(id, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      subscribe: (channelId: string, data: SubscriptionRequest, headers?: ApiHeaders) => ChannelsAPI.subscribe(channelId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      unsubscribe: (channelId: string, headers?: ApiHeaders) => ChannelsAPI.unsubscribe(channelId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
    };
  }

  // Playlists
  get playlists() {
    return {
      list: (params?: ListQueryParams, headers?: ApiHeaders) => PlaylistsAPI.list(params, { ...this.headers, ...headers }),
      getById: (id: string, headers?: ApiHeaders) => PlaylistsAPI.getById(id, { ...this.headers, ...headers }),
      create: (data: PlaylistCreateRequest, headers?: ApiHeaders) => PlaylistsAPI.create(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      update: (id: string, data: PlaylistUpdateRequest, headers?: ApiHeaders) => PlaylistsAPI.update(id, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      delete: (id: string, headers?: ApiHeaders) => PlaylistsAPI.delete(id, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      addVideo: (playlistId: string, data: PlaylistAddVideoRequest, headers?: ApiHeaders) => PlaylistsAPI.addVideo(playlistId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      removeVideo: (playlistId: string, videoId: string, headers?: ApiHeaders) => PlaylistsAPI.removeVideo(playlistId, videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
    };
  }

  // Analytics
  get analytics() {
    return {
      getSummary: (params?: AnalyticsQueryParams, headers?: ApiHeaders) => AnalyticsAPI.getSummary(params, { ...this.headers, ...headers }),
      getChannelAnalytics: (channelId: string, params?: AnalyticsQueryParams, headers?: ApiHeaders) => AnalyticsAPI.getChannelAnalytics(channelId, params, { ...this.headers, ...headers }),
      getVideoAnalytics: (videoId: string, params?: AnalyticsQueryParams, headers?: ApiHeaders) => AnalyticsAPI.getVideoAnalytics(videoId, params, { ...this.headers, ...headers }),
      getMetrics: (params?: AnalyticsQueryParams, headers?: ApiHeaders) => AnalyticsAPI.getMetrics(params, { ...this.headers, ...headers }),
    };
  }

  // Moderation
  get moderation() {
    return {
      getReports: (params?: ListQueryParams & { status?: string; priority?: string; contentType?: string; assignedTo?: string; reason?: string }, headers?: ApiHeaders) => ModerationAPI.getReports(params, { ...this.headers, ...headers }),
      getReportById: (reportId: string, headers?: ApiHeaders) => ModerationAPI.getReportById(reportId, { ...this.headers, ...headers }),
      createReport: (reportData: ReportCreateRequest, headers?: ApiHeaders) => ModerationAPI.createReport(reportData, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      takeModerationAction: (actionData: ModerationActionRequest, headers?: ApiHeaders) => ModerationAPI.takeModerationAction(actionData, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId' | 'userId'>>),
      getStats: (headers?: ApiHeaders) => ModerationAPI.getStats({ ...this.headers, ...headers }),
      getUserModeration: (userId: string, headers?: ApiHeaders) => ModerationAPI.getUserModeration(userId, { ...this.headers, ...headers }),
    };
  }

  // Set headers for authenticated requests
  setHeaders(headers: { channelId?: string; userId?: string }) {
    this.headers = { ...this.headers, ...headers };
    return this;
  }

  // Get current headers
  getHeaders() {
    return this.headers;
  }
}

// Default client instance
export const apiClient = new APIClient();

// Convenience function to create authenticated client
export function createAuthenticatedClient(channelId: string, userId: string) {
  return new APIClient({ channelId, userId });
}