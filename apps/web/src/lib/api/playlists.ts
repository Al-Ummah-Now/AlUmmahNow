import { Playlist } from "@/interfaces";
import {
  ApiResponse,
  ApiHeaders,
  ListQueryParams,
  PlaylistCreateRequest,
  PlaylistUpdateRequest,
  PlaylistAddVideoRequest,
  PaginationResponse
} from "./types";
import { getApiUrl } from "@/lib/runtime-config";

const baseUrl = getApiUrl();

export class PlaylistsAPI {
  /**
   * List playlists
   * GET /api/playlists
   */
  static async list(
    params?: ListQueryParams,
    headers?: ApiHeaders
  ): Promise<PaginationResponse<Playlist> | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.cursor) queryParams.append('cursor', params.cursor);
      
      const response = await fetch(
        `${baseUrl}/api/playlists?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(headers?.channelId && { 'channelId': headers.channelId }),
            ...(headers?.userId && { 'userId': headers.userId }),
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error fetching playlists: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PlaylistsAPI.list error:', error);
      return null;
    }
  }

  /**
   * Get a playlist by id
   * GET /api/playlists/{id}
   */
  static async getById(
    id: string,
    headers?: ApiHeaders
  ): Promise<Playlist | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/playlists/${id}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(headers?.channelId && { 'channelId': headers.channelId }),
            ...(headers?.userId && { 'userId': headers.userId }),
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error fetching playlist: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PlaylistsAPI.getById error:', error);
      return null;
    }
  }

  /**
   * Create a new playlist
   * POST /api/playlists
   */
  static async create(
    data: PlaylistCreateRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ playlist: Playlist }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/playlists`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        throw new Error(`Error creating playlist: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PlaylistsAPI.create error:', error);
      return null;
    }
  }

  /**
   * Update a playlist
   * PUT /api/playlists/{id}
   */
  static async update(
    id: string,
    data: PlaylistUpdateRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ playlist: Playlist }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/playlists/${id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        throw new Error(`Error updating playlist: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PlaylistsAPI.update error:', error);
      return null;
    }
  }

  /**
   * Delete a playlist
   * DELETE /api/playlists/{id}
   */
  static async delete(
    id: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/playlists/${id}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error deleting playlist: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PlaylistsAPI.delete error:', error);
      return null;
    }
  }

  /**
   * Add a video to a playlist
   * POST /api/playlists/{id}/videos
   */
  static async addVideo(
    playlistId: string,
    data: PlaylistAddVideoRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/playlists/${playlistId}/videos`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        throw new Error(`Error adding video to playlist: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PlaylistsAPI.addVideo error:', error);
      return null;
    }
  }

  /**
   * Remove a video from a playlist
   * DELETE /api/playlists/{id}/videos/{vid}
   */
  static async removeVideo(
    playlistId: string,
    videoId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/playlists/${playlistId}/videos/${videoId}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error removing video from playlist: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('PlaylistsAPI.removeVideo error:', error);
      return null;
    }
  }
}