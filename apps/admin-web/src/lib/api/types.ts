/**
 * API Types for Admin Web
 *
 * Shared types used by admin API functions.
 * These are separated from server action files since 'use server'
 * files can only export async functions.
 */

import type { AiModerationConfig, AiUsageDay, ModerationCategoryPolicy, ModerationSignal } from '@al-ummah/shared-types';

import type {
  Report,
  ReportStatus,
  ReportableEntityType,
  ModerationAction,
} from '@al-ummah/shared-types';

// Moderation API types
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

// Video section index status (admin-api GET /api/indices?operation=status)
export interface IndexStatusEntry {
  name: string;
  lastUpdated: string;
  count: number;
  stale: boolean;
}

export interface IndexStats {
  indices: IndexStatusEntry[];
  totalVideos: number;
}

export interface ActionResponse {
  report: Report;
  contentAction: {
    performed: boolean;
    action: string;
    notes?: string;
  };
}

// ---------- AI moderation (Epic 28) ----------

export interface AiSignalList {
  signals: ModerationSignal[];
  total: number;
  limit: number;
  offset: number;
}

export interface AiAuditRow {
  id: string;
  action: string;
  actor_type: 'ai' | 'user';
  actor_id: string | null;
  model: string | null;
  category: string | null;
  score: number | null;
  reason: string | null;
  created_at: string;
}

export interface AiSubjectContent {
  available: boolean;
  text: string | null;
  hidden: boolean;
  hiddenByModeration: boolean;
  canHide: boolean;
}

export interface AiSignalDetail {
  signal: ModerationSignal;
  actions: AiAuditRow[];
  content: AiSubjectContent | null;
}

export type AiConfigView = AiModerationConfig & { updatedAt: string | null; updatedBy: string | null; canEdit?: boolean };

export interface AiConfigPatch {
  enabled?: boolean;
  dailyNeuronCap?: number;
  extensionsEnabled?: boolean;
  policies?: Record<string, Partial<ModerationCategoryPolicy>>;
}

export interface AiUsageView {
  days: number;
  since: string;
  rows: AiUsageDay[];
  today: { day: string; neurons: number; usd: number };
  dailyNeuronCap: number | null;
}
