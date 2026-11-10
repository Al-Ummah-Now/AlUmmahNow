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

// ---------- Contact us inbox (admin-api /api/contact) ----------

export type ContactStatus = 'new' | 'open' | 'replied' | 'closed' | 'spam';
export type ContactTopic = 'general' | 'account' | 'problem' | 'content' | 'partnership';

export interface ContactMessage {
  id: string;
  status: ContactStatus;
  topic: ContactTopic;
  name: string;
  email: string;
  message: string;
  user_id: string | null;
  locale: 'en' | 'ar';
  page_url: string | null;
  user_agent: string | null;
  assignee_id: string | null;
  assignee_email: string | null;
  notify_status: string | null;
  ack_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactNote {
  id: string;
  message_id: string;
  kind: 'note' | 'reply';
  body: string;
  author_id: string;
  author_email: string | null;
  email_to: string | null;
  email_subject: string | null;
  email_status: string | null;
  email_id: string | null;
  created_at: string;
}

export interface ContactListResponse {
  messages: ContactMessage[];
  total: number;
  limit: number;
  offset: number;
}

export type ContactCounts = Record<ContactStatus, number>;
