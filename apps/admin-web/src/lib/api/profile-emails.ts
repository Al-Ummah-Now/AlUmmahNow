'use server';

/**
 * Profile emails (admin-api /api/content/profile-emails and the CSAM email check). Super admins only;
 * admin-api checks the role on every call. Starting a job needs a fresh sign-in (toResult).
 */
import type { AdminJob, CsamEmailCheckPage, ProfileEmailsMode, ProfileEmailsReportPage } from '@al-ummah/shared-types';
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';

const BASE = '/api/content/profile-emails/jobs';

export async function listProfileEmailJobs(): Promise<AdminJob[]> {
  return (await fetchAdmin<{ items: AdminJob[] }>(BASE)).items;
}

export async function startProfileEmails(mode: ProfileEmailsMode, checkJobId?: string): Promise<ActionResult<{ job: AdminJob }>> {
  return toResult(() => fetchAdmin<{ job: AdminJob }>(BASE, { method: 'POST', body: JSON.stringify({ mode, ...(checkJobId ? { checkJobId } : {}) }), headers: { 'Content-Type': 'application/json' } }));
}

export async function getProfileEmailsReport(jobId: string, page: number): Promise<ActionResult<ProfileEmailsReportPage>> {
  return toResult(() => fetchAdmin<ProfileEmailsReportPage>(`${BASE}/${encodeURIComponent(jobId)}/report?page=${page}`));
}

/** One page of the CSAM cases whose captured email is not their uploader's account email. */
export async function checkCsamEmails(after: string | null): Promise<ActionResult<CsamEmailCheckPage>> {
  return toResult(() => fetchAdmin<CsamEmailCheckPage>(`/api/csam/email-check${after ? `?after=${encodeURIComponent(after)}` : ''}`));
}
