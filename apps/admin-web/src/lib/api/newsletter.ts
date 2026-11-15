'use server';

/**
 * Newsletter (admin-api /api/newsletter, newsletter:manage): issues written here in English and
 * Arabic go to confirmed subscribers of the www sign-up form, through the mail queue.
 */
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';
import type { IssueList, NewsletterIssue, NewsletterIssueContent, SubscriberList, SubscriberStatus } from './newsletter-types';

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const issuePath = (id: string, send = false) => `/api/newsletter/issues/${encodeURIComponent(id)}${send ? '/send' : ''}`;

export async function listNewsletterIssues(page: number, pageSize: number): Promise<IssueList> {
  return fetchAdmin<IssueList>(`/api/newsletter/issues?limit=${pageSize}&offset=${(page - 1) * pageSize}`);
}

export async function getNewsletterIssue(id: string): Promise<NewsletterIssue & { subscribers: SubscriberList['counts'] }> {
  return fetchAdmin(issuePath(id));
}

export async function listNewsletterSubscribers(opts: { status?: SubscriberStatus; q?: string; page: number; pageSize: number }): Promise<SubscriberList> {
  const p = new URLSearchParams({ limit: String(opts.pageSize), offset: String((opts.page - 1) * opts.pageSize) });
  if (opts.status) p.set('status', opts.status);
  if (opts.q) p.set('q', opts.q);
  return fetchAdmin<SubscriberList>(`/api/newsletter/subscribers?${p}`);
}

export async function createNewsletterIssue(input: Partial<NewsletterIssueContent>): Promise<ActionResult<NewsletterIssue>> {
  return toResult(() => fetchAdmin<NewsletterIssue>('/api/newsletter/issues', json('POST', input)));
}

export async function saveNewsletterIssue(id: string, input: Partial<NewsletterIssueContent>): Promise<ActionResult<NewsletterIssue>> {
  return toResult(() => fetchAdmin<NewsletterIssue>(issuePath(id), json('PATCH', input)));
}

export async function deleteNewsletterIssue(id: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin<unknown>(issuePath(id), { method: 'DELETE' }));
}

export async function sendNewsletterIssue(id: string): Promise<ActionResult<NewsletterIssue>> {
  return toResult(() => fetchAdmin<NewsletterIssue>(issuePath(id, true), { method: 'POST' }));
}

export async function deleteNewsletterSubscriber(id: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin<unknown>(`/api/newsletter/subscribers/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
