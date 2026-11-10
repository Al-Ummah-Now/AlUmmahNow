import type { ContactStatus, ContactTopic } from '@/lib/api/types';

export const CONTACT_STATUSES: ContactStatus[] = ['new', 'open', 'replied', 'closed', 'spam'];
export const CONTACT_TOPICS: ContactTopic[] = ['general', 'account', 'problem', 'content', 'partnership'];
export const CONTACT_PAGE_SIZE = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ContactInboxFilters {
  status?: ContactStatus;
  topic?: ContactTopic;
  from?: string;
  to?: string;
  q?: string;
  assignee?: 'me' | 'unassigned';
  page: number;
}

/** Untrusted query string → filters admin-api accepts (unknown values are dropped). */
export function parseContactFilters(params: Record<string, string | string[] | undefined>): ContactInboxFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const status = first(params.status);
  const topic = first(params.topic);
  const from = first(params.from);
  const to = first(params.to);
  const q = first(params.q)?.trim().slice(0, 200);
  const assignee = first(params.assignee);
  const page = Number.parseInt(first(params.page) ?? '1', 10);
  return {
    status: CONTACT_STATUSES.includes(status as ContactStatus) ? (status as ContactStatus) : undefined,
    topic: CONTACT_TOPICS.includes(topic as ContactTopic) ? (topic as ContactTopic) : undefined,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    q: q || undefined,
    assignee: assignee === 'me' || assignee === 'unassigned' ? assignee : undefined,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

export function contactHref(filters: Partial<ContactInboxFilters>): string {
  const search = new URLSearchParams();
  for (const key of ['status', 'topic', 'from', 'to', 'q', 'assignee'] as const) {
    const value = filters[key];
    if (value) search.set(key, value);
  }
  if (filters.page && filters.page > 1) search.set('page', String(filters.page));
  const query = search.toString();
  return query ? `/contact?${query}` : '/contact';
}

export const hasContactFilters = (f: ContactInboxFilters) => !!(f.status || f.topic || f.from || f.to || f.q || f.assignee);
