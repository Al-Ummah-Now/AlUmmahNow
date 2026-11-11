/**
 * Warnings to videos users (admin-web → admin-api → api-videos).
 *
 * A moderator, admin or super admin (content permission `users:warn`) warns a
 * user: admin-api stores the warning (user_warnings), writes the content audit
 * log (kind user, action warn), asks api-videos to deliver the in-app notice
 * (notification key accountWarning, category account: always on) and queues an
 * email in the user's language unless they turned account emails off.
 */

import type { ReportReason, ReportableEntityType } from './moderation';
import type { NotificationEmailLocale } from './notifications';

/** From this many warnings on, the response suggests a ban (`suggestBan`). */
export const USER_WARNING_SUGGEST_BAN_AT = 3;
/** Longest moderator note kept on a warning. */
export const USER_WARNING_NOTE_MAX = 1000;

/** Email of a warning: queued, then sent/sunk (E2E address), or not sent and why. */
export const USER_WARNING_EMAIL_STATUSES = ['queued', 'sent', 'sunk', 'disabled', 'no_address', 'failed'] as const;
export type UserWarningEmailStatus = (typeof USER_WARNING_EMAIL_STATUSES)[number];

/** POST /api/content/users/:id/warnings body. */
export interface IssueUserWarningRequest {
  /** The moderation reason (the same codes as reports). */
  reasonCode: ReportReason;
  /** Moderator's note; kept on the record for moderators, never sent to the user. */
  note?: string;
  /** The report that led to the warning, when warned from the report triage. */
  reportId?: string;
  /** The content the warning is about. */
  entityKind?: ReportableEntityType;
  entityId?: string;
}

/** One warning on a user's record. */
export interface UserWarning {
  id: string;
  userId: string;
  reasonCode: ReportReason;
  note: string | null;
  reportId: string | null;
  entityKind: ReportableEntityType | null;
  entityId: string | null;
  /** The staff member's user id. */
  issuedBy: string;
  /** Their name as it was when they issued it (token name, else email, else id). */
  issuedByName: string;
  createdAt: string;
  /** 1 for the user's first warning, 2 for the second, … */
  ordinal: number;
  /** Whether the in-app notice was handed to the notification pipeline. */
  inAppSent: boolean;
  emailStatus: UserWarningEmailStatus | null;
}

/** POST /api/content/users/:id/warnings result. */
export interface IssueUserWarningResult {
  warning: UserWarning;
  /** The user's warnings including this one. */
  count: number;
  /** This warning's place (1st, 2nd, 3rd …); equals count. */
  ordinal: number;
  /** count ≥ USER_WARNING_SUGGEST_BAN_AT: show "consider a ban". */
  suggestBan: boolean;
}

/** GET /api/content/users/:id/warnings result (newest first). */
export interface UserWarningList {
  items: UserWarning[];
  count: number;
  suggestBan: boolean;
}

export interface UserWarningEscalation {
  ordinal: number;
  suggestBan: boolean;
}

/** Where the n-th warning stands (n counts this one). */
export function warningEscalation(count: number): UserWarningEscalation {
  const ordinal = Math.max(0, Math.floor(count));
  return { ordinal, suggestBan: ordinal >= USER_WARNING_SUGGEST_BAN_AT };
}

// ---------------------------------------------------------------------------
// admin-api → api-videos (/internal/admin, INTERNAL_API_KEY)
// ---------------------------------------------------------------------------

/** POST /internal/admin/users/:id/account-notices body: deliver an account notice in-app. */
export interface AccountNoticeRequest {
  kind: 'warning';
  /** Stable id of what the notice is about (the warning id): one notice per id. */
  noticeId: string;
  reasonCode: ReportReason;
  /** The user's warnings so far, this one included. */
  count: number;
}

export interface AccountNoticeResult {
  /** True when the notice was queued for the notification pipeline. */
  queued: boolean;
}

/** GET /internal/admin/users/:id/account-email: what an account email needs. */
export interface AccountEmailContact {
  userId: string;
  email: string | null;
  displayName: string;
  /** "Email me about my account". */
  accountEmail: boolean;
  /** The language to write in (the user's pick, else the default). */
  locale: NotificationEmailLocale;
}

export type AccountEmailDecision =
  | { send: true; to: string; locale: NotificationEmailLocale }
  | { send: false; status: Extract<UserWarningEmailStatus, 'disabled' | 'no_address'> };

/** Whether to email the user about their account, and in which language. */
export function accountEmailDecision(contact: Pick<AccountEmailContact, 'email' | 'accountEmail' | 'locale'>): AccountEmailDecision {
  if (!contact.accountEmail) return { send: false, status: 'disabled' };
  const to = contact.email?.trim();
  if (!to || !to.includes('@')) return { send: false, status: 'no_address' };
  return { send: true, to, locale: contact.locale };
}
