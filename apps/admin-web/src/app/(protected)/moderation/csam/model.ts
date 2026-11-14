/**
 * CSAM cases in the admin (docs/specs/CSAM-RESPONSE.md): the pure parts of the pages, kept apart
 * from React and Next.js so they are unit tested (test/csam-page.test.ts).
 */
import { CSAM_CASE_STATUSES, NCMEC_CYBERTIPLINE_URL, type CsamCaseDetail, type CsamCaseStatus, type CsamReportFacts } from '@al-ummah/shared-types';
import { passkeyRedirectFor } from '@/lib/passkeys';

export { NCMEC_CYBERTIPLINE_URL };

/** Evidence file names as api-videos writes them (`01-matched-image.jpg`, `record-video.json`). */
export function isCsamEvidenceName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name) && !name.includes('..');
}

/** The download link of one evidence file (a plain link: the route may send the browser to sign in). */
export function csamDownloadHref(caseId: string, name: string): string {
  return `/api/csam/${encodeURIComponent(caseId)}/files/${encodeURIComponent(name)}`;
}

/** Where a refused download sends the browser: a fresh sign-in or the passkey page, then the case. */
export function csamDownloadRedirect(status: number, code: string | undefined, casePage: string): string | null {
  return passkeyRedirectFor({ status, code }, casePage);
}

/** Response headers of an evidence download: an attachment that is never sniffed, framed or cached. */
export function csamEvidenceHeaders(name: string, contentLength: string | null): Headers {
  const headers = new Headers({
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${name}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
  });
  if (contentLength && /^\d+$/.test(contentLength)) headers.set('content-length', contentLength);
  return headers;
}

export type CsamTone = 'danger' | 'warning' | 'success' | 'muted';

/** How each status reads at a glance: red needs a person now, amber is in progress. */
export const CSAM_STATUS_TONE: Record<CsamCaseStatus, CsamTone> = {
  unmapped: 'danger',
  containment_failed: 'danger',
  containing: 'warning',
  contained: 'warning',
  reported: 'success',
  closed: 'muted',
};

export const CSAM_TONE_CLASS: Record<CsamTone, string> = {
  danger: 'bg-danger-bg text-danger-fg border-danger-border',
  warning: 'bg-chip-pending-bg text-chip-pending-fg border-border',
  success: 'bg-chip-resolved-bg text-chip-resolved-fg border-border',
  muted: 'bg-chip-dismissed-bg text-chip-dismissed-fg border-border',
};

/** Cases that still need the CyberTipline report (the Errors page flag stays until it is filed). */
export function needsReport(status: CsamCaseStatus): boolean {
  return status === 'containing' || status === 'contained' || status === 'containment_failed';
}

/** The list's order: what needs a person first, then newest. */
export function sortCases<T extends { status: CsamCaseStatus; detectedAt: string }>(cases: T[]): T[] {
  const rank = (s: CsamCaseStatus) => (s === 'unmapped' || s === 'containment_failed' ? 0 : needsReport(s) ? 1 : s === 'reported' ? 2 : 3);
  return [...cases].sort((a, b) => rank(a.status) - rank(b.status) || b.detectedAt.localeCompare(a.detectedAt));
}

export const CSAM_STATUSES = CSAM_CASE_STATUSES;

/** One pre-filled field of the CyberTipline report; the label is `csamPage.facts.<id>`. */
export interface CsamFactRow {
  id: CsamFactId;
  value: string | null;
  /** Shown left to right in both languages (URLs, ids, emails, times) */
  ltr: boolean;
}

export const CSAM_FACT_IDS = [
  'incidentAt',
  'timeZone',
  'matchedUrl',
  'itemKind',
  'itemId',
  'uploadedAt',
  'userId',
  'email',
  'displayName',
  'handle',
  'channelId',
  'channelName',
  'ipAddress',
  'files',
] as const;
export type CsamFactId = (typeof CSAM_FACT_IDS)[number];

/**
 * The report's fields, filled from the record captured before the takedown (§ 2258A(b)): the
 * incident (when, where), the account (who) and the files to attach. The IP address is never
 * collected by the platform, so it stays empty for the reporter to state.
 */
export function csamFactRows(facts: CsamReportFacts, kindLabel: (kind: string) => string): CsamFactRow[] {
  const u = facts.uploader;
  const rows: Array<[CsamFactId, string | null, boolean]> = [
    ['incidentAt', facts.detectedAt, true],
    ['timeZone', facts.incidentTimeZone, true],
    ['matchedUrl', facts.matchedUrl, true],
    ['itemKind', facts.itemKind ? kindLabel(facts.itemKind) : null, false],
    ['itemId', facts.itemId, true],
    ['uploadedAt', facts.uploadedAt, true],
    ['userId', u.userId, true],
    ['email', u.email, true],
    ['displayName', u.displayName, false],
    ['handle', u.handle, true],
    ['channelId', u.channelId, true],
    ['channelName', u.channelName, false],
    ['ipAddress', null, true],
    ['files', facts.evidenceFiles.length ? facts.evidenceFiles.map((f) => f.name).join(', ') : null, true],
  ];
  return rows.map(([id, value, ltr]) => ({ id, value: value && value.trim() ? value : null, ltr }));
}

/** "Label: value" lines for "Copy all" (empty fields are left out). */
export function csamFactsText(rows: CsamFactRow[], label: (id: CsamFactId) => string): string {
  return rows.filter((r) => r.value).map((r) => `${label(r.id)}: ${r.value}`).join('\n');
}

/** What the case page may offer for this case. */
export function caseActions(c: Pick<CsamCaseDetail, 'status' | 'evidenceDeletedAt' | 'reportedAt'>) {
  return {
    map: c.status === 'unmapped',
    retry: c.status === 'containment_failed' || c.status === 'containing',
    report: c.status !== 'unmapped' && c.status !== 'closed',
    /** After the first report only the id can be corrected; the time is fixed */
    reportTimeFixed: c.reportedAt !== null,
    hold: c.evidenceDeletedAt === null,
    download: c.evidenceDeletedAt === null,
  };
}

/** A report id as admin-api accepts it (CyberTipline report numbers). */
export function validReportId(id: string): boolean {
  return /^[A-Za-z0-9-]{3,64}$/.test(id.trim());
}
