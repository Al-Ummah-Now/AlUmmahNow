'use server';

/**
 * CSAM cases (admin-api /api/csam, docs/specs/CSAM-RESPONSE.md). Super admins only; admin-api
 * checks the role on every call and logs every read and action. Intake, mapping, retry, "Reported",
 * the legal hold, the retention setting and the webhook secret need a fresh sign-in: toResult
 * sends the browser through it and back to the page.
 */
import type { CsamAccessLogEntry, CsamCaseDetail, CsamCaseSummary, CsamSettings } from '@al-ummah/shared-types';
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';

const casePath = (id: string, action?: 'map' | 'retry' | 'reported' | 'hold' | 'log') => `/api/csam/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

export interface CsamIntakeResult {
  cases: CsamCaseSummary[];
  /** Ids of open cases the pasted URLs already belong to */
  existing: string[];
  /** URLs that are not ours (other sites) */
  notOurs: number;
}

export type CsamHandMapping =
  | { kind: 'video'; videoId: string }
  | { kind: 'post'; channelId: string; postId: string }
  | { kind: 'profile_image' | 'channel_image'; id: string; field: 'avatarUrl' | 'coverUrl' };

export async function listCsamCases(): Promise<CsamCaseSummary[]> {
  return (await fetchAdmin<{ items: CsamCaseSummary[] }>('/api/csam')).items;
}

export async function getCsamSettings(): Promise<CsamSettings> {
  return fetchAdmin<CsamSettings>('/api/csam/settings');
}

export async function getCsamSettingsLog(): Promise<CsamAccessLogEntry[]> {
  return (await fetchAdmin<{ items: CsamAccessLogEntry[] }>('/api/csam/log')).items;
}

export async function getCsamCase(id: string): Promise<CsamCaseDetail> {
  return fetchAdmin<CsamCaseDetail>(casePath(id));
}

export async function getCsamCaseLog(id: string): Promise<CsamAccessLogEntry[]> {
  return (await fetchAdmin<{ items: CsamAccessLogEntry[] }>(casePath(id, 'log'))).items;
}

export async function submitCsamIntake(text: string): Promise<ActionResult<CsamIntakeResult>> {
  return toResult(() => fetchAdmin<CsamIntakeResult>('/api/csam/intake', json('POST', { text })));
}

export async function mapCsamCase(id: string, mapping: CsamHandMapping): Promise<ActionResult<CsamCaseSummary>> {
  return toResult(() => fetchAdmin<CsamCaseSummary>(casePath(id, 'map'), json('POST', mapping)));
}

export async function retryCsamCase(id: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin<unknown>(casePath(id, 'retry'), { method: 'POST' }));
}

export async function markCsamReported(id: string, input: { reportId: string; reportedAt?: string }): Promise<ActionResult<CsamCaseSummary>> {
  return toResult(() => fetchAdmin<CsamCaseSummary>(casePath(id, 'reported'), json('POST', input)));
}

export async function setCsamLegalHold(id: string, input: { on: boolean; reason: string }): Promise<ActionResult<CsamCaseSummary>> {
  return toResult(() => fetchAdmin<CsamCaseSummary>(casePath(id, 'hold'), json('POST', input)));
}

export async function setCsamRetentionDays(retentionDays: number): Promise<ActionResult<CsamSettings>> {
  return toResult(() => fetchAdmin<CsamSettings>('/api/csam/settings', json('PUT', { retentionDays })));
}

export async function generateCsamWebhookSecret(): Promise<ActionResult<{ secret: string; webhookUrl: string }>> {
  return toResult(() => fetchAdmin<{ secret: string; webhookUrl: string }>('/api/csam/settings/webhook-secret', { method: 'POST' }));
}
