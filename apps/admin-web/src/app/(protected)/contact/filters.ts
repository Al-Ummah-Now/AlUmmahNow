import type { ContactStatus, ContactTopic } from '@/lib/api/types';

export const CONTACT_STATUSES: ContactStatus[] = ['open', 'in_progress', 'replied', 'closed', 'spam'];
export const CONTACT_READ = ['unread', 'read'] as const;
export type ContactRead = (typeof CONTACT_READ)[number];
export const CONTACT_TOPICS: ContactTopic[] = ['general', 'account', 'problem', 'content', 'partnership'];
export const CONTACT_PAGE_SIZE = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Not a stored status: messages with an email that finally failed to send. */
export const SEND_FAILED = 'send_failed' as const;

export interface ContactInboxFilters {
  status?: ContactStatus | typeof SEND_FAILED;
  topic?: ContactTopic;
  from?: string;
  to?: string;
  q?: string;
  assignee?: 'me' | 'unassigned';
  /** unread: not yet read (never spam); read: read */
  read?: ContactRead;
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
  const read = first(params.read);
  const page = Number.parseInt(first(params.page) ?? '1', 10);
  return {
    status: status === SEND_FAILED ? SEND_FAILED : CONTACT_STATUSES.includes(status as ContactStatus) ? (status as ContactStatus) : undefined,
    topic: CONTACT_TOPICS.includes(topic as ContactTopic) ? (topic as ContactTopic) : undefined,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    q: q || undefined,
    assignee: assignee === 'me' || assignee === 'unassigned' ? assignee : undefined,
    read: (CONTACT_READ as readonly string[]).includes(read ?? '') ? (read as ContactRead) : undefined,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

export function contactHref(filters: Partial<ContactInboxFilters>): string {
  const search = new URLSearchParams();
  for (const key of ['status', 'topic', 'from', 'to', 'q', 'assignee', 'read'] as const) {
    const value = filters[key];
    if (value) search.set(key, value);
  }
  if (filters.page && filters.page > 1) search.set('page', String(filters.page));
  const query = search.toString();
  return query ? `/contact?${query}` : '/contact';
}

export const hasContactFilters = (f: ContactInboxFilters) => !!(f.status || f.topic || f.from || f.to || f.q || f.assignee || f.read);

/** The inbox's views (tabs above the list): each is a set of filters kept in the URL. */
export const CONTACT_VIEWS = [
  { id: 'all', filters: {} },
  { id: 'unread', filters: { read: 'unread' } },
  { id: 'open', filters: { status: 'open' } },
  { id: 'in_progress', filters: { status: 'in_progress' } },
  { id: 'spam', filters: { status: 'spam' } },
  { id: 'send_failed', filters: { status: SEND_FAILED } },
] as const satisfies readonly { id: string; filters: Partial<ContactInboxFilters> }[];
export type ContactViewId = (typeof CONTACT_VIEWS)[number]['id'];

/** The view the filters are exactly on (other filters such as search keep it), or null. */
export function activeContactView(f: ContactInboxFilters): ContactViewId | null {
  if (f.read === 'unread' && !f.status) return 'unread';
  if (!f.read) {
    if (!f.status) return 'all';
    const view = CONTACT_VIEWS.find((v) => 'status' in v.filters && v.filters.status === f.status);
    if (view) return view.id;
  }
  return null;
}
