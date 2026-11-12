// Main API client exports - use named exports for 'use server' files
export {
  listVideos,
  getVideoById,
  createVideo,
  updateVideo,
  deleteVideo,
  bulkDeleteVideos,
  createVideoComment,
  updateVideoComment,
  deleteVideoComment,
  likeVideo,
  unlikeVideo,
  likeVideoComment,
  unlikeVideoComment,
  dislikeVideoComment,
  searchVideos,
  getTrendingVideos,
  getRecommendedVideos,
  initiateVideoUploadApi,
  completeVideoUploadApi,
  initiateBatchUploadApi,
  getVideoUploadStatusApi,
  fetchVideoById,
  fetchVideos,
  fetchVideosWithPagination
} from './videos';
export {
  listChannels,
  listUserChannels,
  getChannelById,
  createChannel,
  updateChannel,
  deleteChannel,
  subscribeToChannel,
  unsubscribeFromChannel,
  updateChannelAvatar,
  updateChannelCover,
  getChannelVideos,
  getChannelShorts,
  getChannelLiveStreams,
  getChannelPlaylists
} from './channels';
export * as PlaylistsAPI from './playlists';
export * as LiveStreamsAPI from './livestreams';
export * as AnalyticsAPI from './analytics';
export * as ModerationAPI from './moderation';
export { getProfileCurrent, createProfileAPI, updateProfileAPI, deleteProfileAPI, createProfile } from './profiles';
export { isProfileComplete } from './profiles-utils';
export { fetchProfile, checkProfileExists, updateProfile, updateProfilePhoto, updateCoverPhoto } from './profiles-client';

// Import for internal use in APIClient class
import {
  listVideos,
  getVideoById,
  createVideo,
  deleteVideo,
  createVideoComment,
  updateVideoComment,
  deleteVideoComment,
  likeVideo,
  unlikeVideo
} from './videos';
import { getProfileCurrent, createProfileAPI, updateProfileAPI, deleteProfileAPI } from './profiles';
import {
  listChannels,
  getChannelById,
  createChannel,
  updateChannel,
  deleteChannel,
  subscribeToChannel,
  unsubscribeFromChannel
} from './channels';
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
      list: (params?: ListQueryParams, headers?: ApiHeaders) => listVideos(params, { ...this.headers, ...headers }),
      getById: (id: string, headers?: ApiHeaders) => getVideoById(id, { ...this.headers, ...headers }),
      create: (data: VideoCreateRequest, headers?: ApiHeaders) => createVideo(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      delete: (id: string, headers?: ApiHeaders) => deleteVideo(id, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      createComment: (videoId: string, data: CommentCreateRequest, headers?: ApiHeaders) => createVideoComment(videoId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      updateComment: (videoId: string, commentId: string, data: CommentUpdateRequest, headers?: ApiHeaders) => updateVideoComment(videoId, commentId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      deleteComment: (videoId: string, commentId: string, headers?: ApiHeaders) => deleteVideoComment(videoId, commentId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      like: (videoId: string, headers?: ApiHeaders) => likeVideo(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      unlike: (videoId: string, headers?: ApiHeaders) => unlikeVideo(videoId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
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
      list: (params?: ListQueryParams, headers?: ApiHeaders) => listChannels(params, { ...this.headers, ...headers }),
      getById: (id: string, headers?: ApiHeaders) => getChannelById(id, { ...this.headers, ...headers }),
      create: (data: ChannelCreateRequest, headers?: ApiHeaders) => createChannel(data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      update: (id: string, data: ChannelUpdateRequest, headers?: ApiHeaders) => updateChannel(id, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      delete: (id: string, headers?: ApiHeaders) => deleteChannel(id, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      subscribe: (channelId: string, data: SubscriptionRequest, headers?: ApiHeaders) => subscribeToChannel(channelId, data, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
      unsubscribe: (channelId: string, headers?: ApiHeaders) => unsubscribeFromChannel(channelId, { ...this.headers, ...headers } as Required<Pick<ApiHeaders, 'channelId'>>),
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

  // Live Streams (server actions - auth handled internally via getServerAuthContext)
  get liveStreams() {
    return {
      list: (params?: import('./types').LiveStreamQueryParams) => LiveStreamsAPI.listLiveStreams(params),
      create: (data: import('./types').LiveStreamCreateRequest) => LiveStreamsAPI.createLiveStream(data),
      update: (streamId: string, data: import('./types').LiveStreamUpdateRequest) => LiveStreamsAPI.updateLiveStream(streamId, data),
      goLive: (streamId: string) => LiveStreamsAPI.goLive(streamId),
      endStream: (streamId: string) => LiveStreamsAPI.endLiveStream(streamId),
      cancelStream: (streamId: string) => LiveStreamsAPI.cancelLiveStream(streamId),
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
