/**
 * Profile emails (admin job 'profiles.repair-emails', api-videos lib/admin/profile-emails.ts): the
 * profile's copy of the account email, and the one older channels still hold, compared with Auth.
 */

/** One job covers every profile. */
export const PROFILE_EMAILS_TARGET = { kind: 'user', id: 'profile-emails' } as const;

/** `check` compares and reports; `repair` also writes the account email on profiles that differ, and removes it from channels that do. */
export type ProfileEmailsMode = 'check' | 'repair';

/** A repair needs a finished check from this long ago at most. */
export const PROFILE_EMAILS_CHECK_MAX_AGE_HOURS = 24;

/** One stored email that is not the account's. Only in the job's private report. */
export interface ProfileEmailEntry {
  kind: 'profile' | 'channel';
  /** The profile's (user) or channel's id */
  id: string;
  userId: string;
  /** What is stored; null when there is none */
  stored: string | null;
  account: string;
  /** repair only: written, already right, or the record is gone (or has another owner now) */
  outcome?: 'written' | 'already' | 'gone';
}

/** One page of the job's private report (ADMIN_BACKUPS, super admins only). */
export interface ProfileEmailsReportPage {
  jobId: string;
  mode: ProfileEmailsMode;
  page: number;
  entries: ProfileEmailEntry[];
  /** Profiles whose user id has no sign-in account: left as they are */
  noAccount: Array<{ userId: string; stored: string | null }>;
}

/** The job's result: counts only, no emails. */
export interface ProfileEmailsResult {
  mode: ProfileEmailsMode;
  scanned: number;
  matching: number;
  /** Profiles with another email than their account's */
  differs: number;
  /** Profiles with no email stored */
  missing: number;
  /** The owners' channels that hold another email than the account's */
  channels: number;
  noAccount: number;
  unreadable: number;
  /** repair only */
  profilesWritten: number;
  channelsWritten: number;
  /** Report pages with something in them */
  reportPages: number[];
}

/** A CSAM case whose captured email is not its uploader's account email (admin-api GET /api/csam/email-check). */
export interface CsamEmailMismatch {
  caseId: string;
  userId: string;
  captured: string | null;
  /** The account's email now (deleted accounts that are not purged yet included); null when there is none */
  account: string | null;
}

export interface CsamEmailCheckPage {
  checked: number;
  items: CsamEmailMismatch[];
  next: string | null;
}
