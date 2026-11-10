/**
 * API Types for Admin Web
 *
 * Shared types used by admin API functions.
 * These are separated from server action files since 'use server'
 * files can only export async functions.
 */

import type { AdminJob, AiModerationConfig, AiUsageDay, ModerationCategoryPolicy, ModerationSignal, OwnershipDrift, SearchDrift, IndexRepair } from '@al-ummah/shared-types';

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
/** An account erasure step that failed after its retries (#616). */
export interface ErasureDeadLetter {
  id: string;
  step: 'UserDataErased' | 'ContactDataErase';
  userId?: string;
  attempts: number;
  failureReason: string | null;
  receivedAt: string | number;
}
export interface ProcessingErrorsResponse {
  videos: Pick<ProcessingVideoRow, 'id' | 'title' | 'channelId' | 'userId' | 'uploadStatus' | 'processingIssue' | 'dateCreated' | 'dateModified'>[];
  deadLetters: ProcessingDeadLetter[];
  /** Absent from older api-videos builds */
  erasureDeadLetters?: ErasureDeadLetter[];
  /** Thumbnail aspect repair runs that failed after their retries */
  thumbnailRuns?: ThumbnailRun[];
  /** Videos the latest every-video thumbnail check flagged and not fixed since (absent from older builds) */
  thumbnailFlagged?: ThumbnailFlagged | null;
  /** Ownership index short of the objects in R2 (admin lists miss content), per kind (absent from older builds) */
  indexDrift?: IndexDrift[];
  /** Search tables short of the indexable objects in R2, per entity (absent from older builds) */
  searchDrift?: SearchIndexDrift[];
  /** Per-object index repairs: pending count, failed ones (Retry) and the latest repair job (absent from older builds) */
  indexRepairs?: IndexRepairs | null;
  /** Latest reconcile/rebuild job of each index, with its progress (absent from older builds) */
  indexMaintenance?: { index: string; job: AdminJob }[];
  reconciler: ReconcilerStats | null;
}
/** A finished index pass found the admin lists' index short of what R2 holds; `rebuild` is the latest rebuild job. */
export type IndexDrift = OwnershipDrift & { rebuild: AdminJob | null };
/** A finished search reconcile pass found rows missing; `rebuild` is the latest reconcile job. */
export type SearchIndexDrift = SearchDrift & { rebuild: AdminJob | null };
export interface IndexRepairs { pending: number; failedTotal: number; failed: IndexRepair[]; job: AdminJob | null }
/** Index the Rebuild button targets: an ownership kind or a search table. */
export type IndexRebuildKind = 'video' | 'channel' | 'profile' | `search:${'video' | 'channel' | 'playlist' | 'post'}`;
/** Wrong-shape thumbnails an admin replaces by hand (imported or custom: never auto-replaced). */
export interface ThumbnailFlagged {
  runId: string;
  checkedAt: string;
  total: number;
  items: { videoId: string; reason?: string; title?: string; channelId?: string }[];
}
/** Per-video result of the thumbnail aspect check (api-videos lib/thumbnail/repair.ts). */
export type ThumbnailOutcome = 'ok' | 'replaced' | 'would_replace' | 'flagged' | 'skipped' | 'error';
export interface ThumbnailRunResult {
  dryRun: boolean;
  checked: number;
  counts: Partial<Record<ThumbnailOutcome, number>>;
  items: { videoId: string; outcome: ThumbnailOutcome; reason?: string; previousThumbnailUrl?: string }[];
}
/** A thumbnail repair run: an admin job (queued, retried, failed runs land on Errors). */
export interface ThumbnailRun {
  id: string;
  status: 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed';
  params: { dryRun?: boolean; ids?: string[] };
  attempts: number;
  lastError: string | null;
  result: Partial<ThumbnailRunResult> | null;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
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

// Stale uploads (admin-api /api/uploads/stale → api-videos /internal/uploads; lib/uploads/reaper.ts)
export type StaleUploadTarget = 'abandoned' | 'orphan';
export type StaleUploadStatus = 'checking' | 'would_delete' | 'deleted' | 'kept' | 'skipped' | 'failed';
export type ReaperMode = 'dry-run' | 'live';

export interface StaleUploadItem {
  videoId: string;
  target: StaleUploadTarget;
  status: StaleUploadStatus;
  reason?: string;
  nextCheckAt?: string;
  checks: number;
  firstSeenAt: string;
  lastCheckedAt?: string;
  updatedAt: string;
  bunny?: { title?: string; status?: number; dateUploaded?: string; storageSize?: number; encodeProgress?: number } | null;
  record?: { title?: string; channelId?: string; userId?: string; uploadStatus?: string; dateCreated?: string; lastActivityAt?: string } | null;
  offset?: { value: number | null; at: string };
  force?: boolean;
  actor?: string;
  keptBy?: string;
  keptAt?: string;
  attempts?: number;
  lastError?: string;
  failedAt?: string;
  deletedAt?: string;
}

export interface ReaperSweep {
  lastRunAt: string;
  mode: ReaperMode;
  recordsScanned: number;
  abandonedCandidates: number;
  bunnyScanned: number;
  bunnyTotal: number;
  orphanCandidates: number;
  loopsStarted: number;
  skipped: number;
  errors: number;
  nextBunnyPage: number;
  durationMs: number;
}

export interface ReaperDeleteRow {
  key: string;
  at: string;
  videoId: string;
  target: StaleUploadTarget;
  actor: string;
  mode: ReaperMode;
  force: boolean;
  reason: string;
  state: 'started' | 'done';
  bunnyDeleted?: boolean;
  recordAbandoned?: boolean;
}

export interface StaleUploadDeadLetter { id: string; dlq: string; attempts: number; failureReason: string | null; receivedAt: string | number; videoId?: string }

export interface StaleUploadsResponse {
  items: StaleUploadItem[];
  counts: Partial<Record<StaleUploadStatus, number>>;
  config: { mode: ReaperMode; updatedAt?: string; updatedBy?: string };
  sweep: ReaperSweep | null;
  audit: ReaperDeleteRow[];
  deadLetters: StaleUploadDeadLetter[];
}

export interface StaleUploadActionResult {
  results: { videoId: string; started?: boolean; kept?: boolean; why?: string }[];
}

// ---------- AI category suggestions (admin-api /api/category-suggestions) ----------

export type CategorySuggestionQueue = 'review' | 'needs_category' | 'flagged' | 'reviewed' | 'all';

export interface CategorySuggestionItem {
  videoId: string;
  status: 'pending' | 'done' | 'failed' | 'budget' | 'disabled' | 'empty';
  reason: string;
  category: string | null;
  confidence: number | null;
  options: Array<{ category: string; confidence: number }>;
  model: string | null;
  applied: boolean;
  outcome: 'pending' | 'accepted' | 'changed' | 'none';
  finalCategory: string | null;
  reviewedBy: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: number;
  video: { title: string | null; thumbnailUrl: string | null; channelName: string | null; channelId: string | null; isPublic: boolean | null; category: string | null; categorySource: string | null } | null;
}

export interface CategorySuggestionList {
  items: CategorySuggestionItem[];
  total: number;
  limit: number;
  offset: number;
  canEdit: boolean;
}

export interface CategorizeConfigView {
  enabled: boolean;
  dailyNeuronCap: number;
  threshold: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface CategorySuggestionStats {
  views: Record<CategorySuggestionQueue, number>;
  byStatus: Record<string, number>;
  byCategory: Array<{ category: string; videos: number; aiUnreviewed: number }>;
  publicUncategorized: number;
  config: CategorizeConfigView;
  usage: { day: string; calls: number; neurons: number; usd: number };
  canEdit: boolean;
}

export interface CategoryBulkResult {
  videoId: string;
  ok: boolean;
  error?: string;
  category?: string | null;
}

export interface CategoryBackfillPage {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  queued: number;
  alreadyHandled: number;
  withCategory: number;
  nextCursor: string | null;
  done: boolean;
}

/** A Short/video format backfill run (admin-api /api/video-format/runs/latest). */
export interface VideoFormatRunView {
  runId: string;
  dryRun: boolean;
  requestedBy?: string;
  status: 'running' | 'done';
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  nextCursor: string | null;
  lastError?: string;
  pagesDone: number;
  totals: {
    scanned: number;
    shorts: number;
    videos: number;
    overrides: number;
    live: number;
    unknown: number;
    oldRuleShorts: number;
    becameShorts: number;
    becameVideos: number;
    dimensionsStored: number;
    rechecking: number;
    flagged: number;
    errors: number;
  };
}

/** A video the Short/video rule cannot classify (no duration or encoded size, no choice). */
export interface FlaggedVideo {
  id: string;
  title?: string;
  channelId?: string;
  thumbnailUrl?: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  uploadStatus?: string;
  format: 'short' | 'video' | null;
  formatIssue: { reason: string; missing: Array<'duration' | 'dimensions'>; at: string } | null;
  dateCreated?: string;
}

export interface FlaggedVideoList {
  items: FlaggedVideo[];
  total: number;
  limit: number;
  offset: number;
}
