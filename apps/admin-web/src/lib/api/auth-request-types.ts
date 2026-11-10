/** Shapes of admin-api /api/auth-requests (apps/admin-api/src/lib/authModeration.ts). */

export const AUTH_REQUEST_ACTIONS = ['suspend_account', 'delete_account', 'revoke_sessions', 'require_password_reset', 'other'] as const;
export type AuthRequestAction = (typeof AUTH_REQUEST_ACTIONS)[number];

export const AUTH_REQUEST_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'violent_content',
  'sexual_content',
  'impersonation',
  'copyright',
  'fraud',
  'compromised_account',
  'other',
] as const;
export type AuthRequestReason = (typeof AUTH_REQUEST_REASONS)[number];

export const AUTH_REQUEST_STATUSES = ['pending', 'info_requested', 'approved', 'rejected', 'actioned'] as const;
export type AuthRequestStatus = (typeof AUTH_REQUEST_STATUSES)[number];

export const isFinalAuthRequestStatus = (s: string) => s === 'rejected' || s === 'actioned';

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

export interface AuthRequestView {
  id: string;
  /** Auth's id, once delivered */
  authRequestId: string | null;
  subjectUserId: string;
  action: AuthRequestAction;
  reasonCategory: AuthRequestReason;
  reason: string;
  evidence: Array<{ url: string; label?: string }>;
  requestedBy: { id: string; name: string };
  /** sending -> sent, or failed (a videos admin can retry) */
  delivery: { status: DeliveryStatus; attempts: number; error: string | null };
  /** Auth's status once sent */
  status: AuthRequestStatus | null;
  decisionNote: string | null;
  history: Array<{ type: string; by: string; note: string | null; at: string }>;
  /** An answer to auth waiting in the queue */
  answerPending: boolean;
  /** Last status read or answer that failed after its retries */
  syncError: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Still moving: being sent, or open in auth (the panel keeps refreshing). */
export const isOpenAuthRequest = (r: Pick<AuthRequestView, 'delivery' | 'status'>) =>
  r.delivery.status === 'sending' || (r.delivery.status === 'sent' && !isFinalAuthRequestStatus(r.status ?? ''));

/** Needs a videos admin: not delivered, or its status read / answer failed after the retries. */
export const authRequestNeedsAttention = (r: Pick<AuthRequestView, 'delivery' | 'status' | 'syncError'>) =>
  r.delivery.status === 'failed' || (!!r.syncError && !isFinalAuthRequestStatus(r.status ?? ''));

export interface AuthRequestList {
  requests: AuthRequestView[];
  total: number;
  /** Requests that need a videos admin (failed delivery, status read or answer) */
  needsAttention: number;
  canRequest: boolean;
}

export interface AuthRequestEvidence {
  reports: Array<{ id: string; entity_type: string; entity_id: string; reason: string; status: string }>;
  evidence: Array<{ url: string; label?: string }>;
}

export interface AuthRequestSubmission {
  subject_user_id: string;
  action: AuthRequestAction;
  reason_category: AuthRequestReason;
  reason: string;
  note?: string;
  report_ids?: string[];
  idempotency_key: string;
}
