import { VideoObject } from "@/interfaces";
import {
  ApiResponse,
  PaginationResponse,
  VideoCreateRequest,
  ApiHeaders,
  ListQueryParams,
  CommentCreateRequest,
  CommentUpdateRequest
} from "./types";

const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://videos.api.alummahnow.net";

export class VideosAPI {
  /**
   * List Videos
   * GET /api/videos
   */
  static async list(
    params?: ListQueryParams, 
    headers?: ApiHeaders
  ): Promise<PaginationResponse<VideoObject> | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.cursor) queryParams.append('cursor', params.cursor);
      
      const response = await fetch(
        `${baseUrl}/api/videos?${queryParams.toString()}`,
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
        throw new Error(`Error fetching videos: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.list error:', error);
      return null;
    }
  }

  /**
   * Get a single video by id
   * GET /api/videos/{id}
   */
  static async getById(
    id: string, 
    headers?: ApiHeaders
  ): Promise<VideoObject | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${id}`,
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
        throw new Error(`Error fetching video: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.getById error:', error);
      return null;
    }
  }

  /**
   * Create a new Video
   * POST /api/videos
   */
  static async create(
    data: VideoCreateRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ video: VideoObject }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos`,
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
        throw new Error(`Error creating video: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.create error:', error);
      return null;
    }
  }

  /**
   * Delete a Video
   * DELETE /api/videos/{id}
   */
  static async delete(
    videoId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ success: boolean }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}`,
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
        throw new Error(`Error deleting video: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.delete error:', error);
      return null;
    }
  }

  /**
   * Create a new comment for a video
   * POST /api/videos/{id}/comments
   */
  static async createComment(
    videoId: string,
    data: CommentCreateRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ comment: any }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/comments`,
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
        throw new Error(`Error creating comment: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.createComment error:', error);
      return null;
    }
  }

  /**
   * Update a comment for a video
   * PUT /api/videos/{id}/comments/{cid}
   */
  static async updateComment(
    videoId: string,
    commentId: string,
    data: CommentUpdateRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ comment: any }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/comments/${commentId}`,
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
        throw new Error(`Error updating comment: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.updateComment error:', error);
      return null;
    }
  }

  /**
   * Delete a comment for a video
   * DELETE /api/videos/{id}/comments/{cid}
   */
  static async deleteComment(
    videoId: string,
    commentId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/comments/${commentId}`,
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
        throw new Error(`Error deleting comment: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.deleteComment error:', error);
      return null;
    }
  }

  /**
   * Like a video
   * POST /api/videos/{id}/likes
   */
  static async like(
    videoId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/likes`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error liking video: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.like error:', error);
      return null;
    }
  }

  /**
   * Unlike a video
   * DELETE /api/videos/{id}/likes
   */
  static async unlike(
    videoId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/likes`,
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
        throw new Error(`Error unliking video: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.unlike error:', error);
      return null;
    }
  }

  /**
   * Dislike a video
   * POST /api/videos/{id}/dislikes
   */
  static async dislike(
    videoId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/dislikes`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error disliking video: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.dislike error:', error);
      return null;
    }
  }

  /**
   * Remove dislike from a video
   * DELETE /api/videos/{id}/dislikes
   */
  static async removeDislike(
    videoId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/dislikes`,
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
        throw new Error(`Error removing dislike from video: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.removeDislike error:', error);
      return null;
    }
  }

  /**
   * Like a comment
   * POST /api/videos/{id}/comments/{cid}/likes
   */
  static async likeComment(
    videoId: string,
    commentId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/comments/${commentId}/likes`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error liking comment: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.likeComment error:', error);
      return null;
    }
  }

  /**
   * Unlike a comment
   * DELETE /api/videos/{id}/comments/{cid}/likes
   */
  static async unlikeComment(
    videoId: string,
    commentId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/comments/${commentId}/likes`,
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
        throw new Error(`Error unliking comment: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.unlikeComment error:', error);
      return null;
    }
  }

  /**
   * Dislike a comment
   * POST /api/videos/{id}/comments/{cid}/dislikes
   */
  static async dislikeComment(
    videoId: string,
    commentId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/comments/${commentId}/dislikes`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error disliking comment: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.dislikeComment error:', error);
      return null;
    }
  }

  /**
   * Remove dislike from a comment
   * DELETE /api/videos/{id}/comments/{cid}/dislikes
   */
  static async removeCommentDislike(
    videoId: string,
    commentId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/videos/${videoId}/comments/${commentId}/dislikes`,
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
        throw new Error(`Error removing dislike from comment: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.removeCommentDislike error:', error);
      return null;
    }
  }

  /**
   * Upload a video file
   * POST /api/upload/video
   */
  static async upload(
    file: File,
    metadata: {
      title: string;
      description?: string;
      isPublic: boolean;
      tags?: string[];
    },
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ video: VideoObject }> | null> {
    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', metadata.title);
      formData.append('description', metadata.description || '');
      formData.append('isPublic', metadata.isPublic.toString());
      if (metadata.tags && metadata.tags.length > 0) {
        formData.append('tags', JSON.stringify(metadata.tags));
      }

      const response = await fetch(
        `${baseUrl}/api/upload/video`,
        {
          method: 'POST',
          headers: {
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        let errorDetails = '';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errorJson = await response.json();
            errorDetails = JSON.stringify(errorJson);
          } else {
            errorDetails = await response.text();
          }
        } catch (e) {
          errorDetails = 'Unable to parse error details';
        }
        throw new Error(
          `Error uploading video: ${response.status} ${response.statusText}. Details: ${errorDetails}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.upload error:', error);
      return null;
    }
  }
}