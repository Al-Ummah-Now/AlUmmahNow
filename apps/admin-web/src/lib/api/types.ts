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
  /** Set while an email of this message has finally failed to send */
  send_failed_at: string | null;
  delivery_error: string | null;
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
  email_error?: string | null;
  created_at: string;
}

export interface ContactListResponse {
  messages: ContactMessage[];
  total: number;
  limit: number;
  offset: number;
}

export type ContactCounts = Record<ContactStatus | 'send_failed', number>;
export type ContactMailKind = 'notify' | 'ack' | 'reply';

// Upload processing health (admin-api /api/processing; incident 2026-11-10)
export type ProcessingIssueKind = 'encode_failed' | 'needs_reupload' | 'stalled';
export interface ProcessingIssue { kind: ProcessingIssueKind; reason?: string; at: string }
export interface BunnyState { status?: number; encodeProgress?: number; availableResolutions?: string | null; length?: number; storageSize?: number; error?: string }
export interface ProcessingCheckState {
  loopId: string;
  startedAt: string;
  attempt: number;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  finishedAt?: string;
  outcome?: string;
  bunnyStatus?: number;
  bunnyProgress?: number;
  restarts?: number;
}
export interface ProcessingVideoRow {
  id: string;
  title?: string;
  channelId?: string;
  userId?: string;
  dateCreated?: string;
  dateModified?: string;
  uploadStatus?: string;
  isPublic?: boolean;
  availableResolutions: string[];
  thumbnailUrl?: string;
  processingIssue: ProcessingIssue | null;
  processingCheck: ProcessingCheckState | null;
  /** null: Bunny has no such video; undefined: not fetched */
  bunny?: BunnyState | null;
}
export interface ReconcilerStats {
  lastRunAt: string;
  scanned: number;
  notReady: number;
  loopsStarted: number;
  alreadyActive: number;
  flagged: { needsReupload: number; stalled: number; failed: number };
  errors: number;
  durationMs: number;
}
export interface ProcessingVideosResponse { items: ProcessingVideoRow[]; scanned: number; reconciler: ReconcilerStats | null }
export interface ProcessingDeadLetter { id: string; dlq: string; attempts: number; failureReason: string | null; receivedAt: string | number; videoId?: string }
export interface ProcessingErrorsResponse {
  videos: Pick<ProcessingVideoRow, 'id' | 'title' | 'channelId' | 'userId' | 'uploadStatus' | 'processingIssue' | 'dateCreated' | 'dateModified'>[];
  deadLetters: ProcessingDeadLetter[];
  reconciler: ReconcilerStats | null;
}
export interface SyncPreview {
  videoId: string;
  found?: boolean;
  plan?: { outcome: string; phase: string; patch: Record<string, unknown>; unset: string[]; reason?: string };
  bunny?: BunnyState | null;
  ours?: { uploadStatus?: string; availableResolutions?: string[] };
  started?: boolean;
  why?: string;
  error?: string;
}
export interface SyncResponse { dryRun: boolean; results: SyncPreview[] }
