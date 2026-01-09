'use server';

import type { Report, ReportStats } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import type {
  ListReportsParams,
  ListReportsResponse,
  TakeActionParams,
  ActionResponse,
} from './types';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

async function fetchAdmin<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const method = options.method || 'GET';
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  logger.info(`[API Request] ${method} ${endpoint}`, {
    requestId,
    url: `${ADMIN_API_URL}${endpoint}`,
    method,
    hasBody: !!options.body,
  });

  // Get session for auth token
  const session = await getAdminSession();

  if (!session) {
    logger.error(`[API Error] Not authenticated`, { requestId, endpoint });
    throw new Error('Not authenticated');
  }

  logger.debug(`[API Auth] Session retrieved`, {
    requestId,
    hasAccessToken: !!session.accessToken,
    tokenLength: session.accessToken?.length,
  });

  const url = `${ADMIN_API_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
        ...options.headers,
      },
    });

    logger.info(`[API Response] ${response.status} ${method} ${endpoint}`, {
      requestId,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: Record<string, unknown> = {};
      try {
        errorData = JSON.parse(errorBody);
      } catch {
        errorData = { raw: errorBody };
      }

      logger.error(`[API Error] ${response.status} ${method} ${endpoint}`, {
        requestId,
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      });

      throw new Error(
        (errorData as { error?: string }).error ||
        `Admin API error: ${response.statusText}`
      );
    }

    const data = await response.json();

    if (!data.success) {
      logger.error(`[API Error] Request failed (success=false)`, {
        requestId,
        endpoint,
        error: data.error,
        data,
      });
      throw new Error(data.error || 'Admin API request failed');
    }

    logger.debug(`[API Success] ${method} ${endpoint}`, {
      requestId,
      hasResult: !!data.result,
    });

    return data.result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Admin API error')) {
      throw error; // Re-throw API errors
    }

    logger.error(`[API Error] Network/fetch error`, {
      requestId,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function listReports(params?: ListReportsParams): Promise<ListReportsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.entity_type) searchParams.set('entity_type', params.entity_type);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const query = searchParams.toString();
  return fetchAdmin<ListReportsResponse>(`/api/moderation/reports${query ? `?${query}` : ''}`);
}

export async function getReport(reportId: string): Promise<{ report: Report }> {
  return fetchAdmin<{ report: Report }>(`/api/moderation/reports/${reportId}`);
}

export async function takeAction(reportId: string, params: TakeActionParams): Promise<ActionResponse> {
  return fetchAdmin<ActionResponse>(`/api/moderation/reports/${reportId}/action`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getStats(): Promise<ReportStats> {
  return fetchAdmin<ReportStats>('/api/moderation/reports/stats');
}
