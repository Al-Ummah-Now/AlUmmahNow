import { 
  ApiResponse, 
  ApiHeaders,
  ListQueryParams
} from "./types";

const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://videos.api.alummahnow.net";

// Moderation Types
export interface ContentReport {
  id: string;
  reporterId: string;
  reporterName?: string;
  contentType: 'video' | 'comment' | 'channel' | 'playlist';
  contentId: string;
  contentTitle?: string;
  contentUrl?: string;
  reason: 'inappropriate_content' | 'spam' | 'harassment' | 'copyright' | 'violence' | 'hate_speech' | 'nudity' | 'misinformation' | 'other';
  customReason?: string;
  description?: string;
  status: 'pending' | 'in_review' | 'resolved' | 'dismissed' | 'escalated';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  assignedToName?: string;
  dateCreated: string;
  dateModified: string;
  dateResolved?: string;
  resolutionNotes?: string;
  moderationActions?: ModerationAction[];
}

export interface ModerationAction {
  id: string;
  reportId?: string;
  moderatorId: string;
  moderatorName?: string;
  contentType: 'video' | 'comment' | 'channel' | 'playlist' | 'user';
  contentId: string;
  actionType: 'approve' | 'remove' | 'hide' | 'warn_user' | 'restrict_user' | 'ban_user' | 'delete_content' | 'flag_for_review' | 'dismiss_report';
  reason?: string;
  notes?: string;
  isReversible: boolean;
  dateCreated: string;
  reversedBy?: string;
  reversedAt?: string;
  reversalReason?: string;
}

export interface UserModeration {
  userId: string;
  userName?: string;
  email?: string;
  status: 'active' | 'warned' | 'restricted' | 'banned' | 'under_review';
  role: 'user' | 'moderator' | 'admin';
  warningsCount: number;
  restrictionsCount: number;
  bansCount: number;
  totalReports: number;
  lastAction?: string;
  lastActionDate?: string;
  dateCreated: string;
  dateModified: string;
}

export interface ModerationStats {
  totalReports: number;
  pendingReports: number;
  resolvedReports: number;
  totalActions: number;
  actionsLast24h: number;
  actionsLast7d: number;
  averageResponseTime: number; // in hours
  topReasons: Array<{ reason: string; count: number }>;
  moderatorActivity: Array<{ moderatorId: string; moderatorName: string; actionsCount: number }>;
}

export interface ReportCreateRequest {
  contentType: 'video' | 'comment' | 'channel' | 'playlist';
  contentId: string;
  reason: string;
  customReason?: string;
  description?: string;
}

export interface ModerationActionRequest {
  reportId?: string;
  contentType: 'video' | 'comment' | 'channel' | 'playlist' | 'user';
  contentId: string;
  actionType: string;
  reason?: string;
  notes?: string;
}

