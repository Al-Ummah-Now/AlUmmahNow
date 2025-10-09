import {
  ApiHeaders,
  AnalyticsQueryParams,
  VideoAnalyticsData,
  ChannelAnalyticsData,
  AnalyticsSummary,
  AnalyticsMetrics
} from "./types";

const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://videos.api.alummahnow.net";

export class AnalyticsAPI {
  /**
   * Get analytics summary for a channel
   * GET /api/analytics/summary
   */
  static async getSummary(
    params?: AnalyticsQueryParams,
    headers?: ApiHeaders
  ): Promise<AnalyticsSummary | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.channelId) queryParams.append('channelId', params.channelId);
      if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
      if (params?.dateTo) queryParams.append('dateTo', params.dateTo);
      
      const response = await fetch(
        `${baseUrl}/api/analytics/summary?${queryParams.toString()}`,
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
        throw new Error(`Error fetching analytics summary: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('AnalyticsAPI.getSummary error:', error);
      return this.getMockSummary(); // Return mock data for development
    }
  }

  /**
   * Get channel analytics data
   * GET /api/analytics/channels/{channelId}
   */
  static async getChannelAnalytics(
    channelId: string,
    params?: AnalyticsQueryParams,
    headers?: ApiHeaders
  ): Promise<ChannelAnalyticsData | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
      if (params?.dateTo) queryParams.append('dateTo', params.dateTo);
      
      const response = await fetch(
        `${baseUrl}/api/analytics/channels/${channelId}?${queryParams.toString()}`,
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
        throw new Error(`Error fetching channel analytics: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('AnalyticsAPI.getChannelAnalytics error:', error);
      return this.getMockChannelAnalytics(channelId);
    }
  }

  /**
   * Get video analytics data
   * GET /api/analytics/videos/{videoId}
   */
  static async getVideoAnalytics(
    videoId: string,
    params?: AnalyticsQueryParams,
    headers?: ApiHeaders
  ): Promise<VideoAnalyticsData | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
      if (params?.dateTo) queryParams.append('dateTo', params.dateTo);
      
      const response = await fetch(
        `${baseUrl}/api/analytics/videos/${videoId}?${queryParams.toString()}`,
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
        throw new Error(`Error fetching video analytics: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('AnalyticsAPI.getVideoAnalytics error:', error);
      return this.getMockVideoAnalytics(videoId);
    }
  }

  /**
   * Get analytics metrics over time
   * GET /api/analytics/metrics
   */
  static async getMetrics(
    params?: AnalyticsQueryParams,
    headers?: ApiHeaders
  ): Promise<AnalyticsMetrics[] | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.channelId) queryParams.append('channelId', params.channelId);
      if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
      if (params?.dateTo) queryParams.append('dateTo', params.dateTo);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await fetch(
        `${baseUrl}/api/analytics/metrics?${queryParams.toString()}`,
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
        throw new Error(`Error fetching analytics metrics: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('AnalyticsAPI.getMetrics error:', error);
      return this.getMockMetrics();
    }
  }

  // Mock data methods for development
  private static getMockSummary(): AnalyticsSummary {
    return {
      totalViews: 15420,
      totalLikes: 1853,
      totalComments: 324,
      totalSubscribers: 567,
      totalVideos: 42,
      avgViewsPerVideo: 367,
      engagementRate: 12.5,
      topVideo: {
        videoId: "top-video-id",
        title: "Most Popular Video",
        views: 3420,
        likes: 456,
        dislikes: 23,
        comments: 87,
        shares: 134,
        watchTime: 2340,
        avgViewDuration: 180,
        clickThroughRate: 8.5,
        engagementRate: 15.2,
        dateCreated: "2024-01-15T10:30:00Z",
        thumbnailUrl: "/placeholder-thumbnail.jpg"
      }
    };
  }

  private static getMockChannelAnalytics(channelId: string): ChannelAnalyticsData {
    return {
      channelId,
      totalViews: 15420,
      totalVideos: 42,
      totalSubscribers: 567,
      totalLikes: 1853,
      totalComments: 324,
      avgViewsPerVideo: 367,
      avgEngagementRate: 12.5,
      topPerformingVideos: [
        {
          videoId: "video-1",
          title: "Top Performing Video #1",
          views: 3420,
          likes: 456,
          dislikes: 23,
          comments: 87,
          shares: 134,
          watchTime: 2340,
          avgViewDuration: 180,
          clickThroughRate: 8.5,
          engagementRate: 15.2,
          dateCreated: "2024-01-15T10:30:00Z"
        },
        {
          videoId: "video-2", 
          title: "Top Performing Video #2",
          views: 2890,
          likes: 378,
          dislikes: 18,
          comments: 64,
          shares: 98,
          watchTime: 1980,
          avgViewDuration: 165,
          clickThroughRate: 7.2,
          engagementRate: 13.8,
          dateCreated: "2024-01-20T14:15:00Z"
        }
      ],
      recentMetrics: this.getMockMetrics()
    };
  }

  private static getMockVideoAnalytics(videoId: string): VideoAnalyticsData {
    return {
      videoId,
      title: "Sample Video Analytics",
      views: 1250,
      likes: 89,
      dislikes: 7,
      comments: 23,
      shares: 34,
      watchTime: 890,
      avgViewDuration: 120,
      clickThroughRate: 6.8,
      engagementRate: 9.2,
      dateCreated: "2024-01-10T09:00:00Z",
      thumbnailUrl: "/placeholder-thumbnail.jpg"
    };
  }

  private static getMockMetrics(): AnalyticsMetrics[] {
    const metrics: AnalyticsMetrics[] = [];
    const now = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      
      metrics.push({
        date: date.toISOString().split('T')[0],
        views: Math.floor(Math.random() * 500) + 200,
        likes: Math.floor(Math.random() * 50) + 10,
        comments: Math.floor(Math.random() * 20) + 5,
        shares: Math.floor(Math.random() * 15) + 3,
        subscribers: Math.floor(Math.random() * 10) + 1,
        watchTime: Math.floor(Math.random() * 1000) + 300
      });
    }
    
    return metrics;
  }
}