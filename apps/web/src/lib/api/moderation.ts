'use server';

import { ApiHeaders } from "./types";
import { buildApiUrl } from "./api-client";
import { getServerAuthContext } from "./server-auth";
import { logger } from '@/lib/logger-server';

/** Entity types accepted by api-videos ReportInput */
export type ReportContentType = 'video' | 'comment' | 'channel' | 'livestream';

/** Reasons accepted by api-videos ReportInput */
export type ReportReason = 'inappropriate' | 'spam' | 'harassment' | 'copyright' | 'misinformation' | 'other';

// Types for user-facing report creation
export interface ReportCreateRequest {
  contentType: ReportContentType;
  contentId: string;
  reason: ReportReason;
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

export type ReportCreateErrorCode = 'auth' | 'duplicate' | 'invalid' | 'failed' | 'human_check' | 'rate_limited';

/**
 * Server actions cannot surface thrown error messages to the client in
 * production builds, so failures are returned as codes.
 */
export interface ReportCreateResult {
  success: boolean;
  report?: ReportCreateResponse;
  error?: ReportCreateErrorCode;
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
  headers?: ApiHeaders,
  /** Turnstile token (hooks/useHumanCheck); reports always need one when the check is on */
  turnstileToken?: string
): Promise<ReportCreateResult> {
  try {
    const auth = await getServerAuthContext();
    if (!auth?.accessToken) {
      logger.warn('[createReport] No authenticated session');
      return { success: false, error: 'auth' };
    }

    // The channelId header must be a channel the reporter owns (api-videos
    // verifies ownership), so use the session's active channel.
    const reporterChannelId = auth.channelId || headers?.channelId;
    const description = [reportData.customReason, reportData.description].filter(Boolean).join(' — ') || undefined;

    const response = await fetch(buildApiUrl('/api/moderation/reports'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.accessToken}`,
        ...(reporterChannelId && { 'channelId': reporterChannelId }),
        ...(turnstileToken && { 'X-Turnstile-Token': turnstileToken }),
      },
      body: JSON.stringify({
        entityType: reportData.contentType,
        entityId: reportData.contentId,
        reason: reportData.reason,
        description,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.warn('[createReport] API rejected report', { status: response.status, error: errorData?.error });
      if (response.status === 401) return { success: false, error: 'auth' };
      if (response.status === 409) return { success: false, error: 'duplicate' };
      // Bot protection (api-videos middleware/bot-protection.ts)
      if (response.status === 403 && errorData?.code === 'human_check_required') return { success: false, error: 'human_check' };
      if (response.status === 429 && errorData?.code === 'rate_limited') return { success: false, error: 'rate_limited' };
      if (response.status === 400) return { success: false, error: 'invalid' };
      return { success: false, error: 'failed' };
    }

    const data: ReportApiResponse = await response.json();
    logger.debug('[createReport] Report created', { entityType: reportData.contentType, entityId: reportData.contentId });
    return { success: true, report: data.result?.report };
  } catch (error) {
    logger.error('createReport failed:', error);
    return { success: false, error: 'failed' };
  }
}
