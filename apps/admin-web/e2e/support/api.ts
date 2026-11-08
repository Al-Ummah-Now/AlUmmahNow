/**
 * API-side fixtures: file reports as the non-admin test user through
 * api-videos (the same endpoint the public site uses), wait for the processor
 * to land them in D1, and close leftovers through admin-api.
 *
 * Reports cannot be deleted (admin-api has no delete endpoint), so "cleanup"
 * means dismissing any e2e report that a test left open. All e2e reports use
 * fabricated entity ids under E2E_ENTITY_PREFIX so no real content is touched.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ADMIN_API_URL, E2E_DESCRIPTION_TAG, E2E_ENTITY_PREFIX, TOKENS_PATH, VIDEOS_API_URL } from './env';

export interface Tokens {
  admin: string;
  moderator: string;
  reporter: string;
}

export interface AdminReport {
  id: string;
  entity_type: string;
  entity_id: string;
  reporter_id: string;
  reason: string;
  description: string | null;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  moderator_id: string | null;
  action: string | null;
  moderator_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ReportStats {
  total: number;
  byStatus: Record<'pending' | 'reviewing' | 'resolved' | 'dismissed', number>;
  recentActivity: { last24Hours: number; last7Days: number; last30Days: number };
}

let cachedTokens: Tokens | null = null;
export function readTokens(): Tokens {
  if (!cachedTokens) {
    cachedTokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as Tokens;
  }
  return cachedTokens;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function adminApi<T = unknown>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: { success?: boolean; result?: T; error?: string; [k: string]: unknown } }> {
  const { token = readTokens().admin, ...rest } = init;
  const response = await fetch(`${ADMIN_API_URL}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(rest.headers as Record<string, string>),
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

export async function getReport(id: string): Promise<AdminReport | null> {
  const { status, body } = await adminApi<{ report: AdminReport }>(`/api/moderation/reports/${id}`);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`GET report ${id} -> ${status}`);
  return body.result!.report;
}

export async function getStats(): Promise<ReportStats> {
  const { status, body } = await adminApi<ReportStats>('/api/moderation/reports/stats');
  if (status !== 200) throw new Error(`GET stats -> ${status}`);
  return body.result!;
}

export async function listReports(query: string): Promise<{ reports: AdminReport[]; total: number }> {
  const { status, body } = await adminApi<{ reports: AdminReport[]; total: number }>(`/api/moderation/reports?${query}`);
  if (status !== 200) throw new Error(`GET reports?${query} -> ${status}`);
  return body.result!;
}

export interface CreateReportOptions {
  entityType?: 'video' | 'comment' | 'channel' | 'livestream';
  reason?: 'inappropriate' | 'spam' | 'harassment' | 'copyright' | 'misinformation' | 'other';
  description?: string;
  label?: string;
}

/** File a report as the reporter account and wait until admin-api can see it. */
export async function createReport(options: CreateReportOptions = {}): Promise<AdminReport> {
  const entityId = `${E2E_ENTITY_PREFIX}${options.label ?? 'r'}-${crypto.randomUUID()}`;
  const response = await fetch(`${VIDEOS_API_URL}/api/moderation/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${readTokens().reporter}` },
    body: JSON.stringify({
      entityType: options.entityType ?? 'comment',
      entityId,
      reason: options.reason ?? 'spam',
      description: options.description ?? `${E2E_DESCRIPTION_TAG} automated admin-web UI test report`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Creating report failed: ${response.status} ${await response.text()}`);
  }
  const { result } = (await response.json()) as { result: { report: { id: string } } };
  return waitForReport(result.report.id);
}

/** The processor writes reports to D1 asynchronously (queue consumer). */
export async function waitForReport(
  id: string,
  predicate: (report: AdminReport) => boolean = () => true,
  timeoutMs = 45_000,
): Promise<AdminReport> {
  const deadline = Date.now() + timeoutMs;
  let last: AdminReport | null = null;
  while (Date.now() < deadline) {
    last = await getReport(id);
    if (last && predicate(last)) return last;
    await sleep(1_000);
  }
  throw new Error(`Report ${id} did not reach the expected state in ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
}

export async function dismissReport(id: string, notes = `${E2E_DESCRIPTION_TAG} cleanup`): Promise<number> {
  const { status } = await adminApi(`/api/moderation/reports/${id}/action`, {
    method: 'POST',
    body: JSON.stringify({ action: 'dismissed', notes }),
  });
  return status;
}

/** Dismiss every still-open report the suite created (by entity id prefix). */
export async function closeOpenE2eReports(): Promise<number> {
  let closed = 0;
  for (const status of ['pending', 'reviewing']) {
    for (let offset = 0; ; offset += 100) {
      const page = await listReports(`status=${status}&limit=100&offset=${offset}`);
      const mine = page.reports.filter((r) => r.entity_id.startsWith(E2E_ENTITY_PREFIX));
      let closedHere = 0;
      for (const report of mine) {
        if ((await dismissReport(report.id)) === 200) closedHere++;
      }
      closed += closedHere;
      if (page.reports.length < 100) break;
      // Dismissed rows leave the filtered list, so re-read the same window.
      if (closedHere > 0) offset -= closedHere;
    }
  }
  return closed;
}
