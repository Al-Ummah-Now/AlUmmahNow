'use server';

import { ApiHeaders } from "./types";
import { getApiUrl } from "@/lib/runtime-config";
import { logger } from '@/lib/logger-server';

const baseUrl = getApiUrl();

// Types for user-facing report creation
export interface ReportCreateRequest {
  contentType: 'video' | 'comment' | 'channel' | 'playlist';
  contentId: string;
  reason: string;
  customReason?: string;
  description?: string;
}

export interface ReportCreateResponse {
  id: string;
  entityType: string;
  entityId: string;
  reason: string;
  status: string;
  dateCreated: string;
}

// API response type (matches api-videos response format)
interface ReportApiResponse {
  success: boolean;
  result?: { report: ReportCreateResponse };
  error?: string;
}

/**
 * Create a content report (user-facing endpoint)
 * POST /api/moderation/reports
 *
 * Note: Admin/moderator functions (list reports, take action, stats)
 * are available via the admin-api service.
 */
export async function createReport(
  reportData: ReportCreateRequest,
  headers?: ApiHeaders
): Promise<ReportCreateResponse | null> {
  try {
    const response = await fetch(
      `${baseUrl}/api/moderation/reports`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers?.channelId && { 'channelId': headers.channelId }),
        },
        body: JSON.stringify({
          entityType: reportData.contentType,
          entityId: reportData.contentId,
          reason: reportData.reason,
          description: reportData.description || reportData.customReason,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error creating report: ${response.statusText}`);
    }

    const data: ReportApiResponse = await response.json();
    return data.result?.report || null;
  } catch (error) {
    logger.error('createReport failed:', error);
    throw error;
  }
}
