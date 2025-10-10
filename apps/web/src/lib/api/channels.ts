import { Profile } from "@/interfaces";
import { 
  ApiResponse,
  ProfileUpdateRequest,
  ApiHeaders,
  ListQueryParams,
  ChannelCreateRequest,
  ChannelUpdateRequest,
  SubscriptionRequest,
  PaginationResponse
} from "./types";

const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://videos.api.alummahnow.net";

export class ProfilesAPI {
  /**
   * Get a user's profile by ID
   * GET /api/profiles/{id}
   */
  static async getCurrent(
    userId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<Profile | null> {
    try {
      const url = `${baseUrl}/api/profiles/${userId}`;
      console.log('ProfilesAPI.getCurrent: Calling', url, 'with headers:', headers);
      
      const response = await fetch(
        url,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'channelId': headers.channelId,
            'userId': headers.userId,
          },
        }
      );

      console.log('ProfilesAPI.getCurrent: Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('ProfilesAPI.getCurrent: Error response:', response.status, response.statusText, errorText);
        throw new Error(`Error fetching profile: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('ProfilesAPI.getCurrent: Success response:', result);
      
      // Handle different response formats
      if (result && typeof result === 'object') {
        const resultAny = result as any;
        
        // If it's already a Profile object
        if (resultAny.id && resultAny.email) {
          return resultAny as Profile;
        }
        // If it's wrapped in a success/result structure
        if (resultAny.success && resultAny.result && resultAny.result.profile) {
          return resultAny.result.profile as Profile;
        }
        // If it's wrapped differently
        if (resultAny.profile) {
          return resultAny.profile as Profile;
        }
      }
      
      console.log('ProfilesAPI.getCurrent: Response format not recognized, returning null');
      return null;
    } catch (error) {
      console.error('ProfilesAPI.getCurrent error:', error);
      return null;
    }
  }

  /**
   * Update the current user's profile
   * PUT /api/profile
   */
  static async update(
    data: ProfileUpdateRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ profile: Profile }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/profile`,
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
        throw new Error(`Error updating profile: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ProfilesAPI.update error:', error);
      return null;
    }
  }

  /**
   * Delete the current user's profile
   * DELETE /api/profile
   */
  static async delete(
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/profile`,
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
        throw new Error(`Error deleting profile: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ProfilesAPI.delete error:', error);
      return null;
    }
  }
}

export class ChannelsAPI {
  /**
   * List channels
   * GET /api/channels
   */
  static async list(
    params?: ListQueryParams,
    headers?: ApiHeaders
  ): Promise<PaginationResponse<any> | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.cursor) queryParams.append('cursor', params.cursor);
      
      const response = await fetch(
        `${baseUrl}/api/channels?${queryParams.toString()}`,
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
        throw new Error(`Error fetching channels: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ChannelsAPI.list error:', error);
      return null;
    }
  }

  /**
   * Get a channel by id
   * GET /api/channels/{id}
   */
  static async getById(
    id: string,
    headers?: ApiHeaders
  ): Promise<any | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/channels/${id}`,
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
        throw new Error(`Error fetching channel: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ChannelsAPI.getById error:', error);
      return null;
    }
  }

  /**
   * Create a new channel
   * POST /api/channels
   */
  static async create(
    data: ChannelCreateRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ channel: any }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/channels`,
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
        throw new Error(`Error creating channel: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ChannelsAPI.create error:', error);
      return null;
    }
  }

  /**
   * Update a channel
   * PUT /api/channels/{id}
   */
  static async update(
    id: string,
    data: ChannelUpdateRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<ApiResponse<{ channel: any }> | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/channels/${id}`,
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
        throw new Error(`Error updating channel: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ChannelsAPI.update error:', error);
      return null;
    }
  }

  /**
   * Delete a channel
   * DELETE /api/channels/{id}
   */
  static async delete(
    id: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/channels/${id}`,
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
        throw new Error(`Error deleting channel: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ChannelsAPI.delete error:', error);
      return null;
    }
  }

  /**
   * Subscribe to a channel
   * POST /api/channels/{id}/subscribe
   */
  static async subscribe(
    channelId: string,
    data: SubscriptionRequest,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/channels/${channelId}/subscribe`,
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
        throw new Error(`Error subscribing to channel: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ChannelsAPI.subscribe error:', error);
      return null;
    }
  }

  /**
   * Unsubscribe from a channel
   * DELETE /api/channels/{id}/subscribe
   */
  static async unsubscribe(
    channelId: string,
    headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
  ): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/channels/${channelId}/subscribe`,
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
        throw new Error(`Error unsubscribing from channel: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ChannelsAPI.unsubscribe error:', error);
      return null;
    }
  }
}