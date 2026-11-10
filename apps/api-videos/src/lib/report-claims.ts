/**
 * One report per user and entity (SCALABILITY-AUDIT AV-21).
 *
 * `claims/<entityId>/<userId>` in the reports bucket is created once (R2
 * create-only put) before a report is filed, so a double submit files one
 * report. Reports keep their own random ids and keys
 * (`report:<entityId>:<reportId>:<userId>`); the claim only holds the id.
 * Erasure deletes a user's claims along with anonymising their reports.
 */
export const REPORT_CLAIM_PREFIX = 'claims/';

export function reportClaimKey(entityId: string, userId: string): string {
	return `${REPORT_CLAIM_PREFIX}${entityId}/${userId}`;
}

export function isReportClaimOf(key: string, userId: string): boolean {
	return key.startsWith(REPORT_CLAIM_PREFIX) && key.endsWith(`/${userId}`);
}
