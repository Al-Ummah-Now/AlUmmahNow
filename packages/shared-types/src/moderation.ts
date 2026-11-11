// Content Moderation Types - Shared across services

// Entity types that can be reported
export const REPORTABLE_ENTITY_TYPES = ['video', 'comment', 'channel', 'livestream', 'playlist', 'post'] as const;
export type ReportableEntityType = (typeof REPORTABLE_ENTITY_TYPES)[number];

// Reasons for reporting content
export const REPORT_REASONS = ['inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Status of a report
export type ReportStatus = 'pending' | 'reviewing' | 'resolved' | 'dismissed';

// Moderation actions that can be taken
// Moderation actions that can be taken (report-queue.ts REPORT_OUTCOMES explains each).
// 'banned' bans the content's owner and hides the content; 'deleted' removes the content permanently.
export type ModerationAction = 'warning' | 'removed' | 'banned' | 'deleted' | 'dismissed';

// Report record as stored in D1 database
export interface Report {
  id: string;
  entity_type: ReportableEntityType;
  entity_id: string;
  reporter_id: string;
  reason: ReportReason;
  description?: string | null;
  status: ReportStatus;
  moderator_id?: string | null;
  action?: ModerationAction | null;
  moderator_notes?: string | null;
  created_at: string;
  updated_at?: string | null;
  resolved_at?: string | null;
  /** Copies for the reports queue search (migration 0017), filled after the report is filed. */
  entity_title?: string | null;
  entity_parent_id?: string | null;
  channel_id?: string | null;
  channel_name?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  reporter_name?: string | null;
  moderator_name?: string | null;
  meta_synced_at?: string | null;
  /** The user a 'banned' outcome banned. */
  banned_user_id?: string | null;
}

// Input for creating a report
export interface CreateReportInput {
  entityType: ReportableEntityType;
  entityId: string;
  reason: ReportReason;
  description?: string;
}

// Input for taking moderation action
export interface ModerationActionInput {
  action: ModerationAction;
  notes?: string;
}

// Result of performing content action
export interface ContentActionResult {
  performed: boolean;
  action: string;
  notes: string;
}

// Report statistics
export interface ReportStats {
  total: number;
  byStatus: {
    pending: number;
    reviewing: number;
    resolved: number;
    dismissed: number;
  };
  byEntityType: Record<string, number>;
  byAction: Record<string, number>;
  recentActivity: {
    last24Hours: number;
    last7Days: number;
    last30Days: number;
  };
}

// Moderation fields that can be added to any entity
export interface ModerationFields {
  isHidden?: boolean;
  hiddenAt?: string;
  hiddenByUserId?: string;
  hiddenReason?: string;
  hasWarning?: boolean;
  warningAt?: string;
  warningReason?: string;
}

// Soft delete fields for entities
export interface SoftDeleteFields {
  isDeleted?: boolean;
  deletedAt?: string;
  markedForDeletion?: boolean;
  markedForDeletionAt?: string;
}