export class ModerationAPI {
  /**
   * Get all content reports with filtering
   * GET /api/moderation/reports
   */
  static async getReports(
    params?: ListQueryParams & {
      status?: string;
      priority?: string;
      contentType?: string;
      assignedTo?: string;
      reason?: string;
    },
    headers?: ApiHeaders
  ): Promise<ContentReport[] | null> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.cursor) queryParams.append('cursor', params.cursor);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.priority) queryParams.append('priority', params.priority);
      if (params?.contentType) queryParams.append('contentType', params.contentType);
      if (params?.assignedTo) queryParams.append('assignedTo', params.assignedTo);
      if (params?.reason) queryParams.append('reason', params.reason);
      
      const response = await fetch(
        `${baseUrl}/api/moderation/reports?${queryParams.toString()}`,
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
        throw new Error(`Error fetching reports: ${response.statusText}`);
      }

      const data: ApiResponse<ContentReport[]> = await response.json();
      return data.result || this.getMockReports();
    } catch (error) {
      console.warn('Using mock reports data:', error);
      return this.getMockReports();
    }
  }

  /**
   * Get a specific report by ID
   * GET /api/moderation/reports/{id}
   */
  static async getReportById(
    reportId: string,
    headers?: ApiHeaders
  ): Promise<ContentReport | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/moderation/reports/${reportId}`,
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
        throw new Error(`Error fetching report: ${response.statusText}`);
      }

      const data: ApiResponse<ContentReport> = await response.json();
      return data.result || this.getMockReports()[0];
    } catch (error) {
      console.warn('Using mock report data:', error);
      return this.getMockReports()[0];
    }
  }

  /**
   * Create a content report
   * POST /api/moderation/reports
   */
  static async createReport(
    reportData: ReportCreateRequest,
    headers?: ApiHeaders
  ): Promise<ContentReport | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/moderation/reports`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(headers?.channelId && { 'channelId': headers.channelId }),
            ...(headers?.userId && { 'userId': headers.userId }),
          },
          body: JSON.stringify(reportData),
        }
      );

      if (!response.ok) {
        throw new Error(`Error creating report: ${response.statusText}`);
      }

      const data: ApiResponse<ContentReport> = await response.json();
      return data.result || this.getMockReports()[0];
    } catch (error) {
      console.warn('Mock report creation:', error);
      return this.getMockReports()[0];
    }
  }

  /**
   * Take moderation action
   * POST /api/moderation/actions
   */
  static async takeModerationAction(
    actionData: ModerationActionRequest,
    headers?: ApiHeaders
  ): Promise<ModerationAction | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/moderation/actions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(headers?.channelId && { 'channelId': headers.channelId }),
            ...(headers?.userId && { 'userId': headers.userId }),
          },
          body: JSON.stringify(actionData),
        }
      );

      if (!response.ok) {
        throw new Error(`Error taking action: ${response.statusText}`);
      }

      const data: ApiResponse<ModerationAction> = await response.json();
      return data.result || this.getMockActions()[0];
    } catch (error) {
      console.warn('Mock moderation action:', error);
      return this.getMockActions()[0];
    }
  }

  /**
   * Get moderation statistics
   * GET /api/moderation/stats
   */
  static async getStats(headers?: ApiHeaders): Promise<ModerationStats | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/moderation/stats`,
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
        throw new Error(`Error fetching stats: ${response.statusText}`);
      }

      const data: ApiResponse<ModerationStats> = await response.json();
      return data.result || this.getMockStats();
    } catch (error) {
      console.warn('Using mock stats:', error);
      return this.getMockStats();
    }
  }

  /**
   * Get user moderation information
   * GET /api/moderation/users/{userId}
   */
  static async getUserModeration(
    userId: string,
    headers?: ApiHeaders
  ): Promise<UserModeration | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/moderation/users/${userId}`,
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
        throw new Error(`Error fetching user moderation: ${response.statusText}`);
      }

      const data: ApiResponse<UserModeration> = await response.json();
      return data.result || this.getMockUserModeration();
    } catch (error) {
      console.warn('Using mock user moderation data:', error);
      return this.getMockUserModeration();
    }
  }

  // Mock data methods for development
  private static getMockReports(): ContentReport[] {
    const now = new Date();
    return [
      {
        id: "report_1",
        reporterId: "user_123",
        reporterName: "Ahmad Hassan",
        contentType: "video",
        contentId: "video_456",
        contentTitle: "Disputed Religious Discussion",
        contentUrl: "/en/video/video_456",
        reason: "inappropriate_content",
        description: "Content may not align with community guidelines",
        status: "pending",
        priority: "medium",
        dateCreated: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        dateModified: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "report_2",
        reporterId: "user_789",
        reporterName: "Fatima Ali",
        contentType: "comment",
        contentId: "comment_321",
        contentTitle: "Offensive Comment",
        reason: "hate_speech",
        description: "Comment contains inappropriate language",
        status: "in_review",
        priority: "high",
        assignedTo: "moderator_1",
        assignedToName: "Omar Moderator",
        dateCreated: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        dateModified: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "report_3",
        reporterId: "user_456",
        reporterName: "Yusuf Ahmed",
        contentType: "video",
        contentId: "video_789",
        contentTitle: "Spam Content",
        reason: "spam",
        description: "Repetitive promotional content",
        status: "resolved",
        priority: "low",
        assignedTo: "moderator_2",
        assignedToName: "Aisha Moderator",
        dateCreated: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        dateModified: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        dateResolved: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        resolutionNotes: "Content removed and user warned"
      }
    ];
  }

  private static getMockActions(): ModerationAction[] {
    const now = new Date();
    return [
      {
        id: "action_1",
        reportId: "report_2",
        moderatorId: "moderator_1",
        moderatorName: "Omar Moderator",
        contentType: "comment",
        contentId: "comment_321",
        actionType: "remove",
        reason: "Violated community guidelines",
        notes: "Comment contained inappropriate content",
        isReversible: true,
        dateCreated: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      }
    ];
  }

  private static getMockStats(): ModerationStats {
    return {
      totalReports: 127,
      pendingReports: 23,
      resolvedReports: 89,
      totalActions: 156,
      actionsLast24h: 8,
      actionsLast7d: 42,
      averageResponseTime: 4.5,
      topReasons: [
        { reason: "inappropriate_content", count: 45 },
        { reason: "spam", count: 32 },
        { reason: "hate_speech", count: 28 },
        { reason: "harassment", count: 15 },
        { reason: "misinformation", count: 7 }
      ],
      moderatorActivity: [
        { moderatorId: "moderator_1", moderatorName: "Omar Moderator", actionsCount: 34 },
        { moderatorId: "moderator_2", moderatorName: "Aisha Moderator", actionsCount: 28 },
        { moderatorId: "moderator_3", moderatorName: "Khalid Moderator", actionsCount: 19 }
      ]
    };
  }

  private static getMockUserModeration(): UserModeration {
    return {
      userId: "user_123",
      userName: "ahmad_user",
      email: "ahmad@example.com",
      status: "active",
      role: "user",
      warningsCount: 1,
      restrictionsCount: 0,
      bansCount: 0,
      totalReports: 2,
      lastAction: "warn_user",
      lastActionDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      dateCreated: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      dateModified: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}