'use server';

import type { AdminJob, AdminJobStatus, LegacyRestorePlan, Report, ReportStats } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { fetchAdmin, requestAdmin } from './request';
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
  ProcessingErrorsResponse,
  ProcessingVideosResponse,
  SyncResponse,
  ContactMailKind,
  ReaperMode,
  ReaperSweep,
  StaleUploadActionResult,
  StaleUploadsResponse,
  CategorySuggestionList,
  CategorySuggestionStats,
  CategoryBulkResult,
  CategoryBackfillPage,
  CategorizeConfigView,
  FlaggedVideoList,
  VideoFormatRunView,
} from './types';

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

/** Queue a failed email (support notification, acknowledgement or a reply) again. */
export async function retryContactDelivery(id: string, kind: ContactMailKind, noteId?: string): Promise<ActionResult<unknown>> {
  return mutate(`/api/contact/messages/${encodeURIComponent(id)}/retry`, 'POST', { kind, ...(noteId ? { noteId } : {}) });
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

// Upload processing health (admin-api /api/processing; videos:processing)

export async function listProcessingVideos(params: { status?: string; channelId?: string } = {}): Promise<ProcessingVideosResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.channelId) query.set('channelId', params.channelId);
  const suffix = query.size ? `?${query}` : '';
  return fetchAdmin<ProcessingVideosResponse>(`/api/processing/videos${suffix}`);
}

export async function getProcessingErrors(): Promise<ProcessingErrorsResponse> {
  return fetchAdmin<ProcessingErrorsResponse>('/api/processing/errors');
}

/** dryRun (default) previews what a sync would change; apply queues each video's check. */
export async function syncProcessing(ids: string[], dryRun: boolean): Promise<ActionResult<SyncResponse>> {
  return mutate('/api/processing/sync', 'POST', { ids, dryRun });
}

export async function retryProcessing(ids: string[]): Promise<ActionResult<unknown>> {
  return mutate('/api/processing/retry', 'POST', { ids });
}

export async function markProcessingFailed(ids: string[], reason?: string): Promise<ActionResult<unknown>> {
  return mutate('/api/processing/mark-failed', 'POST', { ids, ...(reason ? { reason } : {}) });
}

// Admin jobs (heavy actions queued in api-videos; admin-api /api/content/jobs)

export async function listAdminJobs(params: { status?: AdminJobStatus; targetKind?: string; targetId?: string; limit?: number } = {}): Promise<AdminJob[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const suffix = query.size ? `?${query}` : '';
  return (await fetchAdmin<{ items: AdminJob[] }>(`/api/content/jobs${suffix}`)).items;
}

/** Queues a failed job again (it needs the permissions of the action it re-runs; audited). */
export async function retryAdminJob(id: string): Promise<ActionResult<AdminJob>> {
  return mutate(`/api/content/jobs/${encodeURIComponent(id)}/retry`, 'POST', {});
}

// Restore legacy profile fields (users:manage): dry run, then a queued job

export async function getLegacyRestorePlan(): Promise<LegacyRestorePlan> {
  return fetchAdmin<LegacyRestorePlan>('/api/content/legacy-profiles/plan');
}

/** Runs the current dry run (every planned profile); admin-api audits each profile first. */
export async function startLegacyRestore(): Promise<ActionResult<{ job: AdminJob }>> {
  return mutate('/api/content/legacy-profiles/restore', 'POST', {});
}

// Stale uploads: abandoned upload placeholders and Bunny orphans (admin-api videos:uploads)
export async function getStaleUploads(status?: string): Promise<StaleUploadsResponse> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchAdmin<StaleUploadsResponse>(`/api/uploads/stale${query}`);
}

export async function scanStaleUploads(): Promise<ActionResult<ReaperSweep>> {
  return mutate('/api/uploads/stale/scan', 'POST', {});
}

export async function deleteStaleUploads(ids: string[]): Promise<ActionResult<StaleUploadActionResult>> {
  return mutate('/api/uploads/stale/delete', 'POST', { ids });
}

export async function keepStaleUploads(ids: string[]): Promise<ActionResult<StaleUploadActionResult>> {
  return mutate('/api/uploads/stale/keep', 'POST', { ids });
}

export async function retryStaleUploads(ids: string[]): Promise<ActionResult<StaleUploadActionResult>> {
  return mutate('/api/uploads/stale/retry', 'POST', { ids });
}

export async function setReaperMode(mode: ReaperMode): Promise<ActionResult<{ mode: ReaperMode }>> {
  return mutate('/api/uploads/stale/mode', 'POST', { mode });
}

// ---------- AI category suggestions ----------

export async function listCategorySuggestions(params: { view?: string; category?: string; videoId?: string; limit?: number; offset?: number } = {}): Promise<CategorySuggestionList> {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') q.set(key, String(value));
  const query = q.toString();
  return fetchAdmin<CategorySuggestionList>(`/api/category-suggestions${query ? `?${query}` : ''}`);
}

export async function getCategorySuggestionStats(): Promise<CategorySuggestionStats> {
  return fetchAdmin<CategorySuggestionStats>('/api/category-suggestions/stats');
}

export async function acceptCategorySuggestions(videoIds: string[]): Promise<ActionResult<{ results: CategoryBulkResult[] }>> {
  return mutate('/api/category-suggestions/accept', 'POST', { videoIds });
}

export async function setVideoCategories(videoIds: string[], category: string): Promise<ActionResult<{ results: CategoryBulkResult[] }>> {
  return mutate('/api/category-suggestions/set', 'POST', { videoIds, category });
}

export async function retryCategorySuggestions(videoIds: string[]): Promise<ActionResult<{ results: CategoryBulkResult[] }>> {
  return mutate('/api/category-suggestions/retry', 'POST', { videoIds });
}

export async function runCategoryBackfill(params: { dryRun: boolean; cursor?: string }): Promise<ActionResult<CategoryBackfillPage>> {
  return mutate('/api/category-suggestions/backfill', 'POST', params);
}

export async function updateCategorizeConfig(patch: Partial<CategorizeConfigView>): Promise<ActionResult<CategorizeConfigView>> {
  return mutate('/api/category-suggestions/config', 'PUT', patch);
}

// Short vs video formats (admin-api /api/video-format; videos:format)

export async function getLatestVideoFormatRun(): Promise<VideoFormatRunView | null> {
  return fetchAdmin<VideoFormatRunView | null>('/api/video-format/runs/latest');
}

export async function startVideoFormatBackfill(dryRun: boolean): Promise<ActionResult<VideoFormatRunView>> {
  return mutate('/api/video-format/backfill', 'POST', { dryRun });
}

export async function listFlaggedVideoFormats(limit = 25, offset = 0): Promise<FlaggedVideoList> {
  return fetchAdmin<FlaggedVideoList>(`/api/video-format/flagged?limit=${limit}&offset=${offset}`);
}

export async function setVideoFormat(ids: string[], format: 'short' | 'video' | 'auto'): Promise<ActionResult<{ results: Array<{ id: string; changed: boolean; error?: string }> }>> {
  return mutate('/api/video-format/set', 'POST', { ids, format });
}
