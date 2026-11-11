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
export type ModerationAction = 'warning' | 'removed' | 'banned' | 'dismissed';

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
