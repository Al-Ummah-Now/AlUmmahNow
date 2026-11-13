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
import { ADMIN_API_URL, E2E_DESCRIPTION_TAG, E2E_ENTITY_PREFIX, E2E_ENTITY_ROOT, TOKENS_PATH, VIDEOS_API_URL } from './env';

export interface Tokens {
  admin: string;
  superadmin: string;
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
  // A route QA does not have yet answers with a plain-text 404: specs probe for that and skip
  let body: { success?: boolean; result?: T; error?: string; [k: string]: unknown } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text.slice(0, 200) };
  }
  return { status: response.status, body };
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
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${readTokens().reporter}`,
      // Cloudflare's documented Turnstile test token (QA/stage test secret; docs/features/bot-protection.md)
      'x-turnstile-token': 'XXXX.DUMMY.TOKEN.XXXX',
    },
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
  let networkError = '';
  while (Date.now() < deadline) {
    try {
      last = await getReport(id);
      networkError = '';
    } catch (error) {
      // A dropped connection (fetch failed: ECONNRESET) is a moment of network, not an answer:
      // keep polling until the deadline. An HTTP error status is an answer and still fails at once.
      if (!(error instanceof TypeError)) throw error;
      networkError = `${error.message}${error.cause instanceof Error ? ` (${error.cause.message})` : ''}`;
    }
    if (last && predicate(last)) return last;
    await sleep(1_000);
  }
  throw new Error(`Report ${id} did not reach the expected state in ${timeoutMs}ms (last: ${JSON.stringify(last)}${networkError ? `; last network error: ${networkError}` : ''})`);
}

export async function dismissReport(id: string, notes = `${E2E_DESCRIPTION_TAG} cleanup`): Promise<number> {
  const { status } = await adminApi(`/api/moderation/reports/${id}/action`, {
    method: 'POST',
    body: JSON.stringify({ action: 'dismissed', notes }),
  });
  return status;
}

/**
 * Longer than any admin E2E job runs: an e2e report this old belongs to a job
 * that died before its teardown, so any job may close it.
 */
const ABANDONED_REPORT_MS = 6 * 60 * 60 * 1000;

/**
 * Whether this job's setup/teardown may dismiss `report`: its own (by entity
 * id prefix), and abandoned e2e reports of any run. Never a recent report of
 * another job, which may be mid-test on it.
 */
function closable(report: AdminReport, now: number): boolean {
  if (report.entity_id.startsWith(E2E_ENTITY_PREFIX)) return true;
  return report.entity_id.startsWith(E2E_ENTITY_ROOT) && now - Date.parse(report.created_at) > ABANDONED_REPORT_MS;
}

/** Dismiss every still-open report this job created, and abandoned e2e ones. */
export async function closeOpenE2eReports(): Promise<number> {
  let closed = 0;
  const now = Date.now();
  for (const status of ['pending', 'reviewing']) {
    for (let offset = 0; ; offset += 100) {
      const page = await listReports(`status=${status}&limit=100&offset=${offset}`);
      const mine = page.reports.filter((r) => closable(r, now));
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
