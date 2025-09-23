import { VideoObject } from "@/interfaces";
import { 
  ApiResponse, 
  PaginationResponse, 
  VideoCreateRequest, 
  VideoUpdateRequest,
  ApiHeaders,
  ListQueryParams,
  CommentCreateRequest,
  CommentUpdateRequest,
  SearchQueryParams,
  SearchFilters,
  SearchSuggestion,
  TrendingContent,
  RecommendationRequest
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
   * Advanced Search Videos
   * GET /api/videos with advanced filters
   */
  static async search(
    query: string,
    filters?: SearchFilters,
    params?: ListQueryParams,
    headers?: ApiHeaders
  ): Promise<PaginationResponse<VideoObject> | null> {
    try {
      const queryParams = new URLSearchParams();
      
      // Basic search
      if (query.trim()) {
        queryParams.append('search', query);
      }
      
      // Pagination
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.cursor) queryParams.append('cursor', params.cursor);
      
      // Advanced filters
      if (filters) {
        if (filters.category) queryParams.append('category', filters.category);
        if (filters.language && filters.language !== 'all') {
          queryParams.append('language', filters.language);
        }
        if (filters.dateFrom) queryParams.append('dateFrom', filters.dateFrom);
        if (filters.dateTo) queryParams.append('dateTo', filters.dateTo);
        if (filters.duration && filters.duration !== 'all') {
          queryParams.append('duration', filters.duration);
        }
        if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);
        if (filters.sortOrder) queryParams.append('sortOrder', filters.sortOrder);
      }
      
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
        throw new Error(`Error searching videos: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.search error:', error);
      
      // Fallback to basic search for backward compatibility
      if (query.trim()) {
        return this.list({ ...params }, headers);
      }
      
      return null;
    }
  }

  /**
   * Get Search Suggestions
   * GET /api/search/suggestions
   */
  static async getSearchSuggestions(
    query: string,
    limit: number = 5
  ): Promise<SearchSuggestion[]> {
    try {
      const queryParams = new URLSearchParams({
        q: query,
        limit: limit.toString()
      });
      
      const response = await fetch(
        `${baseUrl}/api/search/suggestions?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        // Return mock suggestions for development
        return this.getMockSuggestions(query);
      }

      return await response.json();
    } catch (error) {
      console.error('VideosAPI.getSearchSuggestions error:', error);
      return this.getMockSuggestions(query);
    }
  }

  /**
   * Get Trending Content
   * GET /api/trending
   */
  static async getTrending(
    period: 'hour' | 'day' | 'week' | 'month' = 'day',
    category?: string,
    limit: number = 20
  ): Promise<VideoObject[]> {
    try {
      const queryParams = new URLSearchParams({
        period,
        limit: limit.toString()
      });
      
      if (category) {
        queryParams.append('category', category);
      }
      
      const response = await fetch(
        `${baseUrl}/api/trending?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        // Return mock trending content for development
        return this.getMockTrendingVideos();
      }

      const data = await response.json() as { videos?: VideoObject[], data?: VideoObject[] };
      return data.videos || data.data || [];
    } catch (error) {
      console.error('VideosAPI.getTrending error:', error);
      return this.getMockTrendingVideos();
    }
  }

  /**
   * Get Recommended Videos
   * GET /api/recommendations
   */
  static async getRecommendations(
    request: RecommendationRequest,
    headers?: ApiHeaders
  ): Promise<VideoObject[]> {
    try {
      const queryParams = new URLSearchParams();
      
      if (request.videoId) queryParams.append('videoId', request.videoId);
      if (request.limit) queryParams.append('limit', request.limit.toString());
      if (request.excludeWatched) queryParams.append('excludeWatched', 'true');
      
      const response = await fetch(
        `${baseUrl}/api/recommendations?${queryParams.toString()}`,
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
        // Return mock recommendations for development
        return this.getMockRecommendations();
      }

      const data = await response.json() as { videos?: VideoObject[], data?: VideoObject[] };
      return data.videos || data.data || [];
    } catch (error) {
      console.error('VideosAPI.getRecommendations error:', error);
      return this.getMockRecommendations();
    }
  }

  // Mock data methods for development/demo
  private static getMockSuggestions(query: string): SearchSuggestion[] {
    const suggestions = [
      { text: 'Islamic lectures', type: 'category' as const, count: 150 },
      { text: 'Quran recitation', type: 'category' as const, count: 89 },
      { text: 'Islamic history', type: 'category' as const, count: 67 },
      { text: 'Prayer guidance', type: 'category' as const, count: 45 },
      { text: 'Islamic stories', type: 'category' as const, count: 34 }
    ];
    
    return suggestions
      .filter(s => s.text.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5);
  }

  private static getMockTrendingVideos(): VideoObject[] {
    return [
      {
        id: 'trending-1',
        title: 'Understanding Islamic Ethics in Modern Times',
        description: 'A comprehensive guide to applying Islamic principles in contemporary life',
        thumbnailUrl: '/api/placeholder/320/180',
        videoUrl: '#',
        userId: 'user-1',
        channel: 'Islamic Studies',
        channelId: 'channel-1',
        channelAvatarUrl: '/api/placeholder/40/40',
        channelName: 'Islamic Studies',
        dateCreated: new Date(Date.now() - 86400000).toISOString(),
        dateModified: new Date(Date.now() - 86400000).toISOString(),
        views: 15420,
        likesCount: 342,
        dislikesCount: 12,
        commentsCount: 89,
        isPublic: true,
        isLive: false
      }
    ];
  }

  private static getMockRecommendations(): VideoObject[] {
    return [
      {
        id: 'rec-1',
        title: 'Recommended: Islamic Architecture Through Ages',
        description: 'Explore the beautiful architectural heritage of Islamic civilization',
        thumbnailUrl: '/api/placeholder/320/180',
        videoUrl: '#',
        userId: 'user-2',
        channel: 'Islamic Heritage',
        channelId: 'channel-2',
        channelAvatarUrl: '/api/placeholder/40/40',
        channelName: 'Islamic Heritage',
        dateCreated: new Date(Date.now() - 172800000).toISOString(),
        dateModified: new Date(Date.now() - 172800000).toISOString(),
        views: 8734,
        likesCount: 234,
        dislikesCount: 8,
        commentsCount: 56,
        isPublic: true,
        isLive: false
      }
    ];
  }
}