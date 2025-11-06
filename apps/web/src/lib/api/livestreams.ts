import { LiveStream } from "@/interfaces";
import {
  ApiResponse,
  PaginationResponse,
  LiveStreamCreateRequest,
  LiveStreamUpdateRequest,
  LiveStreamQueryParams,
  ApiHeaders,
} from "./types";

// Get API URL - log error if not configured but don't crash the app
const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL;
if (!baseUrl) {
  console.error(
    '[LiveStreamsAPI] NEXT_PUBLIC_API_URL or API_URL environment variable is not configured. API calls will fail.'
  );
}

export class LiveStreamsAPI {
  /**
   * List Live Streams
   * GET /api/live-streams
   */
  static async list(
    params?: LiveStreamQueryParams,
    headers?: ApiHeaders
  ): Promise<ApiResponse<PaginationResponse<LiveStream>> | null> {
    if (!baseUrl) {
      console.error('[LiveStreamsAPI.list] API URL not configured');
      return null;
    }

    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.cursor) queryParams.append('cursor', params.cursor);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.channelId) queryParams.append('channelId', params.channelId);

      const response = await fetch(
        `${baseUrl}/api/live-streams?${queryParams.toString()}`,
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
        throw new Error(`Error fetching live streams: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[LiveStreamsAPI.list]', error);
      return null;
    }
  }

  /**
   * Create a new Live Stream
   * POST /api/live-streams
   */
  static async create(
    data: LiveStreamCreateRequest,
    authToken: string
  ): Promise<ApiResponse<{ stream: LiveStream }> | null> {
    if (!baseUrl) {
      console.error('[LiveStreamsAPI.create] API URL not configured');
      return null;
    }

    // Input validation
    if (!authToken || authToken.trim() === '') {
      console.error('[LiveStreamsAPI.create] authToken is required');
      return null;
    }
    if (!data || typeof data !== 'object') {
      console.error('[LiveStreamsAPI.create] data is required and must be an object');
      return null;
    }

    try {
      const response = await fetch(
        `${baseUrl}/api/live-streams`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Error creating live stream: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[LiveStreamsAPI.create]', error);
      return null;
    }
  }

  /**
   * Update a Live Stream
   * PATCH /api/live-streams/{id}
   */
  static async update(
    streamId: string,
    data: LiveStreamUpdateRequest,
    authToken: string
  ): Promise<ApiResponse<{ stream: LiveStream }> | null> {
    if (!baseUrl) {
      console.error('[LiveStreamsAPI.update] API URL not configured');
      return null;
    }

    // Input validation
    if (!streamId || streamId.trim() === '') {
      console.error('[LiveStreamsAPI.update] streamId is required');
      return null;
    }
    if (!authToken || authToken.trim() === '') {
      console.error('[LiveStreamsAPI.update] authToken is required');
      return null;
    }
    if (!data || typeof data !== 'object') {
      console.error('[LiveStreamsAPI.update] data is required and must be an object');
      return null;
    }

    try {
      const response = await fetch(
        `${baseUrl}/api/live-streams/${streamId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Error updating live stream: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[LiveStreamsAPI.update]', error);
      return null;
    }
  }

  /**
   * Go Live - Update stream status to 'live'
   */
  static async goLive(
    streamId: string,
    authToken: string
  ): Promise<ApiResponse<{ stream: LiveStream }> | null> {
    return this.update(
      streamId,
      { status: 'live', actualStartTime: new Date().toISOString() },
      authToken
    );
  }

  /**
   * End Live Stream - Update stream status to 'ended'
   */
  static async endStream(
    streamId: string,
    authToken: string
  ): Promise<ApiResponse<{ stream: LiveStream }> | null> {
    return this.update(
      streamId,
      { status: 'ended', actualEndTime: new Date().toISOString() },
      authToken
    );
  }

  /**
   * Cancel Live Stream
   */
  static async cancelStream(
    streamId: string,
    authToken: string
  ): Promise<ApiResponse<{ stream: LiveStream }> | null> {
    return this.update(
      streamId,
      { status: 'cancelled' },
      authToken
    );
  }

  /**
   * Get currently live streams
   */
  static async getLiveNow(
    limit: number = 12
  ): Promise<LiveStream[]> {
    try {
      const response = await this.list({
        status: 'live',
        limit,
      });

      if (!response || !response.success || !response.result) {
        return [];
      }

      return response.result.data || [];
    } catch (error) {
      console.error('[LiveStreamsAPI.getLiveNow]', error);
      return [];
    }
  }

  /**
   * Get scheduled streams
   */
  static async getScheduled(
    limit: number = 12
  ): Promise<LiveStream[]> {
    try {
      const response = await this.list({
        status: 'scheduled',
        limit,
      });

      if (!response || !response.success || !response.result) {
        return [];
      }

      return response.result.data || [];
    } catch (error) {
      console.error('[LiveStreamsAPI.getScheduled]', error);
      return [];
    }
  }

  /**
   * Get streams by channel
   */
  static async getByChannel(
    channelId: string,
    status?: 'scheduled' | 'live' | 'ended' | 'cancelled',
    limit: number = 20
  ): Promise<LiveStream[]> {
    // Input validation
    if (!channelId || channelId.trim() === '') {
      console.error('[LiveStreamsAPI.getByChannel] channelId is required');
      return [];
    }

    try {
      const response = await this.list({
        channelId,
        status,
        limit,
      });

      if (!response || !response.success || !response.result) {
        return [];
      }

      return response.result.data || [];
    } catch (error) {
      console.error('[LiveStreamsAPI.getByChannel]', error);
      return [];
    }
  }
}
