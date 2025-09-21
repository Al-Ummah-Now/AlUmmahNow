// Main API client exports
export { VideosAPI } from './videos';
export { ProfilesAPI, ChannelsAPI } from './channels';
export { PlaylistsAPI } from './playlists';

// Import for internal use
import { VideosAPI } from './videos';
import { ProfilesAPI, ChannelsAPI } from './channels';
import { PlaylistsAPI } from './playlists';

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
      list: (params?, headers?) => VideosAPI.list(params, { ...this.headers, ...headers }),
      getById: (id, headers?) => VideosAPI.getById(id, { ...this.headers, ...headers }),
      create: (data, headers?) => VideosAPI.create(data, { ...this.headers, ...headers }),
      delete: (id, headers?) => VideosAPI.delete(id, { ...this.headers, ...headers }),
      createComment: (videoId, data, headers?) => VideosAPI.createComment(videoId, data, { ...this.headers, ...headers }),
      updateComment: (videoId, commentId, data, headers?) => VideosAPI.updateComment(videoId, commentId, data, { ...this.headers, ...headers }),
      deleteComment: (videoId, commentId, headers?) => VideosAPI.deleteComment(videoId, commentId, { ...this.headers, ...headers }),
      like: (videoId, headers?) => VideosAPI.like(videoId, { ...this.headers, ...headers }),
      unlike: (videoId, headers?) => VideosAPI.unlike(videoId, { ...this.headers, ...headers }),
      dislike: (videoId, headers?) => VideosAPI.dislike(videoId, { ...this.headers, ...headers }),
      removeDislike: (videoId, headers?) => VideosAPI.removeDislike(videoId, { ...this.headers, ...headers }),
    };
  }

  // Profiles
  get profiles() {
    return {
      getCurrent: (userId: string, headers?) => ProfilesAPI.getCurrent(userId, { ...this.headers, ...headers }),
      update: (data, headers?) => ProfilesAPI.update(data, { ...this.headers, ...headers }),
      delete: (headers?) => ProfilesAPI.delete({ ...this.headers, ...headers }),
    };
  }

  // Channels
  get channels() {
    return {
      list: (params?, headers?) => ChannelsAPI.list(params, { ...this.headers, ...headers }),
      getById: (id, headers?) => ChannelsAPI.getById(id, { ...this.headers, ...headers }),
      create: (data, headers?) => ChannelsAPI.create(data, { ...this.headers, ...headers }),
      update: (id, data, headers?) => ChannelsAPI.update(id, data, { ...this.headers, ...headers }),
      delete: (id, headers?) => ChannelsAPI.delete(id, { ...this.headers, ...headers }),
      subscribe: (channelId, data, headers?) => ChannelsAPI.subscribe(channelId, data, { ...this.headers, ...headers }),
      unsubscribe: (channelId, headers?) => ChannelsAPI.unsubscribe(channelId, { ...this.headers, ...headers }),
    };
  }

  // Playlists
  get playlists() {
    return {
      list: (params?, headers?) => PlaylistsAPI.list(params, { ...this.headers, ...headers }),
      getById: (id, headers?) => PlaylistsAPI.getById(id, { ...this.headers, ...headers }),
      create: (data, headers?) => PlaylistsAPI.create(data, { ...this.headers, ...headers }),
      update: (id, data, headers?) => PlaylistsAPI.update(id, data, { ...this.headers, ...headers }),
      delete: (id, headers?) => PlaylistsAPI.delete(id, { ...this.headers, ...headers }),
      addVideo: (playlistId, data, headers?) => PlaylistsAPI.addVideo(playlistId, data, { ...this.headers, ...headers }),
      removeVideo: (playlistId, videoId, headers?) => PlaylistsAPI.removeVideo(playlistId, videoId, { ...this.headers, ...headers }),
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