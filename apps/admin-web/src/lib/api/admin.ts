'use server';

import type { EntitlementDefinition, EntitlementValue, Report, ReportStats } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { AdminApiError, type ActionResult } from './errors';
import type {
  ListReportsParams,
  ListReportsResponse,
  TakeActionParams,
  ActionResponse,
  IndexStats,
  AiSignalList,
  AiSignalDetail,
  AiConfigView,
  AiConfigPatch,
  AiUsageView,
  PlanAuditEntry,
  PlanDetail,
  PlanMigration,
  PlanRow,
  SubjectState,
} from './types';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

type ApiEnvelope = {
  success?: boolean;
  result?: unknown;
  error?: string;
  errors?: { message?: string }[];
  [key: string]: unknown;
};

function envelopeError(body: ApiEnvelope, fallback: string): string {
  return body.error || body.errors?.[0]?.message || fallback;
}

/**
 * Call admin-api with the session's bearer token and return the parsed JSON
 * envelope. Throws AdminApiError (with the HTTP status) on any failure.
 */
async function requestAdmin(endpoint: string, options: RequestInit = {}): Promise<ApiEnvelope> {
  const method = options.method || 'GET';
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const url = `${ADMIN_API_URL}${endpoint}`;

  logger.info(`[API Request] ${method} ${endpoint}`, { requestId, url, method, hasBody: !!options.body });

  const session = await getAdminSession();
  if (!session) {
    logger.error('[API Error] Not authenticated', { requestId, endpoint });
    throw new AdminApiError('Not authenticated', 401);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...options.headers,
      },
    });
  } catch (error) {
    logger.error('[API Error] Network/fetch error', {
      requestId,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AdminApiError('Admin API unreachable', 503);
  }

  const text = await response.text();
  let body: ApiEnvelope = {};
  try {
    body = text ? (JSON.parse(text) as ApiEnvelope) : {};
  } catch {
    body = { raw: text };
  }

  logger.info(`[API Response] ${response.status} ${method} ${endpoint}`, {
    requestId,
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok || body.success === false) {
    const message = envelopeError(body, `Admin API error: ${response.status} ${response.statusText}`);
    logger.error(`[API Error] ${response.status} ${method} ${endpoint}`, { requestId, status: response.status, error: message });
    throw new AdminApiError(message, response.ok ? 500 : response.status);
  }

  return body;
}

async function fetchAdmin<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const body = await requestAdmin(endpoint, options);
  return body.result as T;
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
  return fetchAdmin<{ report: Report }>(`/api/moderation/reports/${encodeURIComponent(reportId)}`);
}

/**
 * Server action used by the report page. Returns a result object instead of
 * throwing, because production builds redact server-action error messages.
 */
export async function takeAction(reportId: string, params: TakeActionParams): Promise<ActionResult<ActionResponse>> {
  try {
    const data = await fetchAdmin<ActionResponse>(`/api/moderation/reports/${encodeURIComponent(reportId)}/action`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AdminApiError) {
      return { ok: false, status: error.status, error: error.message };
    }
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getStats(): Promise<ReportStats> {
  return fetchAdmin<ReportStats>('/api/moderation/reports/stats');
}

export async function getIndexStatus(): Promise<IndexStats> {
  const body = await requestAdmin('/api/indices?operation=status');
  const stats = body.stats as IndexStats | undefined;
  return stats ?? { indices: [], totalVideos: 0 };
}

// ---------- AI moderation (Epic 28) ----------

export interface AiSignalFilters {
  review_status?: string | undefined;
  decision?: string | undefined;
  surface?: string | undefined;
  language?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function listAiSignals(filters: AiSignalFilters = {}): Promise<AiSignalList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return fetchAdmin<AiSignalList>(`/api/moderation/ai/signals${query ? `?${query}` : ''}`);
}

export async function getAiSignal(id: string): Promise<AiSignalDetail> {
  return fetchAdmin<AiSignalDetail>(`/api/moderation/ai/signals/${encodeURIComponent(id)}`);
}

async function mutate<T>(endpoint: string, method: string, body: unknown): Promise<ActionResult<T>> {
  try {
    const data = await fetchAdmin<T>(endpoint, { method, body: JSON.stringify(body) });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function reviewAiSignal(id: string, verdict: 'agree' | 'disagree', note?: string): Promise<ActionResult<unknown>> {
  return mutate(`/api/moderation/ai/signals/${encodeURIComponent(id)}/review`, 'POST', { verdict, ...(note ? { note } : {}) });
}

export async function setAiSignalVisibility(id: string, hidden: boolean, reason?: string): Promise<ActionResult<unknown>> {
  return mutate(`/api/moderation/ai/signals/${encodeURIComponent(id)}/visibility`, 'POST', { hidden, ...(reason ? { reason } : {}) });
}

export async function getAiConfig(): Promise<AiConfigView> {
  return fetchAdmin<AiConfigView>('/api/moderation/ai/config');
}

export async function updateAiConfig(patch: AiConfigPatch): Promise<ActionResult<AiConfigView>> {
  return mutate<AiConfigView>('/api/moderation/ai/config', 'PUT', patch);
}

export async function getAiUsage(days = 30): Promise<AiUsageView> {
  return fetchAdmin<AiUsageView>(`/api/moderation/ai/usage?days=${days}`);
}

// Plans & entitlements (Epic 27)
const planPath = (id: string) => `/api/plans/${encodeURIComponent(id)}`;
const subjectPath = (subject: string) => `/api/plans/subjects/${encodeURIComponent(subject)}`;

export async function getEntitlementCatalogue(): Promise<{ catalogue: EntitlementDefinition[] }> {
  return fetchAdmin('/api/plans/catalogue');
}
export async function listPlans(): Promise<{ plans: PlanRow[] }> {
  return fetchAdmin('/api/plans');
}
export async function getPlan(id: string): Promise<PlanDetail> {
  return fetchAdmin(planPath(id));
}
export async function createPlan(input: { slug: string; name_en: string; name_ar: string; audience: string; cloneFrom?: string }): Promise<ActionResult<PlanDetail>> {
  return mutate('/api/plans', 'POST', input);
}
export async function updatePlanDetails(id: string, input: { name_en: string; name_ar: string; is_public: boolean }): Promise<ActionResult<PlanDetail>> {
  return mutate(planPath(id), 'PATCH', input);
}
export async function setPlanValues(id: string, values: Record<string, EntitlementValue>): Promise<ActionResult<PlanDetail>> {
  return mutate(`${planPath(id)}/values`, 'PUT', { values });
}
export async function publishPlan(id: string): Promise<ActionResult<PlanDetail>> {
  return mutate(`${planPath(id)}/publish`, 'POST', {});
}
export async function archivePlan(id: string): Promise<ActionResult<PlanDetail>> {
  return mutate(`${planPath(id)}/archive`, 'POST', {});
}
export async function migratePlan(id: string, apply: boolean, reason: string): Promise<ActionResult<PlanMigration>> {
  return mutate(`${planPath(id)}/migrate`, 'POST', { apply, reason });
}
export async function getSubject(subject: string): Promise<SubjectState> {
  return fetchAdmin(subjectPath(subject));
}
export async function assignSubjectPlan(subject: string, input: { planId: string; status: 'active' | 'trialing'; expiresAt?: string | null; reason: string }): Promise<ActionResult<SubjectState>> {
  return mutate(`${subjectPath(subject)}/assignment`, 'PUT', input);
}
export async function cancelSubjectPlan(subject: string, reason: string): Promise<ActionResult<SubjectState>> {
  return mutate(`${subjectPath(subject)}/assignment/cancel`, 'POST', { reason });
}
export async function setSubjectOverride(subject: string, input: { key: string; value: EntitlementValue; expiresAt?: string | null; reason: string }): Promise<ActionResult<SubjectState>> {
  return mutate(`${subjectPath(subject)}/overrides`, 'PUT', input);
}
export async function removeSubjectOverride(subject: string, key: string, reason: string): Promise<ActionResult<SubjectState>> {
  return mutate(`${subjectPath(subject)}/overrides/remove`, 'POST', { key, reason });
}
export async function listPlanAudit(limit = 100): Promise<{ entries: PlanAuditEntry[] }> {
  return fetchAdmin(`/api/plans/audit?limit=${limit}`);
}
