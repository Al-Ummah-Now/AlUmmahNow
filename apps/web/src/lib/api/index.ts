// Main API client exports
export * as VideosAPI from './videos';
export * as ChannelsAPI from './channels';
export * as PlaylistsAPI from './playlists';
export * as LiveStreamsAPI from './livestreams';
export * as AnalyticsAPI from './analytics';
export * as ModerationAPI from './moderation';
export { getProfileCurrent, createProfileAPI, updateProfileAPI, deleteProfileAPI, createProfile } from './profiles';
export { isProfileComplete } from './profiles-utils';
export { fetchProfile, checkProfileExists, updateProfile, updateProfilePhoto, updateCoverPhoto } from './profiles-client';

// Import for internal use
import * as VideosAPI from './videos';
import { getProfileCurrent, createProfileAPI, updateProfileAPI, deleteProfileAPI } from './profiles';
import * as ChannelsAPI from './channels';
import * as PlaylistsAPI from './playlists';
import * as LiveStreamsAPI from './livestreams';
import * as AnalyticsAPI from './analytics';
import * as ModerationAPI from './moderation';
import type { ReportCreateRequest } from './moderation';
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
      list: (params?: ListQueryParams, headers?: ApiHeaders) => VideosAPI.listVideos(params, { ...this.headers, ...headers }),
      getById: (id: string, headers?: ApiHeaders) => VideosAPI.getVideoById(id, { ...this.headers, ...headers }),
      create: (data: VideoCreateRequest, headers?: ApiHeaders) => VideosAPI.createVideo(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      upload: (file: File, metadata: { title: string; description?: string; isPublic: boolean; tags?: string[] }, headers?: ApiHeaders) => VideosAPI.uploadVideo(file, metadata, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      delete: (id: string, headers?: ApiHeaders) => VideosAPI.deleteVideo(id, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      createComment: (videoId: string, data: CommentCreateRequest, headers?: ApiHeaders) => VideosAPI.createVideoComment(videoId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      updateComment: (videoId: string, commentId: string, data: CommentUpdateRequest, headers?: ApiHeaders) => VideosAPI.updateVideoComment(videoId, commentId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      deleteComment: (videoId: string, commentId: string, headers?: ApiHeaders) => VideosAPI.deleteVideoComment(videoId, commentId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      like: (videoId: string, headers?: ApiHeaders) => VideosAPI.likeVideo(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      unlike: (videoId: string, headers?: ApiHeaders) => VideosAPI.unlikeVideo(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      dislike: (videoId: string, headers?: ApiHeaders) => VideosAPI.dislikeVideo(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      removeDislike: (videoId: string, headers?: ApiHeaders) => VideosAPI.removeVideoDislike(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
    };
  }

  // Profiles
  get profiles() {
    return {
      getCurrent: () => getProfileCurrent(),
      create: (data: ProfileUpdateRequest) => createProfileAPI(data),
      update: (data: ProfileUpdateRequest) => updateProfileAPI(data),
      delete: () => deleteProfileAPI(),
    };
  }

  // Channels
  get channels() {
    return {
      list: (params?: ListQueryParams, headers?: ApiHeaders) => ChannelsAPI.listChannels(params, { ...this.headers, ...headers }),
      getById: (id: string, headers?: ApiHeaders) => ChannelsAPI.getChannelById(id, { ...this.headers, ...headers }),
      create: (data: ChannelCreateRequest, headers?: ApiHeaders) => ChannelsAPI.createChannel(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      update: (id: string, data: ChannelUpdateRequest, headers?: ApiHeaders) => ChannelsAPI.updateChannel(id, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      delete: (id: string, headers?: ApiHeaders) => ChannelsAPI.deleteChannel(id, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      subscribe: (channelId: string, data: SubscriptionRequest, headers?: ApiHeaders) => ChannelsAPI.subscribeToChannel(channelId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      unsubscribe: (channelId: string, headers?: ApiHeaders) => ChannelsAPI.unsubscribeFromChannel(channelId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
    };
  }

  // Playlists
  get playlists() {
    return {
      list: (params?: ListQueryParams, headers?: ApiHeaders) => PlaylistsAPI.listPlaylists(params, { ...this.headers, ...headers }),
      getById: (id: string, headers?: ApiHeaders) => PlaylistsAPI.getPlaylistById(id, { ...this.headers, ...headers }),
      create: (data: PlaylistCreateRequest, headers?: ApiHeaders) => PlaylistsAPI.createPlaylist(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      update: (id: string, data: PlaylistUpdateRequest, headers?: ApiHeaders) => PlaylistsAPI.updatePlaylist(id, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      delete: (id: string, headers?: ApiHeaders) => PlaylistsAPI.deletePlaylist(id, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      addVideo: (playlistId: string, data: PlaylistAddVideoRequest, headers?: ApiHeaders) => PlaylistsAPI.addVideoToPlaylist(playlistId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      removeVideo: (playlistId: string, videoId: string, headers?: ApiHeaders) => PlaylistsAPI.removeVideoFromPlaylist(playlistId, videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
    };
  }

  // Live Streams
  get liveStreams() {
    return {
      list: (params?: import('./types').LiveStreamQueryParams, headers?: ApiHeaders) => LiveStreamsAPI.listLiveStreams(params, { ...this.headers, ...headers }),
      create: (data: import('./types').LiveStreamCreateRequest, authToken: string) => LiveStreamsAPI.createLiveStream(data, authToken),
      update: (streamId: string, data: import('./types').LiveStreamUpdateRequest, authToken: string) => LiveStreamsAPI.updateLiveStream(streamId, data, authToken),
      goLive: (streamId: string, authToken: string) => LiveStreamsAPI.goLive(streamId, authToken),
      endStream: (streamId: string, authToken: string) => LiveStreamsAPI.endLiveStream(streamId, authToken),
      cancelStream: (streamId: string, authToken: string) => LiveStreamsAPI.cancelLiveStream(streamId, authToken),
      getLiveNow: (limit?: number) => LiveStreamsAPI.getLiveNow(limit),
      getScheduled: (limit?: number) => LiveStreamsAPI.getScheduledStreams(limit),
      getByChannel: (channelId: string, status?: 'scheduled' | 'live' | 'ended' | 'cancelled', limit?: number) => LiveStreamsAPI.getStreamsByChannel(channelId, status, limit),
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

  // Moderation (user-facing only - admin functions are in admin-api)
  get moderation() {
    return {
      createReport: (reportData: ReportCreateRequest, headers?: ApiHeaders) => ModerationAPI.createReport(reportData, { ...this.headers, ...headers }),
    };
  }

  // Set headers for authenticated requests
  // Note: userId is now extracted from JWT token in Authorization header server-side
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
export function createAuthenticatedClient(channelId: string, userId?: string) {
  return new APIClient({ channelId, userId });
}