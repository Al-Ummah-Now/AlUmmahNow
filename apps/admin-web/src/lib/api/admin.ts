'use server';

import type {
  Report,
  ReportStatus,
  ReportableEntityType,
  ModerationAction,
  ReportStats,
} from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

export interface ListReportsParams {
  status?: ReportStatus;
  entity_type?: ReportableEntityType;
  limit?: number;
  offset?: number;
}

export interface ListReportsResponse {
  reports: Report[];
  total: number;
  limit: number;
  offset: number;
}

export interface TakeActionParams {
  action: ModerationAction;
  notes?: string;
}

export interface ActionResponse {
  report: Report;
  contentAction: {
    performed: boolean;
    action: string;
    notes?: string;
  };
}

async function fetchAdmin<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // Get session for auth token
  const session = await getAdminSession();

  if (!session) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${ADMIN_API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.accessToken}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Admin API error: ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Admin API request failed');
  }

  return data.result;
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
  return fetchAdmin<ReportStats>('/api/moderation/stats');
}
