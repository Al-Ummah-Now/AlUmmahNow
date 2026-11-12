/**
 * Shapes the content management pages read from admin-api (/api/content/*).
 * Rows and details come from shared-types; admin-api adds report counts,
 * recent reports and the item's audit history.
 */
import type {
  AdminAuditEntry,
  AdminJob,
  AdminChannelDetail,
  AdminChannelRow,
  AdminCommentRow,
  AdminContentPermission,
  AdminPage,
  AdminPlaylistRow,
  AdminPostRow,
  AdminUserDetail,
  AdminUserRow,
  AdminUserSearchItem,
  AdminVideoDetail,
  AdminVideoRow,
} from '@al-ummah/shared-types';

export type { AdminDeletion, AdminDeletionKind, AdminDeletionPage, AdminDeletionStatus } from '@al-ummah/shared-types';
export type { AdminVideoR2, AdminVideoR2Badge, AdminVideoR2Result, R2RungProgress, R2RungState, TranscodeFailure, TranscodeStage } from '@al-ummah/shared-types';

export type {
  AdminUserSearchItem,
  AdminJob,
  AdminChannelRow,
  AdminCommentRow,
  AdminContentPermission,
  AdminPage,
  AdminPlaylistRow,
  AdminPostRow,
  AdminUserRow,
  AdminVideoRow,
};

export interface ContentReport {
  id: string;
  entityType: string;
  entityId: string;
  reporterId: string;
  reason: string;
  description: string | null;
  status: string;
  action: string | null;
  createdAt: string;
}

export type ContentAuditEntry = AdminAuditEntry & { previous: Record<string, unknown> | null };

interface WithHistory {
  reports: ContentReport[];
  audit: ContentAuditEntry[];
  /** The item's latest admin jobs, newest first; null when they could not be read. */
  jobs: AdminJob[] | null;
}

/** What a heavy action (queued as a job) returns. */
export interface JobResult {
  job: AdminJob;
}

export interface JobCounts {
  failed: number;
  retrying: number;
}

export type ChannelDetailView = AdminChannelDetail & WithHistory & { openReports: number };
export type VideoDetailView = AdminVideoDetail & WithHistory & { openReports: number };
export type UserDetailView = AdminUserDetail & WithHistory;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Query values as the list pages pass them on (already validated strings). */
export type ListParams = Record<string, string | number | undefined>;
