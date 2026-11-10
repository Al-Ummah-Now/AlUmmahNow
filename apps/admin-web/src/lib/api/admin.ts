'use server';

import type { Report, ReportStats } from '@al-ummah/shared-types';
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
  ContactCounts,
  ContactListResponse,
  ContactMessage,
  ContactNote,
  ContactStatus,
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

// ---------- Site settings ----------

export interface SiteThemeState {
  /** A built-in id or a theme package id */
  theme: string;
  /** The published version of a theme package; null for a built-in */
  version: string | null;
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export async function getSiteThemeState(): Promise<SiteThemeState> {
  return (await requestAdmin('/api/site-settings/theme')).result as SiteThemeState;
}

export interface SiteThemeChange {
  id: string;
  oldValue: string | null;
  newValue: string;
  actorId: string;
  createdAt: string;
}

/** The audit log of theme changes, newest first. */
export async function getSiteThemeHistory(limit = 10): Promise<SiteThemeChange[]> {
  return ((await requestAdmin(`/api/site-settings/theme/history?limit=${limit}`)).result as { entries: SiteThemeChange[] }).entries;
}

/** A built-in theme by id, or a published theme package with its version. */
export async function setSiteTheme(theme: string, version?: string | null): Promise<SiteThemeState> {
  return (await requestAdmin('/api/site-settings/theme', { method: 'PUT', body: JSON.stringify(version ? { theme, version } : { theme }) })).result as SiteThemeState;
}

// ---------- Theme packages (the theme builder) ----------

export interface ThemeListItem {
  id: string;
  name: { en: string; ar: string };
  builtIn: boolean;
  kind: string;
  basedOn: string | null;
  latestVersion: string | null;
  draftUpdatedAt: string | null;
  versions: { version: string; publishedAt?: string; publishedBy?: string; size?: number }[];
  active: boolean;
  activeVersion?: string | null;
}

export async function listThemes(): Promise<{ active: { id: string; version: string | null }; themes: ThemeListItem[] }> {
  return (await requestAdmin('/api/themes')).result as { active: { id: string; version: string | null }; themes: ThemeListItem[] };
}

export interface ThemeDetail {
  id: string;
  theme: Record<string, unknown> | null;
  assets: { path: string; size: number }[];
  validation: { ok: boolean; errors: { path: string; message: string }[]; warnings: { path: string; message: string }[] } | null;
  versions: { version: string; published_at: string; published_by: string; size_bytes: number }[];
  latestVersion: string | null;
  active: boolean;
  activeVersion: string | null;
}

export async function getThemeDetail(id: string): Promise<ThemeDetail> {
  return (await requestAdmin(`/api/themes/${encodeURIComponent(id)}`)).result as ThemeDetail;
}

// ---------- Contact us inbox ----------

export interface ContactFilters {
  status?: string;
  topic?: string;
  from?: string;
  to?: string;
  q?: string;
  assignee?: string;
  limit?: number;
  offset?: number;
}

export async function listContactMessages(filters: ContactFilters = {}): Promise<ContactListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return fetchAdmin<ContactListResponse>(`/api/contact/messages${query ? `?${query}` : ''}`);
}

export async function getContactCounts(): Promise<ContactCounts> {
  return fetchAdmin<ContactCounts>('/api/contact/counts');
}

export async function getContactMessage(id: string): Promise<{ message: ContactMessage; notes: ContactNote[] }> {
  return fetchAdmin<{ message: ContactMessage; notes: ContactNote[] }>(`/api/contact/messages/${encodeURIComponent(id)}`);
}

/** Status and/or assignee ("me" assigns to the caller, null unassigns). */
export async function updateContactMessage(
  id: string,
  patch: { status?: ContactStatus; assignee?: 'me' | null },
): Promise<ActionResult<{ message: ContactMessage }>> {
  return mutate(`/api/contact/messages/${encodeURIComponent(id)}`, 'PATCH', patch);
}

export async function addContactNote(id: string, body: string): Promise<ActionResult<{ note: ContactNote }>> {
  return mutate(`/api/contact/messages/${encodeURIComponent(id)}/notes`, 'POST', { body });
}

export async function replyToContactMessage(id: string, body: string): Promise<ActionResult<{ note: ContactNote; message: ContactMessage }>> {
  return mutate(`/api/contact/messages/${encodeURIComponent(id)}/reply`, 'POST', { body });
}

export async function deleteContactMessage(id: string): Promise<ActionResult<{ deleted: string }>> {
  try {
    const data = await fetchAdmin<{ deleted: string }>(`/api/contact/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
