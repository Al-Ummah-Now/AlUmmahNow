'use server';

/**
 * The video review queue (admin-api /api/review/*; docs/specs/VIDEO-REVIEW.md §6-7). The native
 * admin app calls the same API directly.
 */
import type { VideoReviewSettings } from '@al-ummah/shared-types';
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';

export type ReviewTab = 'action_needed' | 'checking' | 'history' | 'shadow';

export interface ReviewRowView {
  id: string;
  subject_type: string;
  subject_id: string;
  channel_id: string | null;
  owner_id: string | null;
  status: string;
  mode: string;
  timing: string;
  trigger: string | null;
  route: string | null;
  risk: number | null;
  nsfw: number;
  escalate: number;
  hold_cause: string | null;
  top_category: string | null;
  findings_count: number;
  partial: number;
  created_at: string;
  checked_at: string | null;
  sla_due_at: string | null;
  assigned_to: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision: string | null;
  reason_code: string | null;
  note: string | null;
  undo_until: string | null;
  appeal_of: string | null;
  appeal_message: string | null;
}

export interface ReviewFindingView {
  id: string;
  source: string;
  category: string;
  score: number;
  at_ms: number | null;
  end_ms: number | null;
  media_key: string | null;
  text: string | null;
  quran_ref: string | null;
  model: string;
  rationale: string | null;
}

export interface ReviewDetailView {
  review: ReviewRowView;
  findings: ReviewFindingView[];
  history: Array<{ id: string; status: string; decision: string | null; reason_code: string | null; decided_at: string | null; created_at: string; appeal_of: string | null }>;
  /** `playUrl`/`posterUrl`: a live stream's recording (VR9), signed by api-videos */
  subject: { id: string; title: string; description: string; tags: string[]; channelId?: string; ownerId?: string; duration?: number; currentStatus: string | null; playUrl?: string | null; posterUrl?: string | null } | null;
  manifestKey: string | null;
}

export interface ReviewStatsView {
  open: Record<string, number>;
  oldestWaitingSince: string | null;
  queueMinutes: number | null;
  todayCostUsd: number;
  shadow14d: { checked: number; wouldHold: number; nsfw: number };
}

export interface ReviewSettingsView {
  settings: VideoReviewSettings;
  effectiveMode: VideoReviewSettings['mode'];
  allowedHere: boolean;
}

export async function listReviewQueue(tab: ReviewTab, cursor?: string): Promise<{ items: ReviewRowView[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ tab, ...(cursor ? { cursor } : {}) });
  return fetchAdmin(`/api/review/queue?${q}`);
}

export async function getReviewDetail(id: string): Promise<ReviewDetailView> {
  return fetchAdmin(`/api/review/${encodeURIComponent(id)}`);
}

export async function getReviewStats(): Promise<ReviewStatsView> {
  return fetchAdmin('/api/review/stats');
}

export async function getReviewSettings(): Promise<ReviewSettingsView> {
  return fetchAdmin('/api/review/settings');
}

export async function updateReviewSettings(patch: Partial<VideoReviewSettings>): Promise<ActionResult<ReviewSettingsView>> {
  return toResult(() => fetchAdmin<ReviewSettingsView>('/api/review/settings', { method: 'PUT', body: JSON.stringify(patch) }));
}

/** `locale`: the admin's UI language, used for the creator's email when they never picked one (#1279). */
export async function decideReview(id: string, decision: 'approve' | 'reject' | 'escalate' | 'undo', reasonCode?: string, note?: string, locale?: 'en' | 'ar'): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`/api/review/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ decision, ...(reasonCode ? { reasonCode } : {}), ...(note ? { note } : {}), ...(locale ? { locale } : {}) }) }));
}

export async function revealReviewItem(id: string, target: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`/api/review/${encodeURIComponent(id)}/reveal`, { method: 'POST', body: JSON.stringify({ target }) }));
}

export async function claimReview(id: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`/api/review/${encodeURIComponent(id)}/claim`, { method: 'POST', body: '{}' }));
}

export async function getReviewAlerts(): Promise<{ alerts: boolean }> {
  return fetchAdmin('/api/review/alerts');
}

export async function setReviewAlerts(on: boolean): Promise<ActionResult<{ alerts: boolean }>> {
  return toResult(() => fetchAdmin<{ alerts: boolean }>('/api/review/alerts', { method: 'POST', body: JSON.stringify({ on }) }));
}
